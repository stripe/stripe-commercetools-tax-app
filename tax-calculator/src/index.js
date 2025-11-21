import 'dotenv/config';

import express from 'express';
import bodyParser from 'body-parser';

// Import routes
import taxCalculatorRouter from './routes/tax.calculator.route.js';
import addressValidationRouter from './routes/address.validation.route.js';
import { logger } from './utils/logger.utils.js';
const PORT = 8081;

// Create the express app
const app = express();

// Define configurations
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Define routes
app.use('/', taxCalculatorRouter);
app.use('/', addressValidationRouter);

// Listen the application
const server = app.listen(PORT, () => {
  logger.info(`Tax Calculator service listening on port ${PORT}`);
  logger.info('Tax Calculator service started successfully');
});

export default server;
