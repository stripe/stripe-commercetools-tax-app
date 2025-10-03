import { Router } from 'express';

import { syncHandler, syncRawHandler } from '../controllers/sync.controller.js';

const syncRouter = Router();

syncRouter.post('/orderSyncer', syncHandler);
syncRouter.post('/', syncRawHandler);

export default syncRouter;
