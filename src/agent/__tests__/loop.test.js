import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { runAgentLoop } from '../loop.js';
import { config } from '../../config.js';
import { finalizeTicket } from '../../database/sqlite.js';
import { executeTool, getOpenAITools } from '../registry.js';

// Mock sqlite database updates
vi.mock('../../database/sqlite.js', () => ({
  finalizeTicket: vi.fn((ticketId, status) => ({ status, finalized: true }))
}));

// Mock the tool registry to decouple loop tests from actual tool implementations
vi.mock('../registry.js', () => ({
  executeTool: vi.fn(),
  getOpenAITools: vi.fn(() => [{ type: 'function', function: { name: 'read_ticket' } }])
}));

// Mock axios for OpenAI HTTP requests
vi.mock('axios');

describe('Agent ReAct Loop', () => {
  const ticketId = 'T-TEST-LOOP';
  const historyFilePath = join(config.historyDir, `${ticketId}.json`);
  let sessionContext;

  beforeEach(() => {
    sessionContext = {
      ticketId,
      flags: {
        wasTicketRead: false,
        wasClassified: false,
        wasResponseDrafted: false,
        wasIncidentsChecked: false,
        wasRouted: false
      }
    };
    
    // Clear mocks
    vi.clearAllMocks();
    
    // Ensure clean state (no leftover test files)
    if (existsSync(historyFilePath)) {
      try { unlinkSync(historyFilePath); } catch (e) {}
    }
    
    config.openaiApiKey = 'mock-key';
  });

  afterEach(() => {
    if (existsSync(historyFilePath)) {
      try { unlinkSync(historyFilePath); } catch (e) {}
    }
  });

  it('should initialize history and execute successfully when idle tool is called and validates', async () => {
    // 1. Mock first OpenAI call: requests "read_ticket" tool
    // 2. Mock second OpenAI call: requests "idle" tool
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'read_ticket', arguments: '{}' }
            }]
          }
        }],
        usage: { total_tokens: 150 }
      }
    }).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'idle', arguments: '{"resolution_type":"resolved","reason":"All tasks completed"}' }
            }]
          }
        }],
        usage: { total_tokens: 300 }
      }
    });

    // Mock tool executions
    executeTool
      .mockResolvedValueOnce('Ticket T-TEST-LOOP details') // read_ticket response
      .mockResolvedValueOnce('# Agent idling\n\nResolution: resolved\nReason: All tasks completed'); // idle response

    const result = await runAgentLoop(sessionContext);

    expect(result.status).toBe('completed');
    expect(finalizeTicket).toHaveBeenCalledWith(ticketId, 'completed', null, null);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'read_ticket', {}, sessionContext);
    expect(executeTool).toHaveBeenNthCalledWith(2, 'idle', { resolution_type: 'resolved', reason: 'All tasks completed' }, sessionContext);


    // Verify history file was saved
    expect(existsSync(historyFilePath)).toBe(true);
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history.length).toBe(6); // system + user + assistant (tool_call_1) + tool_response_1 + assistant (tool_call_2) + tool_response_2
    expect(history[0].role).toBe('system');
    expect(readdirSync(config.historyDir).filter((name) => name.includes(`${ticketId}.json.`))).toEqual([]);
  });

  it('should trigger safety valve and escalate when context budget is exceeded', async () => {
    // Mock OpenAI call returning a large usage count
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'read_ticket', arguments: '{}' }
            }]
          }
        }],
        usage: { total_tokens: 61000 } // Exceeds budget of 60000
      }
    });

    executeTool.mockResolvedValueOnce('Details');

    const result = await runAgentLoop(sessionContext);

    expect(result.status).toBe('escalated');
    expect(finalizeTicket).toHaveBeenCalledWith(ticketId, 'escalated', 'escalated', 'Context token limit reached');
    
    // Verify system message added about halting
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    const lastMessage = history[history.length - 1];
    expect(lastMessage.role).toBe('system');
    expect(lastMessage.content).toContain('Context budget of 60000 tokens exceeded');
  });

  it('should repair dangling assistant tool calls on startup', async () => {
    // Setup pre-existing history with dangling assistant tool call (no tool response)
    const danglingHistory = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: 'A new ticket is assigned to you...' },
      { 
        role: 'assistant', 
        tool_calls: [{ id: 'call_dang', type: 'function', function: { name: 'read_ticket', arguments: '{}' } }] 
      }
    ];

    writeFileSync(historyFilePath, JSON.stringify(danglingHistory, null, 2));

    // Mock OpenAI response for the run
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_idle',
              type: 'function',
              function: { name: 'idle', arguments: '{"resolution_type":"resolved","reason":"All tasks completed"}' }
            }]
          }
        }],
        usage: { total_tokens: 100 }
      }
    });

    executeTool.mockResolvedValueOnce('# Agent idling\n\nResolution: resolved\nReason: All tasks completed');


    await runAgentLoop(sessionContext);

    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    const repaired = history.find((message) => message.role === 'tool' && message.tool_call_id === 'call_dang');
    expect(JSON.parse(repaired.content)).toMatchObject({
      ok: false,
      error: { code: 'WORKER_INTERRUPTED', retryable: true }
    });
  });

  it('should support llamacpp provider and request the correct endpoint without requiring openaiApiKey', async () => {
    config.llmProvider = 'llamacpp';
    config.llamacppUrl = 'http://localhost:9999';
    config.llamacppModel = 'local-llama-3';
    config.openaiApiKey = ''; // Clear api key

    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'idle', arguments: '{"resolution_type":"resolved","reason":"All tasks completed"}' }
            }]
          }
        }],
        usage: { total_tokens: 80 }
      }
    });

    executeTool.mockResolvedValueOnce('# Agent idling\n\nResolution: resolved\nReason: All tasks completed');


    const result = await runAgentLoop(sessionContext);

    expect(result.status).toBe('completed');
    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:9999/v1/chat/completions',
      expect.objectContaining({
        model: 'local-llama-3',
        tool_choice: 'auto'
      }),
      expect.objectContaining({
        timeout: 120000 // llamacpp timeout
      })
    );

    // Restore config values
    config.llmProvider = 'openai';
    config.openaiApiKey = 'mock-key';
  });

  it('should resume conversation history and execute successfully when new player messages are appended', async () => {
    // 1. Create a pre-existing conversation history of a completed first run
    const firstRunHistory = [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: 'A new ticket is assigned to you...' },
      { role: 'assistant', tool_calls: [{ id: 'call_init_read', type: 'function', function: { name: 'read_ticket', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_init_read', name: 'read_ticket', content: 'Ticket details' },
      { role: 'assistant', tool_calls: [{ id: 'call_init_idle', type: 'function', function: { name: 'idle', arguments: '{"resolution_type":"resolved","reason":"All tasks completed"}' } }] },
      { role: 'tool', tool_call_id: 'call_init_idle', name: 'idle', content: '# Agent idling\n\nResolution: resolved\nReason: All tasks completed' },

      // Wake-up message added by the API
      { role: 'user', content: 'The player has sent a new update. Call read_ticket to read the new message and update the ticket state.' }
    ];

    writeFileSync(historyFilePath, JSON.stringify(firstRunHistory, null, 2));

    // 2. Mock OpenAI completions for the resumed run
    // It should call read_ticket first, then idle
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_resume_read',
              type: 'function',
              function: { name: 'read_ticket', arguments: '{}' }
            }]
          }
        }],
        usage: { total_tokens: 120 }
      }
    }).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_resume_idle',
              type: 'function',
              function: { name: 'idle', arguments: '{"resolution_type":"resolved","reason":"All tasks completed"}' }
            }]
          }
        }],
        usage: { total_tokens: 240 }
      }
    });


    executeTool
      .mockResolvedValueOnce('Updated ticket details with player response')
      .mockResolvedValueOnce('# Agent idling\n\nAll tasks completed.');

    // Run the agent loop with a fresh sessionContext (all flags start false)
    const result = await runAgentLoop(sessionContext);

    expect(result.status).toBe('completed');
    expect(finalizeTicket).toHaveBeenCalledWith(ticketId, 'completed', null, null);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'read_ticket', {}, sessionContext);
    expect(executeTool).toHaveBeenNthCalledWith(2, 'idle', { resolution_type: 'resolved', reason: 'All tasks completed' }, sessionContext);


    // Verify history file now contains the appended resumed messages
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history.length).toBe(11); // 7 initial + 4 new turns (assistant, tool, assistant, tool)
    expect(history[7].role).toBe('assistant');
    expect(history[7].tool_calls[0].id).toBe('call_resume_read');
    expect(history[9].tool_calls[0].id).toBe('call_resume_idle');
  });

  it('should retry transient LLM failures before failing the ticket', async () => {
    const originalRetries = config.llmMaxRetries;
    const originalDelay = config.llmRetryBaseDelayMs;
    config.llmMaxRetries = 1;
    config.llmRetryBaseDelayMs = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0);

    axios.post
      .mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { response: { status: 503 } }))
      .mockResolvedValueOnce({
        data: {
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'call_retry_idle',
                type: 'function',
                function: { name: 'idle', arguments: '{"resolution_type":"resolved","reason":"Done"}' }
              }]
            }
          }],
          usage: { total_tokens: 50 }
        }
      });
    executeTool.mockResolvedValueOnce('# Agent idling');

    try {
      await runAgentLoop(sessionContext);
      expect(axios.post).toHaveBeenCalledTimes(2);
    } finally {
      config.llmMaxRetries = originalRetries;
      config.llmRetryBaseDelayMs = originalDelay;
    }
  });

  it('should return a structured error without executing malformed tool arguments', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_invalid',
              type: 'function',
              function: { name: 'read_ticket', arguments: '{invalid' }
            }]
          }
        }],
        usage: { total_tokens: 50 }
      }
    }).mockResolvedValueOnce({
      data: {
        choices: [{
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call_after_invalid',
              type: 'function',
              function: { name: 'idle', arguments: '{"resolution_type":"rejected","reason":"Invalid"}' }
            }]
          }
        }],
        usage: { total_tokens: 80 }
      }
    });
    executeTool.mockResolvedValueOnce('# Agent idling');

    await runAgentLoop(sessionContext);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith('idle', expect.any(Object), sessionContext);
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    const invalidResult = history.find((message) => message.tool_call_id === 'call_invalid');
    expect(JSON.parse(invalidResult.content).error.code).toBe('INVALID_ARGUMENTS_JSON');
  });

  it('should repair only missing results from a partially completed tool batch', async () => {
    writeFileSync(historyFilePath, JSON.stringify([
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: 'Start' },
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_done', type: 'function', function: { name: 'read_ticket', arguments: '{}' } },
          { id: 'call_missing', type: 'function', function: { name: 'search_incidents', arguments: '{"query":"login"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_done', name: 'read_ticket', content: JSON.stringify({ ok: true, output: 'details' }) }
    ], null, 2));
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { role: 'assistant', tool_calls: [{
          id: 'call_idle_partial', type: 'function', function: { name: 'idle', arguments: '{"resolution_type":"rejected","reason":"Done"}' }
        }] } }],
        usage: { total_tokens: 50 }
      }
    });
    executeTool.mockResolvedValueOnce('# Agent idling');

    await runAgentLoop(sessionContext);

    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history.filter((message) => message.tool_call_id === 'call_done')).toHaveLength(1);
    const repaired = history.find((message) => message.tool_call_id === 'call_missing');
    expect(JSON.parse(repaired.content).error.code).toBe('WORKER_INTERRUPTED');
  });

  it('should reconstruct successful workflow flags from persisted structured results', async () => {
    writeFileSync(historyFilePath, JSON.stringify([
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: 'Start' },
      { role: 'assistant', tool_calls: [{ id: 'call_read_old', type: 'function', function: { name: 'read_ticket', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_read_old', name: 'read_ticket', content: JSON.stringify({ ok: true, output: 'details' }) }
    ], null, 2));
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { role: 'assistant', tool_calls: [{
          id: 'call_idle_reconstructed', type: 'function', function: { name: 'idle', arguments: '{"resolution_type":"rejected","reason":"Done"}' }
        }] } }],
        usage: { total_tokens: 50 }
      }
    });
    executeTool.mockImplementationOnce(async (name, args, context) => {
      expect(context.flags.wasTicketRead).toBe(true);
      return '# Agent idling';
    });

    await runAgentLoop(sessionContext);
    expect(sessionContext.flags.wasTicketRead).toBe(true);
  });

  it('should append one wake-up marker for the current workflow revision', async () => {
    sessionContext.workflowRevision = 3;
    writeFileSync(historyFilePath, JSON.stringify([
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: 'Start' }
    ], null, 2));
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { role: 'assistant', tool_calls: [{
          id: 'call_idle_revision', type: 'function', function: { name: 'idle', arguments: '{"resolution_type":"rejected","reason":"Done"}' }
        }] } }],
        usage: { total_tokens: 50 }
      }
    });
    executeTool.mockResolvedValueOnce('# Agent idling');

    await runAgentLoop(sessionContext);

    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history.filter((message) => message.content?.includes('workflow_revision:3'))).toHaveLength(1);
  });

  it('should not retry permanent LLM request failures', async () => {
    axios.post.mockRejectedValueOnce(Object.assign(new Error('Bad request'), {
      response: { status: 400, data: { error: { message: 'Invalid request' } } }
    }));

    await expect(runAgentLoop(sessionContext)).rejects.toThrow('Invalid request');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(finalizeTicket).not.toHaveBeenCalled();
  });

  it('should fail the loop when transactional finalization fails', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { role: 'assistant', tool_calls: [{
          id: 'call_idle_db_error', type: 'function', function: { name: 'idle', arguments: '{"resolution_type":"rejected","reason":"Done"}' }
        }] } }],
        usage: { total_tokens: 50 }
      }
    });
    executeTool.mockResolvedValueOnce('# Agent idling');
    finalizeTicket.mockImplementationOnce(() => { throw new Error('database unavailable'); });

    await expect(runAgentLoop(sessionContext)).rejects.toThrow('database unavailable');
  });

  it('should fail after exhausting retryable LLM attempts', async () => {
    const originalRetries = config.llmMaxRetries;
    const originalDelay = config.llmRetryBaseDelayMs;
    config.llmMaxRetries = 1;
    config.llmRetryBaseDelayMs = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    axios.post.mockRejectedValue(Object.assign(new Error('Unavailable'), { response: { status: 503 } }));

    try {
      await expect(runAgentLoop(sessionContext)).rejects.toThrow('Unavailable');
      expect(axios.post).toHaveBeenCalledTimes(2);
    } finally {
      config.llmMaxRetries = originalRetries;
      config.llmRetryBaseDelayMs = originalDelay;
    }
  });

  it('should reject unsafe ticket IDs before creating history files', async () => {
    sessionContext.ticketId = '../unsafe';
    await expect(runAgentLoop(sessionContext)).rejects.toThrow('Ticket ID may contain only');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('should replace corrupt history with a valid fresh conversation', async () => {
    writeFileSync(historyFilePath, '{not-json');
    axios.post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { role: 'assistant', tool_calls: [{
          id: 'call_idle_corrupt', type: 'function', function: { name: 'idle', arguments: '{"resolution_type":"rejected","reason":"Done"}' }
        }] } }],
        usage: { total_tokens: 50 }
      }
    });
    executeTool.mockResolvedValueOnce('# Agent idling');

    await runAgentLoop(sessionContext);

    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history[0]).toMatchObject({ role: 'system' });
    expect(history[1].content).toContain(ticketId);
  });
});
