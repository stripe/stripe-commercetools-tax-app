import { Router } from 'express';

import { taxHandler } from '../controllers/tax.calculator.controller.js';

const taxCalculatorRouter = Router();

taxCalculatorRouter.post('/', taxHandler);

export default taxCalculatorRouter;
