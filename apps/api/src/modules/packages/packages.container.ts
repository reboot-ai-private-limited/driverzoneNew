import type { Router } from 'express';
import type { PackagesPublicContract } from './packages.public.js';
import { MongoPackageRepository } from './infrastructure/packageRepository.impl.js';
import { CreateIncityPackageUseCase } from './application/useCases/createIncityPackage.usecase.js';
import { CreateOutstationPackageUseCase } from './application/useCases/createOutstationPackage.usecase.js';
import { UpdateIncityPackageUseCase } from './application/useCases/updateIncityPackage.usecase.js';
import { UpdateOutstationPackageUseCase } from './application/useCases/updateOutstationPackage.usecase.js';
import { ListIncityPackagesUseCase } from './application/useCases/listIncityPackages.usecase.js';
import { ListOutstationPackagesUseCase } from './application/useCases/listOutstationPackages.usecase.js';
import { GetPackageByIdUseCase } from './application/useCases/getPackageById.usecase.js';
import { ResolveForTripUseCase } from './application/useCases/resolveForTrip.usecase.js';
import {
  makeCreateIncityPackageController,
  makeCreateOutstationPackageController,
  makeUpdateIncityPackageController,
  makeUpdateOutstationPackageController,
  makeListIncityPackagesController,
  makeListOutstationPackagesController,
  makeGetIncityPackageController,
  makeGetOutstationPackageController,
} from './interface/packages.controller.js';
import { buildAdminRouter } from './interface/packages.routes.js';
import { registerPackagesSwaggerPaths } from './interface/packages.swagger.js';

export interface PackagesContainer {
  contract: PackagesPublicContract;
  buildAdminRouter: () => Router;
}

export function buildPackagesContainer(): PackagesContainer {
  const repo = new MongoPackageRepository();

  const createIncity = new CreateIncityPackageUseCase(repo);
  const createOutstation = new CreateOutstationPackageUseCase(repo);
  const updateIncity = new UpdateIncityPackageUseCase(repo);
  const updateOutstation = new UpdateOutstationPackageUseCase(repo);
  const listIncity = new ListIncityPackagesUseCase(repo);
  const listOutstation = new ListOutstationPackagesUseCase(repo);
  const getById = new GetPackageByIdUseCase(repo);
  const resolveForTrip = new ResolveForTripUseCase(repo);

  registerPackagesSwaggerPaths();

  return {
    contract: {
      resolveForTrip: (input) => resolveForTrip.execute(input),
    },
    buildAdminRouter: () =>
      buildAdminRouter({
        createIncity: makeCreateIncityPackageController(createIncity),
        listIncity: makeListIncityPackagesController(listIncity),
        getIncity: makeGetIncityPackageController(getById),
        updateIncity: makeUpdateIncityPackageController(updateIncity),
        createOutstation: makeCreateOutstationPackageController(createOutstation),
        listOutstation: makeListOutstationPackagesController(listOutstation),
        getOutstation: makeGetOutstationPackageController(getById),
        updateOutstation: makeUpdateOutstationPackageController(updateOutstation),
      }),
  };
}
