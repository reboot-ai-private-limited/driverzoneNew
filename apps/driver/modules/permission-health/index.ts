import { requireOptionalNativeModule } from 'expo';

type PermissionHealthNative = {
  canUseFullScreenIntent(): boolean;
  isDndAccessGranted(): boolean;
};

/**
 * `Optional` so a JS bundle running against an older native build (an OTA-style mismatch, or
 * Expo Go) degrades to "unknown" instead of crashing at import. `null` means "cannot tell".
 */
const native = requireOptionalNativeModule<PermissionHealthNative>('PermissionHealth');

export function canUseFullScreenIntent(): boolean | null {
  try {
    return native?.canUseFullScreenIntent() ?? null;
  } catch {
    return null;
  }
}

export function isDndAccessGranted(): boolean | null {
  try {
    return native?.isDndAccessGranted() ?? null;
  } catch {
    return null;
  }
}
