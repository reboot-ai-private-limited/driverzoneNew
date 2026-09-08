import mongoose, { Schema } from 'mongoose';

export interface DutySessionDoc {
  _id: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  startedAt: Date;
  endedAt?: Date | null;
  durationMinutes: number;
  tripsCompleted: number;
  earningsPaise: number;
  createdAt: Date;
  updatedAt: Date;
}

const dutySessionSchema = new Schema<DutySessionDoc>(
  {
    driverId: {
      type: Schema.Types.ObjectId,
      ref: 'Driver',
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    endedAt: {
      type: Date,
      default: null,
    },
    durationMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    tripsCompleted: {
      type: Number,
      default: 0,
      min: 0,
    },
    earningsPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: 'duty_sessions',
  }
);

dutySessionSchema.index({ driverId: 1, endedAt: 1 });
dutySessionSchema.index({ driverId: 1, startedAt: -1 });

export const DutySessionModel = mongoose.model<DutySessionDoc>(
  'DutySession',
  dutySessionSchema
);
