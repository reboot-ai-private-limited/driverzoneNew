import type { RequestHandler } from 'express';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { CreateIncityPackageUseCase } from '../application/useCases/createIncityPackage.usecase.js';
import type { CreateOutstationPackageUseCase } from '../application/useCases/createOutstationPackage.usecase.js';
import type { UpdateIncityPackageUseCase } from '../application/useCases/updateIncityPackage.usecase.js';
import type { UpdateOutstationPackageUseCase } from '../application/useCases/updateOutstationPackage.usecase.js';
import type { ListIncityPackagesUseCase } from '../application/useCases/listIncityPackages.usecase.js';
import type { ListOutstationPackagesUseCase } from '../application/useCases/listOutstationPackages.usecase.js';
import type { GetPackageByIdUseCase } from '../application/useCases/getPackageById.usecase.js';
import {
  createIncityPackageSchema,
  createOutstationPackageSchema,
  updateIncityPackageSchema,
  updateOutstationPackageSchema,
  listPackagesQuerySchema,
  listOutstationQuerySchema,
  packageIdParamSchema,
} from './packages.validation.js';

export function makeCreateIncityPackageController(
  useCase: CreateIncityPackageUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const data = createIncityPackageSchema.parse(req.body);
    const pkg = await useCase.execute(data);
    sendSuccess(req, res, pkg, 'Incity package created', 201);
  });
}

export function makeCreateOutstationPackageController(
  useCase: CreateOutstationPackageUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const data = createOutstationPackageSchema.parse(req.body);
    const pkg = await useCase.execute(data);
    sendSuccess(req, res, pkg, 'Outstation package created', 201);
  });
}

export function makeUpdateIncityPackageController(
  useCase: UpdateIncityPackageUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = packageIdParamSchema.parse(req.params);
    const data = updateIncityPackageSchema.parse(req.body);
    const pkg = await useCase.execute(id, data as unknown as Parameters<typeof useCase.execute>[1]);
    sendSuccess(req, res, pkg, 'Incity package updated', 200);
  });
}

export function makeUpdateOutstationPackageController(
  useCase: UpdateOutstationPackageUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = packageIdParamSchema.parse(req.params);
    const data = updateOutstationPackageSchema.parse(req.body);
    const pkg = await useCase.execute(id, data as unknown as Parameters<typeof useCase.execute>[1]);
    sendSuccess(req, res, pkg, 'Outstation package updated', 200);
  });
}

export function makeListIncityPackagesController(
  useCase: ListIncityPackagesUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const filter = listPackagesQuerySchema.parse(req.query);
    const packages = await useCase.execute(filter);
    sendSuccess(req, res, packages, 'Incity packages');
  });
}

export function makeListOutstationPackagesController(
  useCase: ListOutstationPackagesUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const filter = listOutstationQuerySchema.parse(req.query);
    const packages = await useCase.execute(filter);
    sendSuccess(req, res, packages, 'Outstation packages');
  });
}

export function makeGetIncityPackageController(
  useCase: GetPackageByIdUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = packageIdParamSchema.parse(req.params);
    const pkg = await useCase.execute(id, 'INCITY');
    sendSuccess(req, res, pkg, 'Incity package');
  });
}

export function makeGetOutstationPackageController(
  useCase: GetPackageByIdUseCase,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const { id } = packageIdParamSchema.parse(req.params);
    const pkg = await useCase.execute(id, 'OUTSTATION');
    sendSuccess(req, res, pkg, 'Outstation package');
  });
}
