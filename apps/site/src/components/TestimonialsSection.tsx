import { User, Star } from 'lucide-react';
import type { ReactElement } from 'react';

type Testimonial = {
  id: string;
  name: string;
  rating: number;
  review: string;
};

const TESTIMONIALS: readonly Testimonial[] = [
  {
    id: 'rahul-roy',
    name: 'Rahul Roy',
    rating: 4.5,
    review:
      'Experience premium comfort with our luxury fleet, featuring well-maintained cars that provide a smooth, stylish, and stress-free travel experience in Siliguri. Experience premium comfort with our luxury fleet, featuring well-maintained cars.',
  },
  {
    id: 'piyali-ghosh',
    name: 'Piyali Ghosh',
    rating: 4.5,
    review:
      'Experience premium comfort with our luxury fleet, featuring well-maintained cars that provide a smooth, stylish, and stress-free travel experience in Siliguri. Experience premium comfort with our luxury fleet, featuring well-maintained cars.',
  },
  {
    id: 'priya-mukherjee',
    name: 'Priya Mukherjee',
    rating: 4.5,
    review:
      'Experience premium comfort with our luxury fleet, featuring well-maintained cars that provide a smooth, stylish, and stress-free travel experience in Siliguri. Experience premium comfort with our luxury fleet, featuring well-maintained cars.',
  },
  {
    id: 'arijit-agarwal',
    name: 'Arijit Agarwal',
    rating: 4.5,
    review:
      'Experience premium comfort with our luxury fleet, featuring well-maintained cars that provide a smooth, stylish, and stress-free travel experience in Siliguri. Experience premium comfort with our luxury fleet, featuring well-maintained cars.',
  },
];

export function TestimonialsSection(): ReactElement {
  return (
    <section id="testimonials" className="bg-bg">
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">

        {/* ── Heading — centered ──────────────────────────────────────── */}
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted">
            Testimonials
          </p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Reliable Driver Hire Services Siliguri
          </h2>
        </div>

        {/* ── Cards ───────────────────────────────────────────────────── */}
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TESTIMONIALS.map((t) => (
            <TestimonialCard key={t.id} testimonial={t} />
          ))}
        </div>

      </div>
    </section>
  );
}

function TestimonialCard({ testimonial }: { testimonial: Testimonial }): ReactElement {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-bg p-5 transition-all duration-300 hover:shadow-lg">

      {/* Avatar + name + stars */}
      <div className="flex items-center gap-3">
        {/* Brand-coloured avatar circle */}
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand">
          <User size={22} className="text-fg" aria-hidden />
        </span>

        <div>
          <p className="text-[16px] font-semibold text-fg">{testimonial.name}</p>
          <StarRating rating={testimonial.rating} />
        </div>
      </div>

      {/* Review text */}
      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        {testimonial.review}
      </p>

    </article>
  );
}

function StarRating({ rating }: { rating: number }): ReactElement {
  const full = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;

  return (
    <div className="mt-1 flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => {
        if (i < full) {
          // Full star
          return (
            <Star
              key={i}
              size={14}
              className="text-amber-400"
              fill="currentColor"
              aria-hidden
            />
          );
        }
        if (i === full && hasHalf) {
          // Half star — overlay technique: empty star behind, filled star clipped to 50%
          return (
            <span key={i} className="relative inline-flex" aria-hidden>
              <Star size={14} className="text-gray-200" fill="currentColor" />
              <span className="absolute inset-0 w-1/2 overflow-hidden">
                <Star size={14} className="text-amber-400" fill="currentColor" />
              </span>
            </span>
          );
        }
        // Empty star
        return (
          <Star
            key={i}
            size={14}
            className="text-gray-200"
            fill="currentColor"
            aria-hidden
          />
        );
      })}
    </div>
  );
}
