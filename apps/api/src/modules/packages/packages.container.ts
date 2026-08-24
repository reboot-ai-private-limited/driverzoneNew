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
import { buildPackagesRouter } from './interface/packages.routes.js';

export interface PackagesContainer {
  contract: PackagesPublicContract;
  buildRouter: () => Router;
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

  return {
    contract: {
      findIncityPackages: (query) => repo.findIncityForQuote(query),
      findOutstationPackage: (query) => repo.findOutstationForQuote(query),
    },
    buildRouter: () =>
      buildPackagesRouter({
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
