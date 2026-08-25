import type {
  PackageRepositoryPort,
  CreateIncityPackageData,
  CreateOutstationPackageData,
  ListPackageFilter,
  ListOutstationFilter,
  OverlapQuery,
} from '../domain/packageRepository.port.js';
import type { IncityPackage, CommissionType } from '../domain/incityPackage.entity.js';
import type { OutstationPackage, Direction } from '../domain/outstationPackage.entity.js';
import type { Terrain } from '@driverzone/geo';
import { IncityPackageModel } from './incityPackage.model.js';
import { OutstationPackageModel } from './outstationPackage.model.js';

function toIncityEntity(doc: InstanceType<typeof IncityPackageModel>): IncityPackage {
  const obj = doc.toObject();
  return {
    id: String(obj._id),
    cityZoneId: String(obj.cityZoneId),
    name: obj.name,
    description: obj.description ? obj.description : undefined,
    variants: obj.variants.map((v) => ({
      id: String(v._id),
      label: v.label,
      includedMinutes: v.includedMinutes,
      includedKm: v.includedKm,
      enforceDropInCity: v.enforceDropInCity,
      prices: v.prices.map((p) => ({
        id: String(p._id),
        carCategoryId: String(p.carCategoryId),
        baseFarePaise: p.baseFarePaise,
        extraMinuteRatePaise: p.extraMinuteRatePaise,
                nightChargePaise: p.nightChargePaise,
        driverCommissionType: p.driverCommissionType as CommissionType,
        driverCommissionValue: p.driverCommissionValue,
        companyCommissionType: p.companyCommissionType as CommissionType,
        companyCommissionValue: p.companyCommissionValue,
        isActive: p.isActive,
      })),
      sortOrder: v.sortOrder,
      isActive: v.isActive,
    })),
    isActive: obj.isActive,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

function toOutstationEntity(doc: InstanceType<typeof OutstationPackageModel>): OutstationPackage {
  const obj = doc.toObject();
  return {
    id: String(obj._id),
    name: obj.name,
    terrain: obj.terrain as Terrain,
    minKm: obj.minKm,
    maxKm: obj.maxKm,
    prices: obj.prices.map((p) => ({
      id: String(p._id),
      carCategoryId: String(p.carCategoryId),
      direction: p.direction as Direction,
      baseFarePaise: p.baseFarePaise,
      extraKmRatePaise: p.extraKmRatePaise,
      driverAllowancePaise: p.driverAllowancePaise,
      driverCommissionType: p.driverCommissionType as CommissionType,
      driverCommissionValue: p.driverCommissionValue,
      companyCommissionType: p.companyCommissionType as CommissionType,
      companyCommissionValue: p.companyCommissionValue,
      isActive: p.isActive,
    })),
    isActive: obj.isActive,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

export class MongoPackageRepository implements PackageRepositoryPort {
  async createIncity(data: CreateIncityPackageData): Promise<IncityPackage> {
    const doc = await IncityPackageModel.create(data);
    return toIncityEntity(doc);
  }

  async createOutstation(data: CreateOutstationPackageData): Promise<OutstationPackage> {
    const doc = await OutstationPackageModel.create(data);
    return toOutstationEntity(doc);
  }

  async findIncityById(id: string): Promise<IncityPackage | null> {
    const doc = await IncityPackageModel.findById(id);
    return doc ? toIncityEntity(doc) : null;
  }

  async findOutstationById(id: string): Promise<OutstationPackage | null> {
    const doc = await OutstationPackageModel.findById(id);
    return doc ? toOutstationEntity(doc) : null;
  }

  async listIncity(filter: ListPackageFilter): Promise<IncityPackage[]> {
    const query: Record<string, unknown> = {};
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    const docs = await IncityPackageModel.find(query).sort({ createdAt: -1 });
    return docs.map(toIncityEntity);
  }

  async listOutstation(filter: ListOutstationFilter): Promise<OutstationPackage[]> {
    const query: Record<string, unknown> = {};
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    if (filter.terrain) query.terrain = filter.terrain;
    const docs = await OutstationPackageModel.find(query).sort({ createdAt: -1 });
    return docs.map(toOutstationEntity);
  }

  async findIncityForQuote(query: {
    cityZoneId: string;
  }): Promise<IncityPackage[]> {
    const docs = await IncityPackageModel.find({
      cityZoneId: query.cityZoneId,
      isActive: true,
    });
    return docs.map(toIncityEntity);
  }

  async findOutstationForQuote(query: {
    terrain: string;
    distanceKm: number;
  }): Promise<OutstationPackage[]> {
    const docs = await OutstationPackageModel.find({
      terrain: query.terrain,
      minKm: { $lte: query.distanceKm },
      maxKm: { $gt: query.distanceKm },
      isActive: true,
    });
    return docs.map(toOutstationEntity);
  }

  async findOverlappingBands(query: OverlapQuery): Promise<OutstationPackage | null> {
    const filter: Record<string, unknown> = {
      isActive: true,
      terrain: query.terrain,
      minKm: { $lt: query.maxKm },
      maxKm: { $gt: query.minKm },
    };
    if (query.excludeId) filter._id = { $ne: query.excludeId };
    const doc = await OutstationPackageModel.findOne(filter);
    return doc ? toOutstationEntity(doc) : null;
  }

  async updateIncity(
    id: string,
    data: Partial<CreateIncityPackageData>,
  ): Promise<IncityPackage | null> {
    const doc = await IncityPackageModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toIncityEntity(doc) : null;
  }

  async updateOutstation(
    id: string,
    data: Partial<CreateOutstationPackageData>,
  ): Promise<OutstationPackage | null> {
    const doc = await OutstationPackageModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toOutstationEntity(doc) : null;
  }
}
