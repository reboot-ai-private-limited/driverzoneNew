import { describe, expect, it, vi } from 'vitest';
import { validateIncityPackageActivation } from '../src/modules/packages/domain/incityPackage.entity.js';
import { validateOutstationBand, validateOutstationPackageActivation } from '../src/modules/packages/domain/outstationPackage.entity.js';
import { CreateIncityPackageUseCase } from '../src/modules/packages/application/useCases/createIncityPackage.usecase.js';
import { CreateOutstationPackageUseCase } from '../src/modules/packages/application/useCases/createOutstationPackage.usecase.js';
import { InvalidPackageError, InvalidBandError, OverlappingBandError } from '../src/modules/packages/domain/package.errors.js';
import type { PackageRepositoryPort } from '../src/modules/packages/domain/packageRepository.port.js';

describe('Packages Module', () => {
  describe('Domain Invariants', () => {
    describe('Incity', () => {

      it('rejects an active incity package with no active variants or prices (P-3)', () => {
        const error = validateIncityPackageActivation({
          variants: [{ isActive: false, prices: [{ isActive: true }] }],
        });
        expect(error).toBe('An active incity package must have at least one active variant with an active price');

        const error2 = validateIncityPackageActivation({
          variants: [{ isActive: true, prices: [{ isActive: false }] }],
        });
        expect(error2).toBe('An active incity package must have at least one active variant with an active price');
      });

      it('accepts a valid active incity package (P-3)', () => {
        // Defaults to true when omitted
        const error = validateIncityPackageActivation({
          variants: [{ prices: [{}] }],
        });
        expect(error).toBeNull();
      });
    });

    describe('Outstation', () => {
      it('rejects an outstation band where minKm < 0 (P-4)', () => {
        const error = validateOutstationBand(-10, 100);
        expect(error).toBe('minKm must be >= 0');
      });

      it('rejects an outstation band where minKm >= maxKm (P-4)', () => {
        const error = validateOutstationBand(200, 100);
        expect(error).toBe('maxKm must be greater than minKm');

        const errorEq = validateOutstationBand(100, 100);
        expect(errorEq).toBe('maxKm must be greater than minKm');
      });

      it('accepts a valid outstation band (P-4)', () => {
        const error = validateOutstationBand(100, 200);
        expect(error).toBeNull();
      });


      it('rejects an active outstation package with no active prices (P-3)', () => {
        const error = validateOutstationPackageActivation({
          prices: [{ isActive: false }],
        });
        expect(error).toBe('An active outstation package must have at least one active price');
      });

      it('accepts a valid active outstation package (P-3)', () => {
        const error = validateOutstationPackageActivation({
          prices: [{}],
        });
        expect(error).toBeNull();
      });
    });
  });

  describe('Use Cases', () => {
    describe('CreateIncityPackageUseCase', () => {
      it('throws InvalidPackageError if activation rules fail', async () => {
        const mockRepo = { createIncity: vi.fn() } as unknown as PackageRepositoryPort;
        const useCase = new CreateIncityPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            cityZoneId: 'city_1',
            name: 'Test Package',
            pickupZoneIds: [], // Invalid
            variants: [{ label: '1hr', includedKm: 10, includedMinutes: 60, prices: [] }],
          })
        ).rejects.toThrow(InvalidPackageError);

        expect(mockRepo.createIncity).not.toHaveBeenCalled();
      });

      it('creates package when rules pass', async () => {
        const mockRepo = {
          createIncity: vi.fn().mockResolvedValue({ id: 'incity_123' }),
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateIncityPackageUseCase(mockRepo);

        const data: any = {
          cityZoneId: 'city_1',
          name: 'Test Package',
          variants: [{ label: '1hr', includedKm: 10, includedMinutes: 60, prices: [{ carCategoryId: 'car_1', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }] }],
        };

        const result = await useCase.execute(data);
        expect(result.id).toBe('incity_123');
        expect(mockRepo.createIncity).toHaveBeenCalledWith(data);
      });
    });

    describe('CreateOutstationPackageUseCase', () => {
      it('throws InvalidBandError if distance band is invalid', async () => {
        const mockRepo = {
          createOutstation: vi.fn(),
          findOverlappingBands: vi.fn(),
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
              minKm: 200,
            maxKm: 100, // Invalid
            prices: [{ carCategoryId: 'car_1', direction: 'ONE_WAY', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }],
          })
        ).rejects.toThrow(InvalidBandError);

        expect(mockRepo.findOverlappingBands).not.toHaveBeenCalled();
        expect(mockRepo.createOutstation).not.toHaveBeenCalled();
      });

      it('throws OverlappingBandError if band conflicts with existing package (P-2)', async () => {
        const mockRepo = {
          createOutstation: vi.fn(),
          findOverlappingBands: vi.fn().mockResolvedValue({ id: 'existing_pkg_id' }), // Simulates a conflict
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        await expect(
          useCase.execute({
            name: 'Weekend Getaway',
            terrain: 'PLAIN',
              minKm: 100,
            maxKm: 200,
            prices: [{ carCategoryId: 'car_1', direction: 'ONE_WAY', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }],
          })
        ).rejects.toThrow(OverlappingBandError);

        expect(mockRepo.findOverlappingBands).toHaveBeenCalledWith({
          terrain: 'PLAIN',
          minKm: 100,
          maxKm: 200,
        });
        expect(mockRepo.createOutstation).not.toHaveBeenCalled();
      });

      it('creates package when rules pass and no overlap exists', async () => {
        const mockRepo = {
          createOutstation: vi.fn().mockResolvedValue({ id: 'outstation_123' }),
          findOverlappingBands: vi.fn().mockResolvedValue(null), // No conflict
        } as unknown as PackageRepositoryPort;
        const useCase = new CreateOutstationPackageUseCase(mockRepo);

        const data: any = {
          name: 'Weekend Getaway',
          terrain: 'PLAIN',
          minKm: 100,
          maxKm: 200,
          prices: [{ carCategoryId: 'car_1', direction: 'ONE_WAY', baseFarePaise: 1000, companyCommissionValue: 10, driverCommissionValue: 10, driverCommissionType: 'PERCENT', companyCommissionType: 'PERCENT' }],
        };

        const result = await useCase.execute(data);
        expect(result.id).toBe('outstation_123');
        expect(mockRepo.findOverlappingBands).toHaveBeenCalled();
        expect(mockRepo.createOutstation).toHaveBeenCalledWith(data);
      });
    });
  });
});