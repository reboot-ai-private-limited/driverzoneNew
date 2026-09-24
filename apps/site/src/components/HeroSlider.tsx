'use client';

import Image from 'next/image';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
} from 'react';

type Slide =
  | { id: number; image: string; alt: string }
  | { id: number; bg: string; shimmer: string };

const SLIDES: Slide[] = [
  {
    id: 1,
    image: '/herobanner/slider1.webp',
    alt: 'DriverZone drivers standing with their vehicles on a city street',
  },
  {
    id: 2,
    image: '/herobanner/slider2.webp',
    alt: 'DriverZone drivers standing with their vehicles on a city street',
  },
  {
    id: 3,
    image: '/herobanner/slider3.webp',
    alt: 'DriverZone drivers standing with their vehicles on a city street',
  },
];

const AUTO_PLAY_MS = 5_000;
const TRANSITION_MS = 700;
const DRAG_THRESHOLD = 60;

/**
 * Each slide is absolutely positioned over the same frame.
 * "Current" sits at translateX(0), the outgoing slide exits to -100%,
 * and every other slide waits off-screen at +100%.
 * No cloned slides, no wide track, no transitionend clone-jump — just
 * simple modular arithmetic on the slide index.
 */
export function HeroSlider(): ReactElement {
  const total = SLIDES.length;

  const [curr, setCurr] = useState(0);              // 0-based, visible slide
  const [exiting, setExiting] = useState<number | null>(null); // slide going left

  const drag = useRef({ active: false, startX: 0, lastX: 0 });

  // Move forward one slide (wraps around seamlessly).
  const advance = useCallback(() => {
    setCurr((c) => {
      setExiting(c);
      return (c + 1) % total;
    });
  }, [total]);

  // Move back one slide.
  const retreat = useCallback(() => {
    setCurr((c) => {
      setExiting(c);
      return (c - 1 + total) % total;
    });
  }, [total]);

  // Auto-play: restarts whenever curr changes so manual navigation resets it.
  useEffect(() => {
    const t = setTimeout(advance, AUTO_PLAY_MS);
    return () => clearTimeout(t);
  }, [curr, advance]);

  // Clear the exiting slide after its transition finishes.
  const onTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>, i: number) => {
      if (e.propertyName !== 'transform' || i !== exiting) return;
      setExiting(null);
    },
    [exiting],
  );

  // Pointer drag handlers — detect swipe direction, commit on release.
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { active: true, startX: e.clientX, lastX: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    drag.current.lastX = e.clientX;
  }, []);

  const onPointerUp = useCallback(() => {
    if (!drag.current.active) return;
    drag.current.active = false;
    const delta = drag.current.lastX - drag.current.startX;
    if (delta < -DRAG_THRESHOLD) advance();
    else if (delta > DRAG_THRESHOLD) retreat();
  }, [advance, retreat]);

  return (
    <section
      className="relative -mt-20 h-screen select-none overflow-hidden bg-black"
      aria-label="Hero slideshow"
    >
      {/* Slide stack — all slides share the same frame via absolute positioning */}
      <div
        className="relative h-full w-full touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {SLIDES.map((slide, i) => {
          const isCurrent = i === curr;
          const isExiting = i === exiting;

          // Current: on screen. Exiting: slides out to the left. All others:
          // wait off-screen to the right (invisible, no layout cost).
          const x = isCurrent ? 0 : isExiting ? -100 : 100;

          return (
            <div
              key={slide.id}
              className="absolute inset-0"
              aria-hidden={!isCurrent}
              style={{
                transform: `translateX(${x}%)`,
                // Animate only the entering and exiting slides; others snap
                // instantly so they're in position before they're ever shown.
                transition:
                  isCurrent || isExiting
                    ? `transform ${TRANSITION_MS}ms cubic-bezier(.25,.46,.45,.94)`
                    : 'none',
                zIndex: isCurrent ? 2 : isExiting ? 1 : 0,
              }}
              onTransitionEnd={(e) => onTransitionEnd(e, i)}
            >
              {'image' in slide ? (
                <Image
                  src={slide.image}
                  alt={slide.alt}
                  fill
                  sizes="100vw"
                  quality={90}
                  className="object-cover"
                  draggable={false}
                  priority={i === 0}
                  loading={i === 0 ? undefined : 'eager'}
                />
              ) : (
                <>
                  <div className="absolute inset-0" style={{ background: slide.bg }} />
                  <div className="absolute inset-0" style={{ background: slide.shimmer }} />
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Dot pagination ──────────────────────────────────────────────── */}
      <div
        className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2"
        role="tablist"
        aria-label="Slide navigation"
      >
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={i === curr}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => {
              setCurr((c) => {
                if (c === i) return c;
                setExiting(c);
                return i;
              });
            }}
            className={`h-2 rounded-pill touch-manipulation transition-all duration-300 ${
              i === curr ? 'w-6 bg-white' : 'w-2 bg-white/40 hover:bg-white/70'
            }`}
          />
        ))}
      </div>
    </section>
  );
}
