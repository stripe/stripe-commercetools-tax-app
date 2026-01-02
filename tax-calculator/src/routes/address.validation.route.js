import { Router } from 'express';
import { validateAddressHandler } from '../controllers/address.validation.controller.js';

const addressValidationRouter = Router();

addressValidationRouter.post(
    '/validateAddress',
    validateAddressHandler
);

export default addressValidationRouter;