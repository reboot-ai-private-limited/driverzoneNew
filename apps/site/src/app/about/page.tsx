import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PageHero } from '@/components/PageHero';

export const metadata: Metadata = {
  title: 'About',
  description:
    'DriverZone connects people who own a car with trained drivers for hire — by the hour in the city, or by the day for outstation and hill journeys.',
};

/**
 * `/about`.
 *
 * Kept deliberately short and free of the things an about page usually invents: no founding year,
 * no headcount, no "thousands of happy customers", no mission statement written in the passive
 * voice. None of those are knowable from the codebase, and a number published here is a number
 * somebody has to keep true.
 *
 * What it does say is what the product is and who it is for, which is genuinely useful to a
 * customer deciding whether this is a taxi service (it is not) and to a driver deciding whether
 * to sign up.
 */
export default function AboutPage(): ReactElement {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Drivers for the car you already own"
        lead="DriverZone is a driver-on-hire service. You keep your own car, and we bring a trained driver to it."
      />

      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="space-y-6 text-[17px] leading-relaxed text-muted">
          <p>
            Plenty of journeys do not need a taxi. The car is in the driveway, it is the one the
            family is comfortable in, and the only thing missing is somebody to drive it — because
            the trip is long, because the roads are unfamiliar, because of an evening out, or
            simply because driving it yourself is the part of the day you would rather skip.
          </p>
          <p>
            That is the whole of what we do. A customer books a driver for a stretch of time or for
            a journey; a driver near them takes the job; the car never leaves its owner. It is a
            straightforward service, and most of the work is in making it dependable — that the
            driver turns up, that they can actually drive the route, and that the fare is the one
            that was quoted.
          </p>

          <h2 className="pt-6 text-2xl font-bold tracking-tight text-fg">Where we operate</h2>
          <p>
            We are based in Siliguri and serve North Bengal, including the hill routes towards
            Darjeeling and Kalimpong. Hill driving is priced and staffed separately from the
            plains — it is a different skill, and we do not pretend otherwise.
          </p>

          <h2 className="pt-6 text-2xl font-bold tracking-tight text-fg">
            How we treat our drivers
          </h2>
          <p>
            Drivers are paid a set amount for each job, agreed before they accept it, rather than a
            percentage that moves with surcharges they had no part in. If a journey runs to three
            days, they are paid for three days. Documents are verified before a driver takes their
            first trip, and a driver whose licence has lapsed stops receiving work until it is
            renewed.
          </p>

          <h2 className="pt-6 text-2xl font-bold tracking-tight text-fg">Getting in touch</h2>
          <p>
            Questions about a booking, a fare or becoming a driver are all welcome on the{' '}
            <a href="/contact" className="font-medium text-link underline underline-offset-4">
              contact page
            </a>
            .
          </p>
        </div>
      </div>
    </>
  );
}
