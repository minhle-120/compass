// src/utils/logger.js
import { isMainThread, threadId } from 'worker_threads';
import { errorMessage } from './errorMessage.js';

const colors = {
  reset: '\x1b[0m',
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  thread: '\x1b[35m' // Magenta
};

function formatMessage(level, message, context = '') {
  const timestamp = new Date().toISOString();
  const threadLabel = isMainThread ? '[Main]' : `[Worker-${threadId}]`;
  const contextLabel = context ? ` [${context}]` : '';
  const color = colors[level] || colors.reset;
  
  return `${colors.thread}${threadLabel}${colors.reset} ${timestamp} ${color}[${level.toUpperCase()}]${colors.reset}${contextLabel}: ${message}`;
}

export const logger = {
  debug(message, context) {
    console.log(formatMessage('debug', message, context));
  },
  info(message, context) {
    console.log(formatMessage('info', message, context));
  },
  warn(message, context) {
    console.warn(formatMessage('warn', message, context));
  },
  error(message, context, err) {
    let msg = message;
    if (err) {
      msg += ` - ${err.stack || errorMessage(err)}`;
    }
    console.error(formatMessage('error', msg, context));
  }
};
