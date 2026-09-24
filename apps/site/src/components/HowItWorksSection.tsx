import type { ReactElement, ReactNode } from 'react';

const STEPS = [
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
] as const;

export function HowItWorksSection(): ReactElement {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="Four steps, start to finish"
      tone="sunken"
    >
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-border bg-bg p-6">
            <span
              className="flex size-9 items-center justify-center rounded-pill bg-fg text-sm font-bold text-brand-on-fg"
              aria-hidden
            >
              {index + 1}
            </span>
            <h3 className="mt-4 font-semibold text-fg">
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

function Section({
  id,
  eyebrow,
  title,
  tone = 'default',
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  tone?: 'default' | 'sunken';
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className={tone === 'sunken' ? 'bg-bg-sunken' : 'bg-bg'}>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          {title}
        </h2>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}
