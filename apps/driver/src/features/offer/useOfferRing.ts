import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';
import { Vibration } from 'react-native';

/**
 * The ring itself — sound and vibration, for as long as an offer is on screen.
 *
 * A trip offer is worth nothing if the driver does not notice it. The screen alone is a silent
 * takeover that someone glancing at the road misses entirely, and the offer lapses against their
 * acceptance rate for a trip they would have taken.
 *
 * **It loops.** A single chime is a notification; a driver needs something that keeps going until
 * they answer, the way a phone call does. `player.loop = true` and a repeating vibration pattern
 * both run until this unmounts — which happens on accept, decline, expiry, or the offer being
 * withdrawn, so there is exactly one place that stops it and no path that can leave it ringing.
 *
 * **It plays through silent mode.** `playsInSilentMode` is what makes that true: a driver on duty
 * has usually silenced their phone for everything else, and an offer is the one thing that must
 * cut through. This is the software half of what the `offer-ring-v1` alarm-stream channel will do
 * natively once FCM lands (docs/LLD/driver-app.md S-9.3).
 */

/** Buzz, gap, buzz — then repeat. The `true` on `Vibration.vibrate` is what repeats it. */
const VIBRATION_PATTERN = [0, 600, 400, 600, 1200];

export function useOfferRing(active: boolean): void {
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    /**
     * The player is created here rather than through `useAudioPlayer` so it can be torn down
     * deterministically in the cleanup below. A hook-managed player outlives the effect, and an
     * offer that keeps ringing after the driver accepted it is worse than one that never rang.
     */
    void (async () => {
      try {
        await setAudioModeAsync({
          // The whole point: a silenced phone must still ring for work.
          playsInSilentMode: true,
          shouldPlayInBackground: false,
        });
      } catch {
        // An audio-mode failure must not stop the vibration or the screen. Ringing quieter than
        // intended still beats not showing the offer.
      }

      if (cancelled) return;

      try {
        /*
         * `require`, not `import`: this is Metro's asset reference, which resolves to a number
         * the native player can open. A static import of an `.mp3` gives a URL string instead,
         * which does not load from the bundle on Android.
         */
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const player = createAudioPlayer(require('../../../assets/offer_ring.mp3'));
        player.loop = true;
        player.volume = 1;
        player.play();
        playerRef.current = player;
      } catch {
        // A missing or unplayable asset should not take the offer screen down with it.
      }
    })();

    Vibration.vibrate(VIBRATION_PATTERN, true);

    return () => {
      cancelled = true;
      Vibration.cancel();

      const player = playerRef.current;
      playerRef.current = null;
      if (player === null) return;
      try {
        player.pause();
        player.remove();
      } catch {
        // Already gone. Nothing to do, and throwing here would break the unmount.
      }
    };
  }, [active]);
}
