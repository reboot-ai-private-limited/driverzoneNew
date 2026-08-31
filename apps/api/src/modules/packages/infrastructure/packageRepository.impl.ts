import mongoose from 'mongoose';
import type { Terrain } from '@driverzone/geo';
import type {
  CreateIncityPackageData,
  CreateOutstationPackageData,
  IncityPackagePatch,
  ListOutstationFilter,
  ListPackageFilter,
  OutstationPackagePatch,
  OverlapQuery,
  PackageRepositoryPort,
} from '../domain/packageRepository.port.js';
import type { IncityPackage } from '../domain/incityPackage.entity.js';
import type { OutstationPackage } from '../domain/outstationPackage.entity.js';
import { IncityPackageModel } from './incityPackage.model.js';
import { OutstationPackageModel } from './outstationPackage.model.js';

/** INFRASTRUCTURE — the `incityPackages` and `outstationPackages` collections. */

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
      baseFarePaise: v.baseFarePaise,
      driverCommissionBps: v.driverCommissionBps,
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
    oneWayFarePaise: obj.oneWayFarePaise,
    // `?? null` and not `?? 0`: a document written before this field existed, or one where ops
    // cleared it, means "no same-day return offered" — never "the return trip is free".
    roundTripFarePaise: obj.roundTripFarePaise ?? null,
    driverCommissionBps: obj.driverCommissionBps,
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

  /**
   * The `isValidObjectId` guards on every id lookup are not defensive noise. Without them a
   * `:id` that is not an ObjectId reaches Mongoose and throws a `CastError`, which surfaces as
   * a 500 — a malformed URL reported as our fault. `null` here becomes a clean 404 in the use
   * case instead. Same guard, same reason, as `zones/infrastructure/zone.repository.impl.ts`.
   */
  async findIncityById(id: string): Promise<IncityPackage | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await IncityPackageModel.findById(id);
    return doc ? toIncityEntity(doc) : null;
  }

  async findOutstationById(id: string): Promise<OutstationPackage | null> {
    if (!mongoose.isValidObjectId(id)) return null;
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
    terrain: Terrain;
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
    /**
     * P-2, half-open on both sides so adjacent bands tile cleanly: 0–70 and 70–100 do not
     * conflict, and 70 km belongs to the second. `terrain` is the WHOLE scope — there is no
     * pickup-zone clause, and across terrains an overlap is the expected configuration, not a
     * conflict (docs/LLD/packages.md §Invariants).
     */
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

  async updateIncity(id: string, data: IncityPackagePatch): Promise<IncityPackage | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await IncityPackageModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toIncityEntity(doc) : null;
  }

  async updateOutstation(
    id: string,
    data: OutstationPackagePatch,
  ): Promise<OutstationPackage | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await OutstationPackageModel.findByIdAndUpdate(id, data, { new: true });
    return doc ? toOutstationEntity(doc) : null;
  }
}
