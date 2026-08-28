import { z } from 'zod';

/**
 * INTERFACE — Zod at the boundary, per docs/engineering/coding-standards.md.
 *
 * Deliberately shallow. The real validation of a settings value is that key's own schema in
 * `domain/setting.registry.ts`, and it cannot happen here: which schema applies depends on the
 * key, and the boundary has no business knowing that mapping. So this layer only checks that the
 * request is SHAPED like a settings patch — a map of keys to a number or a time window — and
 * `UpdateSettingsUseCase` does the per-key parse with the registry in hand.
 *
 * The alternative, a `z.discriminatedUnion` over all nineteen keys built here, would be a second
 * copy of the registry that drifts. One source of truth, applied a layer in.
 */

const timeWindow = z.object({ start: z.string(), end: z.string() });

/** Numbers are whole rupees, minutes, seconds or counts — never paise. See `domain/money.ts`. */
const settingValue = z.union([z.number(), timeWindow]);

export const patchSettingsSchema = z.object({
  values: z.record(settingValue).refine((values) => Object.keys(values).length > 0, {
    message: 'At least one setting is required',
  }),
});

export const resetSettingsSchema = z.object({
  keys: z.array(z.string()).min(1),
});

export type PatchSettingsInput = z.infer<typeof patchSettingsSchema>;
export type ResetSettingsInput = z.infer<typeof resetSettingsSchema>;
