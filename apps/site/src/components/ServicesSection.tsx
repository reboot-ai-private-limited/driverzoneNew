import { Clock, Mountain, Route, type LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

export function ServicesSection(): ReactElement {
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
