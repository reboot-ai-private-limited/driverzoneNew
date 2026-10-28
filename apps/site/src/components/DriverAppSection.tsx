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
  { id: 1, image: '/driver-app/screen-1.webp', alt: 'DriverZone driver app — home dashboard with active trips' },
  { id: 2, image: '/driver-app/screen-2.webp', alt: 'DriverZone driver app — new booking request notification' },
  { id: 3, image: '/driver-app/screen-3.webp', alt: 'DriverZone driver app — trip details and pickup location' },
  { id: 4, image: '/driver-app/screen-4.webp', alt: 'DriverZone driver app — navigation to customer pickup point' },
  { id: 5, image: '/driver-app/screen-5.webp', alt: 'DriverZone driver app — trip in progress with live map' },
  { id: 6, image: '/driver-app/screen-6.webp', alt: 'DriverZone driver app — trip completion and earnings summary' },
  { id: 7, image: '/driver-app/screen-7.webp', alt: 'DriverZone driver app — driver profile and document status' },
  { id: 8, image: '/driver-app/screen-8.webp', alt: 'DriverZone driver app — driver profile and document status' },
  { id: 9, image: '/driver-app/screen-9.webp', alt: 'DriverZone driver app — driver profile and document status' },
  { id: 10, image: '/driver-app/screen-10.webp', alt: 'DriverZone driver app — driver profile and document status' },
  { id: 11, image: '/driver-app/screen-11.webp', alt: 'DriverZone driver app — driver profile and document status' },
];

// 40 px/s, normalised to real elapsed time — same speed at 60/90/120 Hz.
const SPEED_PX_PER_MS = 0.04;

/**
 * Infinite marquee driven by requestAnimationFrame.
 * Identical logic to CustomerAppSection — only content and ids differ.
 *
 * Item widths are percentages of the max-w-6xl container (not vw):
 *   < sm  (<640 px) : 1 visible  —  w-full
 *   sm    (640 px)  : 2 visible  —  w-1/2
 *   md    (768 px)  : 3 visible  —  w-1/3
 *   lg+   (1024 px) : 6 visible  —  w-[calc(100%/6)]
 */
export function DriverAppSection(): ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
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
    lastTsRef.current = undefined;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const newOffset = drag.current.startOffset + (e.clientX - drag.current.startX);
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

  const allScreens = [...SCREENS, ...SCREENS].map((s, i) => ({ ...s, key: `${s.id}-${i < SCREENS.length ? "a" : "b"}` }));

  return (
    <section id="driver-app" className="bg-bg-sunken">
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-10 sm:px-6">

        {/* ── Heading ──────────────────────────────────────────────────── */}
        <h2 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          How it Works for Driver App
        </h2>
        <p className="mt-2 max-w-6xl text-[15px] leading-relaxed text-muted">
          The DriverZone Driver App gives verified drivers a simple, efficient way to manage trips,
          track earnings, and stay connected with customers across Siliguri and nearby routes.
          Drivers receive instant booking notifications, navigate to pickup points with live maps,
          and complete trips with full transparency on fare breakdowns and payment status.
        </p>

        {/* ── Carousel ─────────────────────────────────────────────────── */}
        <div
          className="mt-1 overflow-hidden py-4 touch-none select-none cursor-grab active:cursor-grabbing"
          role="region"
          aria-label="Driver app screen previews"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div ref={trackRef} className="flex will-change-transform">
            {allScreens.map((screen, i) => (
              <div
                key={screen.key}
                className="flex-none w-full sm:w-1/2 md:w-1/3 lg:w-[calc(100%/6)] px-2"
                aria-hidden={i >= SCREENS.length}
              >
                <div className="w-full rounded-lg border border-border/80 bg-bg p-1">
                  <div className="relative aspect-[9/19] overflow-hidden">
                    <Image
                      src={screen.image}
                      alt={i >= SCREENS.length ? '' : screen.alt}
                      fill
                      sizes="(min-width: 1024px) 160px, (min-width: 768px) 30vw, (min-width: 640px) 45vw, 80vw"
                      quality={85}
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
