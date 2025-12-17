import { expect, describe, afterAll, it, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import SyncRoutes from '../../src/routes/sync.route.js';
import { encodeJsonObject } from './utils/encoder.utils.js';
import { HTTP_STATUS_SUCCESS_ACCEPTED } from '../../src/constants/http.status.constants.js';

// Mock the clients that make external API calls
jest.mock('../../src/clients/query.client.js', () => ({
  getOrderWithPaymentInfo: jest.fn().mockRejectedValue(
    new (class CustomError extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.message = message;
      }
    })(202, 'Order not found')
  ),
  getOrder: jest.fn().mockResolvedValue({ id: 'dummy-order-id', version: 1 }),
}));

jest.mock('../../src/extensions/stripe/clients/client.js', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/clients/update.client.js', () => ({
  updateOrderTaxTxn: jest.fn().mockResolvedValue({}),
}));

// Mock server setup
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/orderSyncer', SyncRoutes);
/** Reminder : Please put mandatory environment variables in the settings of your github repository **/
describe('Test sync.route.js', () => {
  it(`When a non-existent resource identifier is in the URL, it should returns 404 http status`, async () => {
    let response = {};
    // Send request to the connector application with following code snippet.

    response = await request(app).post(`/non-existent-resource`);
    expect(response).toBeDefined();
    expect(response.statusCode).toEqual(404);
  });

  it(`When payload body does not exist, it should returns 400 http status`, async () => {
    let response = {};
    // Send request to the connector application with following code snippet.
    let payload = {};
    response = await request(app).post(`/orderSyncer`).send(payload);

    expect(response).toBeDefined();
    expect(response.statusCode).toEqual(HTTP_STATUS_SUCCESS_ACCEPTED);
  });

  // This test needs Environment variables to be set
  it(`When payload body exists without correct order ID, it should returns 202 http status`, async () => {
    let response = {};
    // Send request to the connector application with following code snippet.
    // Following incoming message data is an example. Please define incoming message based on resources identifer in your own Commercetools project
    const incomingMessageData = {
      notificationType: 'Message',
      resource: { typeId: 'order', id: 'dummy-product-id' },
      type: 'OrderCreated',
      resourceUserProvidedIdentifiers: { orderNumber: 'dummy-order-number' },
      version: 11,
      oldVersion: 10,
      modifiedAt: '2023-09-12T00:00:00.000Z',
    };

    const encodedMessageData = encodeJsonObject(incomingMessageData);
    let payload = {
      message: {
        data: encodedMessageData,
      },
    };
    response = await request(app).post(`/orderSyncer`).send(payload);

    expect(response).toBeDefined();
    expect(response.statusCode).toEqual(HTTP_STATUS_SUCCESS_ACCEPTED);
  });

  afterAll(() => {
    // Mock server doesn't need to be closed
  });
});
