import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { handleApiRequest } from './api/index';

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use((req: Request, res: Response, next) => {
    const rawHost = String(req.headers.host || '').split(':')[0].toLowerCase();
    const isLocalHost =
      rawHost === 'localhost' ||
      rawHost === '127.0.0.1' ||
      rawHost === '0.0.0.0' ||
      rawHost === '[::1]';
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    if (process.env.NODE_ENV === 'production' && !isLocalHost && proto === 'http' && req.headers.host) {
      res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      return;
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (proto === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  });

  app.use('/api', (req: Request, res: Response, next) => {
    void handleApiRequest(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(next);
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
