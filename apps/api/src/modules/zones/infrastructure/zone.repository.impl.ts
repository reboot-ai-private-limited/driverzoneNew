import mongoose from 'mongoose';
import type { LineString, NamedZone, Point } from '@driverzone/geo';
import type { Zone, ZoneType } from '../domain/zone.entity.js';
import type {
  NewZone,
  ZoneListFilter,
  ZoneMetadataPatch,
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
    parentZoneId: null,
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

  async findSiblingsOfType(type: ZoneType, excludeId?: string): Promise<NamedZone[]> {
    const query: mongoose.FilterQuery<ZoneDoc> = { type, isActive: true };
    if (excludeId !== undefined && mongoose.isValidObjectId(excludeId)) {
      query['_id'] = { $ne: new mongoose.Types.ObjectId(excludeId) };
    }
    const docs = await ZoneModel.find(query).lean().exec();
    return docs.map((doc) => ({ id: String(doc._id), name: doc.name, geom: doc.geometry }));
  }

  /** DORMANT — terrain comes from the drop point now. See `findHillZonesForRoute.usecase.ts`. */
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
        parentZoneId: null,
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

  async replaceGeometry(oldId: string, newZone: NewZone): Promise<Zone> {
    const oldObjectId = new mongoose.Types.ObjectId(oldId);
    const session = await mongoose.startSession();
    try {
      let result: Zone | undefined;

      await session.withTransaction(async () => {
        // MUST come first: the partial unique index on `code` (active zones only) would reject
        // the insert below if both versions were briefly active at once, since the new version
        // deliberately reuses the old one's code.
        await ZoneModel.updateOne(
          { _id: oldObjectId },
          { $set: { isActive: false } },
          { session },
        ).exec();

        const [created] = await ZoneModel.create(
          [
            {
              type: newZone.type,
              name: newZone.name,
              code: newZone.code,
              parentZoneId: null,
              geometry: newZone.geometry,
              priority: newZone.priority,
              pickupChargeType: newZone.pickupChargeType,
              pickupChargePaise: newZone.pickupChargePaise,
              version: newZone.version,
              createdBy: new mongoose.Types.ObjectId(newZone.createdBy),
            },
          ],
          { session },
        );
        if (created === undefined) throw new Error('replaceGeometry: insert produced no document');

        // No separate `supersededAt` field — `updatedAt` (timestamps: true) already records
        // when this write happened, and the audit entry carries the rest of the story.
        await ZoneModel.updateOne(
          { _id: oldObjectId },
          { $set: { supersededBy: created._id } },
          { session },
        ).exec();

        result = toDomain(created.toObject());
      });

      if (result === undefined) throw new Error('replaceGeometry: transaction produced no result');
      return result;
    } catch (err) {
      if (isDuplicateKeyError(err)) throw zoneCodeInUse(newZone.code);
      throw err;
    } finally {
      await session.endSession();
    }
  }

  async updateMetadata(id: string, patch: ZoneMetadataPatch): Promise<Zone | undefined> {
    if (!mongoose.isValidObjectId(id)) return undefined;

    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set['name'] = patch.name;
    if (patch.code !== undefined) set['code'] = patch.code;
    if (patch.priority !== undefined) set['priority'] = patch.priority;
    if (patch.pickupChargeType !== undefined) set['pickupChargeType'] = patch.pickupChargeType;
    if (patch.pickupChargePaise !== undefined) set['pickupChargePaise'] = patch.pickupChargePaise;

    // MongoDB rejects `{ $set: {} }` outright ("'$set' is empty") — an empty patch (a caller
    // sending `PATCH {}`) must be a no-op read, not a server error.
    if (Object.keys(set).length === 0) {
      const doc = await ZoneModel.findById(id).lean().exec();
      return doc === null ? undefined : toDomain(doc);
    }

    try {
      const updated = await ZoneModel.findByIdAndUpdate(id, { $set: set }, { new: true })
        .lean()
        .exec();
      return updated === null ? undefined : toDomain(updated);
    } catch (err) {
      if (isDuplicateKeyError(err) && patch.code !== undefined) throw zoneCodeInUse(patch.code);
      throw err;
    }
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await ZoneModel.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: { isActive } },
    ).exec();
  }

  async deleteById(id: string): Promise<void> {
    if (!mongoose.isValidObjectId(id)) return;
    await ZoneModel.deleteOne({ _id: new mongoose.Types.ObjectId(id) }).exec();
  }
}
