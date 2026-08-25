import type { ZoneDto, ZoneViolationDto } from '@driverzone/contracts';
import type { ZoneViolation } from '@driverzone/geo';
import type { Zone } from '../domain/zone.entity.js';

/** INTERFACE — domain → wire mapping, shared by both `admin.controller.ts` and `customer.controller.ts`. */

export function zoneToDto(zone: Zone): ZoneDto {
  return {
    id: zone.id,
    type: zone.type,
    name: zone.name,
    code: zone.code,
    parent_zone_id: zone.parentZoneId,
    geometry: zone.geometry,
    priority: zone.priority,
    // `pickup_charge_type` is optional-not-nullable on the wire; omit rather than send null.
    ...(zone.pickupChargeType === null ? {} : { pickup_charge_type: zone.pickupChargeType }),
    pickup_charge_paise: zone.pickupChargePaise,
    version: zone.version,
    is_active: zone.isActive,
  };
}

export function violationToDto(v: ZoneViolation): ZoneViolationDto {
  return {
    rule: v.rule,
    severity: v.severity,
    message: v.message,
    // Deliberately camelCase on the wire too — mirrors @driverzone/geo's ZoneViolation shape
    // exactly, per the comment on ZoneViolationDto in @driverzone/contracts.
    ...(v.offendingGeometry === undefined ? {} : { offendingGeometry: v.offendingGeometry }),
  };
}
