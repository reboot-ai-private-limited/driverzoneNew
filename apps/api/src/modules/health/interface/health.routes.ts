import { Router } from 'express';
import type { RequestHandler } from 'express';

export function buildHealthRouter(getHealth: RequestHandler): Router {
  const router = Router();
  router.get('/', getHealth);
  return router;
}
