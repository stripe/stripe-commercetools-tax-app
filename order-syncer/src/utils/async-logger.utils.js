import { createApplicationLogger } from '@commercetools-backend/loggers';

/**
 * Async Logger Wrapper (Fire-and-Forget)
 * 
 * Processes logs asynchronously without blocking the main thread.
 * Uses setImmediate() for maximum performance and minimum overhead.
 */
class AsyncLogger {
  constructor(baseLogger) {
    this.baseLogger = baseLogger;
  }

  /**
   * Fire-and-forget logging
   * Does not block, processes in the next tick of the event loop
   * 
   * @param {string} level - The log level
   * @param {string} message - The log message
   * @param {object} meta - The log metadata
   * @returns {void}
   */
  logAsync(level, message, meta) {
    setImmediate(() => {
      try {
        this.baseLogger[level](message, meta);
      } catch (error) {
        // If it fails, try to log the error
        try {
          this.baseLogger.error('Logging error', { 
            originalLevel: level,
            error: error.message 
          });
        } catch (e) {
          // Throw the error if it fails to log the error
        }
      }
    });
  }

  /**
   * Log an info message
   * @param {string} message - The log message
   * @param {object} meta - The log metadata
   * @returns {void}
   */
  info(message, meta) {
    this.logAsync('info', message, meta);
  }

  /**
   * Log an error message
   * @param {string} message - The log message
   * @param {object} meta - The log metadata
   * @returns {void}
   */
  error(message, meta) {
    this.logAsync('error', message, meta);
  }

  /**
   * Log a warning message
   * @param {string} message - The log message
   * @param {object} meta - The log metadata
   * @returns {void}
   */
  warn(message, meta) {
    this.logAsync('warn', message, meta);
  }

  /**
   * Log a debug message
   * @param {string} message - The log message
   * @param {object} meta - The log metadata
   * @returns {void}
   */
  debug(message, meta) {
    this.logAsync('debug', message, meta);
  }
}

// Create the base commercetools logger
const baseLogger = createApplicationLogger();

// Create the asynchronous wrapper
export const logger = new AsyncLogger(baseLogger);

// Export the base logger for direct access
export { baseLogger };