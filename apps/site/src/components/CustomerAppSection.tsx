'use client';

import Image from 'next/image';
import {
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
} from 'react';

type Screen = { id: number; image: string; alt: string };

const SCREENS: readonly Screen[] = [
  { id: 1, image: '/customer-app/screen-1.webp', alt: 'DriverZone customer app — home screen with booking options' },
  { id: 2, image: '/customer-app/screen-2.webp', alt: 'DriverZone customer app — choose pickup and drop location' },
  { id: 3, image: '/customer-app/screen-3.webp', alt: 'DriverZone customer app — select package and duration' },
  { id: 4, image: '/customer-app/screen-4.webp', alt: 'DriverZone customer app — available drivers near you' },
  { id: 5, image: '/customer-app/screen-5.webp', alt: 'DriverZone customer app — live trip tracking on map' },
  { id: 6, image: '/customer-app/screen-6.webp', alt: 'DriverZone customer app — fare summary and payment' },
  { id: 7, image: '/customer-app/screen-7.webp', alt: 'DriverZone customer app — rate your driver' },
  { id: 8, image: '/customer-app/screen-8.webp', alt: 'DriverZone customer app — rate your driver' },
  { id: 9, image: '/customer-app/screen-9.webp', alt: 'DriverZone customer app — rate your driver' },
];

// Continuous speed: 40 px/s, normalised to real elapsed time so it looks the
// same at 60 Hz, 90 Hz, and 120 Hz displays.
const SPEED_PX_PER_MS = 0.04;

/**
 * Infinite marquee driven by requestAnimationFrame.
 *
 * The track holds the original slides + an exact duplicate. When the offset
 * reaches -setWidth (half the track) we add setWidth back — this snaps to
 * the identical-looking duplicate and the loop is seamless.
 *
 * Dragging pauses the auto-advance without stopping the RAF loop, so the
 * transform keeps being applied on every frame and there is no jank on
 * release.
 *
 * Item widths are percentages of the max-w-6xl container (not vw), so the
 * carousel never bleeds beyond the section bounds:
 *   < sm  (<640 px) : 1 visible  —  w-full
 *   sm    (640 px)  : 2 visible  —  w-1/2
 *   md    (768 px)  : 3 visible  —  w-1/3
 *   lg+   (1024 px) : 6 visible  —  w-[calc(100%/6)]
 */
export function CustomerAppSection(): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);           // current translateX in px (≤ 0)
  const drag = useRef({ active: false, startX: 0, startOffset: 0 });
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const getSetWidth = (): number => {
      const firstItem = track.children[0] as HTMLElement | undefined;
      return firstItem ? firstItem.offsetWidth * SCREENS.length : 0;
    };

    const tick = (ts: DOMHighResTimeStamp) => {
      if (!drag.current.active) {
        if (lastTsRef.current !== undefined) {
          offsetRef.current -= (ts - lastTsRef.current) * SPEED_PX_PER_MS;
        }

        // Seamless loop: when we've scrolled one full set, jump back.
        const setWidth = getSetWidth();
        if (setWidth > 0 && offsetRef.current <= -setWidth) {
          offsetRef.current += setWidth;
        }
      }

      lastTsRef.current = ts;
      track.style.transform = `translateX(${offsetRef.current}px)`;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { active: true, startX: e.clientX, startOffset: offsetRef.current };
    lastTsRef.current = undefined; // reset timestamp so auto-play restarts cleanly
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const newOffset = drag.current.startOffset + (e.clientX - drag.current.startX);

    // Normalise so we never travel forward of origin or lag behind by more
    // than one set — keeps the duplicate-based loop from breaking during drag.
    const track = trackRef.current;
    if (track) {
      const firstItem = track.children[0] as HTMLElement | undefined;
      if (firstItem) {
        const setWidth = firstItem.offsetWidth * SCREENS.length;
        if (setWidth > 0) {
          offsetRef.current = ((newOffset % setWidth) - setWidth) % setWidth;
          return;
        }
      }
    }
    offsetRef.current = newOffset;
  }, []);

  const onPointerUp = useCallback(() => {
    drag.current.active = false;
  }, []);

  // Render original + duplicate so the seamless-loop jump is invisible.
  const allScreens = [...SCREENS, ...SCREENS];

  return (
    <section id="customer-app" className="bg-bg">
      <div className="mx-auto max-w-6xl px-4 pt-6 pb-6 sm:px-6">

        {/* ── Heading ──────────────────────────────────────────────────── */}
        <h2 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Trusted Drivers. Reliable Travel. Always.
        </h2>
        <p className="mt-1 max-w-6xl text-[15px] leading-relaxed text-muted">
          DriverZone makes professional driver booking simple, secure, and convenient for customers
          across Siliguri and nearby travel routes. Through the Customer App, users can quickly sign
          up using mobile OTP verification, enter pickup and drop locations, and instantly view
          available driver packages based on travel type and distance.
        </p>

        {/* ── Carousel ──────────────────────────────────────────────────
          Constrained to the max-w-6xl container — no full-bleed stretching.
          overflow-hidden clips the track at the container edges.
          py-8 gives drop-shadow-xl room before the clip boundary.
          touch-none prevents the browser scroll from eating pointer events.
        ──────────────────────────────────────────────────────────────── */}
        <div
          className="mt-1 overflow-hidden py-4 touch-none select-none cursor-grab active:cursor-grabbing"
          role="region"
          aria-label="Customer app screen previews"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={trackRef} className="flex will-change-transform">
            {allScreens.map((screen, i) => (
              <div
                key={i}
                // % widths are relative to the container, not the viewport.
                //   mobile (<sm)  : w-full          → 1 visible
                //   sm  (640 px)  : w-1/2            → 2 visible
                //   md  (768 px)  : w-1/3            → 3 visible
                //   lg+ (1024 px) : w-[calc(100%/6)] → 6 visible
                className="flex-none w-full sm:w-1/2 md:w-1/3 lg:w-[calc(100%/6)] px-2"
                aria-hidden={i >= SCREENS.length}
              >
                {/*
                  Card: outer shell gives the white border + shadow.
                  Inner div fixes portrait ratio (9:19 ≈ modern phone) with
                  `aspect-[9/19]` so the card is always tall regardless of
                  the source image's own dimensions. Image uses `fill` +
                  `object-contain` so the full screenshot is always visible.
                */}
                <div className="w-full rounded-lg border border-border/80 bg-bg p-1">
                  <div className="relative aspect-[9/19] overflow-hidden">
                    <Image
                      src={screen.image}
                      alt={i >= SCREENS.length ? '' : screen.alt}
                      fill
                      sizes="(min-width: 1024px) 160px, (min-width: 768px) 30vw, (min-width: 640px) 45vw, 80vw"
                      className="object-cover"
                      draggable={false}
                      priority={i === 0}
                      loading={i === 0 ? undefined : 'eager'}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
}
