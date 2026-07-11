import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { runAgentLoop } from '../loop.js';
import { config } from '../../config.js';
import { updateTicketStatus } from '../../database/sqlite.js';
import { executeTool, getOpenAITools } from '../registry.js';

// Mock sqlite database updates
vi.mock('../../database/sqlite.js', () => ({
  updateTicketStatus: vi.fn()
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
              function: { name: 'idle', arguments: '{}' }
            }]
          }
        }],
        usage: { total_tokens: 300 }
      }
    });

    // Mock tool executions
    executeTool
      .mockResolvedValueOnce('Ticket T-TEST-LOOP details') // read_ticket response
      .mockResolvedValueOnce('# Agent idling\n\nAll tasks completed.'); // idle response

    const result = await runAgentLoop(sessionContext);

    expect(result.status).toBe('completed');
    expect(updateTicketStatus).toHaveBeenCalledWith(ticketId, 'completed');
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'read_ticket', {}, sessionContext);
    expect(executeTool).toHaveBeenNthCalledWith(2, 'idle', {}, sessionContext);

    // Verify history file was saved
    expect(existsSync(historyFilePath)).toBe(true);
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history.length).toBe(6); // system + user + assistant (tool_call_1) + tool_response_1 + assistant (tool_call_2) + tool_response_2
    expect(history[0].role).toBe('system');
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
    expect(updateTicketStatus).toHaveBeenCalledWith(ticketId, 'escalated');
    
    // Verify system message added about halting
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    const lastMessage = history[history.length - 1];
    expect(lastMessage.role).toBe('system');
    expect(lastMessage.content).toContain('Context budget of 60000 tokens exceeded');
  });

  it('should apply Selective Tail Validation and prune dangling assistant turns on startup', async () => {
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
              function: { name: 'idle', arguments: '{}' }
            }]
          }
        }],
        usage: { total_tokens: 100 }
      }
    });

    executeTool.mockResolvedValueOnce('Success');

    await runAgentLoop(sessionContext);

    // If Selective Tail Validation worked, the dangling assistant message was popped,
    // and a new turn commenced. So the history should only have the initial messages
    // plus the new assistant and tool responses.
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    
    // Check that we don't have 'call_dang' in the history anymore
    const hasDangling = history.some(msg => 
      msg.role === 'assistant' && 
      msg.tool_calls?.some(tc => tc.id === 'call_dang')
    );
    expect(hasDangling).toBe(false);
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
              function: { name: 'idle', arguments: '{}' }
            }]
          }
        }],
        usage: { total_tokens: 80 }
      }
    });

    executeTool.mockResolvedValueOnce('# Agent idling\n\nAll tasks completed.');

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
      { role: 'assistant', tool_calls: [{ id: 'call_init_idle', type: 'function', function: { name: 'idle', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_init_idle', name: 'idle', content: '# Agent idling' },
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
              function: { name: 'idle', arguments: '{}' }
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
    expect(updateTicketStatus).toHaveBeenCalledWith(ticketId, 'completed');
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool).toHaveBeenNthCalledWith(1, 'read_ticket', {}, sessionContext);
    expect(executeTool).toHaveBeenNthCalledWith(2, 'idle', {}, sessionContext);

    // Verify history file now contains the appended resumed messages
    const history = JSON.parse(readFileSync(historyFilePath, 'utf8'));
    expect(history.length).toBe(11); // 7 initial + 4 new turns (assistant, tool, assistant, tool)
    expect(history[7].role).toBe('assistant');
    expect(history[7].tool_calls[0].id).toBe('call_resume_read');
    expect(history[9].tool_calls[0].id).toBe('call_resume_idle');
  });
});


