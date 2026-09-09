import mongoose from 'mongoose';
import { DutySession } from '../domain/dutySession.entity.js';
import type { DutySessionRepositoryPort } from '../domain/dutySession.repository.port.js';
import { DutySessionModel, type DutySessionDoc } from './dutySession.model.js';

function toDomain(doc: DutySessionDoc): DutySession {
  return new DutySession({
    id: String(doc._id),
    driverId: String(doc.driverId),
    startedAt: doc.startedAt,
    endedAt: doc.endedAt ?? null,
    durationMinutes: doc.durationMinutes ?? 0,
    tripsCompleted: doc.tripsCompleted ?? 0,
    earningsPaise: doc.earningsPaise ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

export class MongoDutySessionRepository implements DutySessionRepositoryPort {
  async startSession(driverId: string, startedAt = new Date()): Promise<DutySession> {
    const driverObjectId = new mongoose.Types.ObjectId(driverId);

    // If an active session is already ongoing, return it to prevent duplicate open sessions
    const existing = await DutySessionModel.findOne({
      driverId: driverObjectId,
      endedAt: null,
    });
    if (existing) {
      return toDomain(existing);
    }

    const doc = await DutySessionModel.create({
      driverId: driverObjectId,
      startedAt,
      endedAt: null,
      durationMinutes: 0,
      tripsCompleted: 0,
      earningsPaise: 0,
    });

    return toDomain(doc);
  }

  async endActiveSession(driverId: string, endedAt = new Date()): Promise<DutySession | null> {
    const driverObjectId = new mongoose.Types.ObjectId(driverId);

    const doc = await DutySessionModel.findOne({
      driverId: driverObjectId,
      endedAt: null,
    });
    if (!doc) {
      return null;
    }

    const durationMs = Math.max(0, endedAt.getTime() - doc.startedAt.getTime());
    const durationMinutes = Math.floor(durationMs / (1000 * 60));

    doc.endedAt = endedAt;
    doc.durationMinutes = durationMinutes;
    await doc.save();

    return toDomain(doc);
  }

  async getActiveSession(driverId: string): Promise<DutySession | null> {
    const driverObjectId = new mongoose.Types.ObjectId(driverId);
    const doc = await DutySessionModel.findOne({
      driverId: driverObjectId,
      endedAt: null,
    });
    return doc ? toDomain(doc) : null;
  }

  async findPaginatedByDriver(
    driverId: string,
    page: number,
    limit: number
  ): Promise<{ sessions: DutySession[]; totalItems: number }> {
    const driverObjectId = new mongoose.Types.ObjectId(driverId);
    const skip = Math.max(0, (page - 1) * limit);

    const [docs, totalItems] = await Promise.all([
      DutySessionModel.find({ driverId: driverObjectId })
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      DutySessionModel.countDocuments({ driverId: driverObjectId }).exec(),
    ]);

    return {
      sessions: docs.map(toDomain),
      totalItems,
    };
  }
}
