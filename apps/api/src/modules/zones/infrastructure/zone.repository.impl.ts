import mongoose from 'mongoose';
import type { LineString, NamedZone, Point } from '@driverzone/geo';
import type { Zone, ZoneType } from '../domain/zone.entity.js';
import type {
  NewZone,
  ZoneListFilter,
  ZoneRepositoryPort,
} from '../domain/zone.repository.port.js';
import { zoneCodeInUse } from '../domain/zone.errors.js';
import { type ZoneDoc, ZoneModel } from './zone.model.js';

function toDomain(doc: ZoneDoc): Zone {
  return {
    id: String(doc._id),
    type: doc.type,
    name: doc.name,
    code: doc.code,
    parentZoneId: doc.parentZoneId ? String(doc.parentZoneId) : null,
    geometry: doc.geometry,
    priority: doc.priority,
    pickupChargeType: doc.pickupChargeType ?? null,
    pickupChargePaise: doc.pickupChargePaise ?? null,
    version: doc.version,
    supersededBy: doc.supersededBy ? String(doc.supersededBy) : null,
    isActive: doc.isActive,
    createdBy: String(doc.createdBy),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 11000;

export class MongoZoneRepository implements ZoneRepositoryPort {
  async findMany(filter: ZoneListFilter): Promise<Zone[]> {
    const query: mongoose.FilterQuery<ZoneDoc> = { isActive: filter.isActive ?? true };
    if (filter.type !== undefined) query['type'] = filter.type;
    if (filter.parentZoneId !== undefined) {
      if (!mongoose.isValidObjectId(filter.parentZoneId)) return [];
      query['parentZoneId'] = new mongoose.Types.ObjectId(filter.parentZoneId);
    }

    const docs = await ZoneModel.find(query).lean().exec();
    return docs.map(toDomain);
  }

  async findContaining(point: Point): Promise<Zone[]> {
    const docs = await ZoneModel.find({
      isActive: true,
      geometry: { $geoIntersects: { $geometry: point } },
    })
      .sort({ priority: -1 })
      .lean()
      .exec();
    return docs.map(toDomain);
  }

  async findById(id: string): Promise<Zone | undefined> {
    if (!mongoose.isValidObjectId(id)) return undefined;
    const doc = await ZoneModel.findById(id).lean().exec();
    return doc === null ? undefined : toDomain(doc);
  }

  async findByCode(code: string): Promise<Zone | undefined> {
    const doc = await ZoneModel.findOne({ code, isActive: true }).lean().exec();
    return doc === null ? undefined : toDomain(doc);
  }

  async findChildren(parentZoneId: string): Promise<Zone[]> {
    if (!mongoose.isValidObjectId(parentZoneId)) return [];
    const docs = await ZoneModel.find({
      parentZoneId: new mongoose.Types.ObjectId(parentZoneId),
      isActive: true,
    })
      .lean()
      .exec();
    return docs.map(toDomain);
  }

  async findSiblingsOfType(type: ZoneType, excludeId?: string): Promise<NamedZone[]> {
    const query: mongoose.FilterQuery<ZoneDoc> = { type, isActive: true };
    if (excludeId !== undefined && mongoose.isValidObjectId(excludeId)) {
      query['_id'] = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }
    const docs = await ZoneModel.find(query).lean().exec();
    return docs.map((doc) => ({ id: String(doc._id), name: doc.name, geom: doc.geometry }));
  }

  async findHillZonesIntersecting(route: LineString): Promise<Zone[]> {
    const docs = await ZoneModel.find({
      isActive: true,
      type: 'HILL',
      geometry: { $geoIntersects: { $geometry: route } },
    })
      .lean()
      .exec();
    return docs.map(toDomain);
  }

  async save(zone: NewZone): Promise<Zone> {
    try {
      const created = await ZoneModel.create({
        type: zone.type,
        name: zone.name,
        code: zone.code,
        parentZoneId: zone.parentZoneId ? new mongoose.Types.ObjectId(zone.parentZoneId) : null,
        geometry: zone.geometry,
        priority: zone.priority,
        pickupChargeType: zone.pickupChargeType,
        pickupChargePaise: zone.pickupChargePaise,
        version: zone.version,
        createdBy: new mongoose.Types.ObjectId(zone.createdBy),
      });
      return toDomain(created.toObject());
    } catch (err) {
      if (isDuplicateKeyError(err)) throw zoneCodeInUse(zone.code);
      throw err;
    }
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    // No separate `supersededAt` field — `updatedAt` (timestamps: true) already records when
    // this write happened, and the audit entry on the new version carries the rest of the story.
    await ZoneModel.updateOne(
      { _id: new mongoose.Types.ObjectId(oldId) },
      { $set: { isActive: false, supersededBy: new mongoose.Types.ObjectId(newId) } },
    ).exec();
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await ZoneModel.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { isActive } },
    ).exec();
  }

  async deleteById(id: string): Promise<void> {
    await ZoneModel.deleteOne({ _id: new mongoose.Types.ObjectId(id) }).exec();
  }
}
