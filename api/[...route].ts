import express from 'express';
import { registerApiRoutes } from './_handler';

const app = express();
registerApiRoutes(app);

export default app;
