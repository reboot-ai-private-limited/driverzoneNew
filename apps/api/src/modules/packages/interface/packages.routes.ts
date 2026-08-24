import { Router, type RequestHandler } from 'express';

export interface PackagesRouteHandlers {
  createIncity: RequestHandler;
  listIncity: RequestHandler;
  getIncity: RequestHandler;
  updateIncity: RequestHandler;
  createOutstation: RequestHandler;
  listOutstation: RequestHandler;
  getOutstation: RequestHandler;
  updateOutstation: RequestHandler;
}

export function buildPackagesRouter(handlers: PackagesRouteHandlers): Router {
  const router = Router();

  router.post('/incity', handlers.createIncity);
  router.get('/incity', handlers.listIncity);
  router.get('/incity/:id', handlers.getIncity);
  router.put('/incity/:id', handlers.updateIncity);

  router.post('/outstation', handlers.createOutstation);
  router.get('/outstation', handlers.listOutstation);
  router.get('/outstation/:id', handlers.getOutstation);
  router.put('/outstation/:id', handlers.updateOutstation);

  return router;
}
