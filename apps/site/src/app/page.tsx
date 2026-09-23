import Link from 'next/link';
import {
  CarFront,
  Clock,
  Mountain,
  Route,
  ShieldCheck,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { AppLinks } from '@/components/AppLinks';

/**
 * The home page — one scrolling document, rendered entirely on the server.
 *
 * **The copy describes what the product actually does.** Every claim below is traceable to the
 * domain model rather than invented for the page:
 *
 *   - two service types, `INCITY` and `OUTSTATION` (`packages/contracts/src/bookings.ts`);
 *   - in-city is a duration package — "a duration and a price", with `included_minutes` and
 *     explicitly NO overage (`packages/contracts/src/packages.ts`);
 *   - outstation is a DAY RATE over distance bands, one-way or round trip (same file: "the band
 *     fare is multiplied by the IST days a journey spans");
 *   - hill is a real, separately priced terrain, not a marketing flourish
 *     (`TERRAINS = ['PLAIN', 'HILL']`).
 *
 * That constraint is the point. A brochure page is the easiest place in a codebase to promise
 * something the software does not do — 24/7 cover, a driver in ten minutes, a number of drivers —
 * and the cost of it lands on support rather than here. Nothing on this page claims a figure or a
 * guarantee that is not enforced somewhere in the system.
 */
export default function HomePage(): ReactElement {
  return (
    <>
      <Hero />
      <Services />
      <HowItWorks />
      <WhyUs />
      <GetTheApp />
    </>
  );
}

function Hero(): ReactElement {
  return (
    <section className="relative overflow-hidden bg-brand">
      {/*
        A decorative wash, not an image: two soft radial shapes in the brand's own tint. It gives
        the flat yellow some depth without shipping a hero photograph — which on this palette
        would have to be colour-graded to sit against the yellow, and is the single heaviest
        asset a marketing page usually loads.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(60% 55% at 15% 20%, #fafa1e 0%, transparent 60%), radial-gradient(50% 50% at 85% 80%, #fbfbc4 0%, transparent 65%)',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-pill bg-fg/5 px-3 py-1 text-sm font-medium text-fg">
            <CarFront size={15} aria-hidden />
            Your car, our driver
          </p>

          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight text-fg sm:text-6xl">
            Professional drivers, whenever you need one.
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-fg/75">
            Book a trained driver for your own car — by the hour around the city, or by the day for
            outstation and hill journeys. You keep your car. We bring someone to drive it.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="#get-the-app"
              className="inline-flex items-center justify-center rounded-pill bg-fg px-7 py-3.5 text-base font-semibold text-on-fg transition-opacity hover:opacity-90"
            >
              Get the app
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center justify-center rounded-pill border border-fg/25 px-7 py-3.5 text-base font-semibold text-fg transition-colors hover:bg-fg/5"
            >
              How it works
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Services(): ReactElement {
  return (
    <Section
      id="services"
      eyebrow="Services"
      title="Two ways to book"
      lead="Whatever the journey, you are hiring a driver — never a cab. The car is always yours."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <ServiceCard
          icon={Clock}
          title="In the city"
          price="Hourly packages"
          body="Pick the block of time you need and the price is set before you book. School runs, a day of errands, a wedding, an evening out — the driver stays with you for the whole package."
          points={[
            'Choose the duration that fits the day',
            'Fare shown up front, before you confirm',
            'No overage billing — you buy the block, not the meter',
          ]}
        />
        <ServiceCard
          icon={Route}
          title="Outstation"
          price="Day rates"
          body="Travelling beyond the city, one way or return. Priced by distance band and by the number of days the journey covers, so a three-day trip is quoted as three days — no surprises on the way back."
          points={[
            'One-way and round trips',
            'Priced per day, agreed before departure',
            'Return-journey allowance built into the quote',
          ]}
        />
      </div>

      <div className="mt-6 flex items-start gap-4 rounded-xl border border-border bg-bg-sunken p-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand">
          <Mountain size={20} className="text-fg" aria-hidden />
        </div>
        <div>
          <h3 className="font-semibold text-fg">Hill journeys, priced separately</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
            Driving to Darjeeling or Kalimpong is not the same job as driving across the plains, so
            we do not price it as though it were. Hill routes carry their own rates and go to
            drivers cleared for them.
          </p>
        </div>
      </div>
    </Section>
  );
}

function HowItWorks(): ReactElement {
  const steps = [
    {
      title: 'Tell us the trip',
      body: 'Set your pickup point and where you are going. Choose in-city or outstation, and the date and time you need the driver.',
    },
    {
      title: 'See the fare first',
      body: 'Pick from the packages that fit your journey. The price is shown before you confirm — not calculated afterwards.',
    },
    {
      title: 'We find your driver',
      body: 'The booking goes to drivers near your pickup point. You see who accepted, and can follow them on the way to you.',
    },
    {
      title: 'Drive, then pay',
      body: 'Your driver arrives and takes the wheel. Pay by cash or online when the trip is done.',
    },
  ];

  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="Four steps, start to finish"
      tone="sunken"
    >
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-border bg-bg p-6">
            <span
              className="flex size-9 items-center justify-center rounded-pill bg-fg text-sm font-bold text-brand-on-fg"
              aria-hidden
            >
              {index + 1}
            </span>
            <h3 className="mt-4 font-semibold text-fg">
              {/* The number is decorative above, so it is repeated here for a screen reader. */}
              <span className="sr-only">Step {index + 1}: </span>
              {step.title}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function WhyUs(): ReactElement {
  const points = [
    {
      icon: ShieldCheck,
      title: 'Drivers we have checked',
      body: 'Every driver submits their licence and documents before taking a single trip, and we verify them. Expired papers take a driver off the road automatically.',
    },
    {
      icon: Wallet,
      title: 'The price you were quoted',
      body: 'Fares are set by the package you choose, and you see the full amount before confirming. Any pickup or night charge is shown in the same breakdown.',
    },
    {
      icon: Smartphone,
      title: 'You can see what is happening',
      body: 'Watch your driver approach, see their arrival time, and keep the trip details in your booking history afterwards.',
    },
  ];

  return (
    <Section eyebrow="Why DriverZone" title="Built around your own car">
      <div className="grid gap-6 md:grid-cols-3">
        {points.map((point) => (
          <div key={point.title}>
            <div className="flex size-11 items-center justify-center rounded-lg bg-brand-soft">
              <point.icon size={20} className="text-fg" aria-hidden />
            </div>
            <h3 className="mt-4 font-semibold text-fg">{point.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{point.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function GetTheApp(): ReactElement {
  return (
    <section id="get-the-app" className="bg-fg">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-on-fg sm:text-4xl">
              Book your first driver
            </h2>
            <p className="mt-4 max-w-md leading-relaxed text-on-fg/70">
              Download the DriverZone app, sign in with your phone number, and book a driver for
              today or for a date ahead.
            </p>
            <div className="mt-8">
              <AppLinks variant="onDark" audience="customer" />
            </div>
          </div>

          <div className="rounded-xl border border-white/15 bg-white/5 p-8">
            <h3 className="text-xl font-semibold text-brand-on-fg">Drive with DriverZone</h3>
            <p className="mt-3 leading-relaxed text-on-fg/70">
              Already drive for a living, or know your way around the hills? Sign up on the driver
              app, submit your documents, and start accepting trips near you once you are approved.
            </p>
            <div className="mt-6">
              <AppLinks variant="onDark" audience="driver" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The shared section shell — an eyebrow, a heading, an optional lead, and the content.
 *
 * Local to this file rather than promoted to `components/`: it encodes the rhythm of the HOME
 * page specifically, and the inner pages (`/about`, `/contact`, the legal pages) are prose
 * documents with a different shape entirely. A shared component used by exactly one file is a
 * layer of indirection with nothing on the other side of it.
 */
function Section({
  id,
  eyebrow,
  title,
  lead,
  tone = 'default',
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lead?: string;
  tone?: 'default' | 'sunken';
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className={tone === 'sunken' ? 'bg-bg-sunken' : 'bg-bg'}>
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          {title}
        </h2>
        {lead === undefined ? null : (
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{lead}</p>
        )}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function ServiceCard({
  icon: Icon,
  title,
  price,
  body,
  points,
}: {
  icon: LucideIcon;
  title: string;
  price: string;
  body: string;
  points: readonly string[];
}): ReactElement {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-bg p-8">
      <div className="flex items-center gap-4">
        <div className="flex size-12 items-center justify-center rounded-lg bg-brand">
          <Icon size={22} className="text-fg" aria-hidden />
        </div>
        <div>
          <h3 className="text-xl font-semibold text-fg">{title}</h3>
          <p className="text-sm font-medium text-muted">{price}</p>
        </div>
      </div>

      <p className="mt-5 leading-relaxed text-muted">{body}</p>

      <ul className="mt-6 space-y-2.5 border-t border-border pt-6">
        {points.map((point) => (
          <li key={point} className="flex gap-3 text-[15px] text-fg">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-fg/40" />
            {point}
          </li>
        ))}
      </ul>
    </article>
  );
}
