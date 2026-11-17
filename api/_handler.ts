import type { Express, Request, Response } from 'express';
import { handleApiRequest } from './index.js';

export function registerApiRoutes(app: Express): void {
  app.use('/api', (req: Request, res: Response, next) => {
    void handleApiRequest(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(next);
  });
}
