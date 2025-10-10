import 'dotenv/config';

import express from 'express';
import bodyParser from 'body-parser';

// Import routes
import taxCalculatorRouter from './routes/tax.calculator.route.js';
import { logger } from './utils/logger.utils.js';
import config from './utils/config.util.js';

// Validate environment on startup
try {
  config.readConfiguration();
  logger.info('Environment validation successful');
} catch (error) {
  logger.error('Environment validation failed:', error.message);
  process.exit(1);
}

const PORT = 8081;

// Create the express app
const app = express();

// Define configurations
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Define routes
app.use('/', taxCalculatorRouter);

// Listen the application
const server = app.listen(PORT, () => {
  logger.info(`Tax Calculator service listening on port ${PORT}`);
  logger.info('Tax Calculator service started successfully');
});

export default server;
