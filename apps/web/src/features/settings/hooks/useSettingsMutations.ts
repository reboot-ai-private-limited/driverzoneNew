'use client';

import type {
  PatchSettingsRequest,
  PatchSettingsResponse,
  ResetSettingsResponse,
} from '@driverzone/contracts';
import { settingsApi } from '@/lib/api/endpoints/settings';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * The two settings writes. They are two hooks and not one because the API splits them, and the
 * split is not cosmetic: a PATCH stores an override, a reset DELETES one so the built-in default
 * takes over. PATCHing the default value back would look identical on screen and behave
 * differently forever after — it stores a row saying "deliberately 30", which a later change to
 * the shipped default would silently fail to reach.
 *
 * Both invalidate `keys.settings.all()`. A save can change several keys at once, and after a
 * reset a field's `is_overridden`, `updated_at` and `updated_by` are all different too.
 *
 * No success toast on either: the caller needs to reseed its drafts from the server's answer
 * before anything is confirmed, and it toasts there. Errors still toast, via `useApiMutation` —
 * but the settings faults also carry field-level detail, and the screen maps that onto the boxes
 * at fault (see `lib/draft.ts` §mapFieldErrors) rather than leaving a nineteen-field page with
 * one message floating at the top of it.
 */
export function useUpdateSettings(onSaved?: (result: PatchSettingsResponse) => void) {
  return useApiMutation<PatchSettingsRequest, PatchSettingsResponse>({
    call: (token, body) => settingsApi.update(token, body),
    invalidates: [keys.settings.all()],
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}

export function useResetSettings(onReset?: (result: ResetSettingsResponse) => void) {
  return useApiMutation<string[], ResetSettingsResponse>({
    call: (token, resetKeys) => settingsApi.reset(token, { keys: resetKeys }),
    invalidates: [keys.settings.all()],
    ...(onReset === undefined ? {} : { onSuccess: onReset }),
  });
}
