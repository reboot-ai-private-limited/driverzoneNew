import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'The terms you agree to when you book a driver through DriverZone or drive using the DriverZone Driver app.',
};

/**
 * `/terms`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ A DRAFT, AND MORE OF ONE THAN THE PRIVACY POLICY IS.                                     │
 * │                                                                                           │
 * │ The privacy policy could be written from the code, because what an app collects is a fact │
 * │ about the software. Terms are not: cancellation charges, waiting-time rules, liability    │
 * │ limits and driver payout timing are BUSINESS decisions, and most of them have not been    │
 * │ made. Everywhere one is needed the text says what the rule is about and leaves the figure │
 * │ to you — marked with a TODO in the source rather than a made-up number on the page.       │
 * │                                                                                           │
 * │ Do not publish this without a lawyer. It is a structure to fill in, not an agreement.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */
export default function TermsPage(): ReactElement {
  return (
    <LegalPage
      title="Terms & Conditions"
      lead="These terms apply when you book a driver through DriverZone, and when you drive using the DriverZone Driver app."
    >
      <LegalSection title="What DriverZone is">
        <p>
          DriverZone connects people who own a vehicle with drivers available for hire. We provide
          the driver; we do not provide the vehicle, and we are not a taxi or transport operator.
          The vehicle used on any trip is yours, and it remains your responsibility throughout.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You need an account to book. It is tied to your phone number, verified by a one-time
          code, and it is personal to you — do not let someone else book on it. You must be 18 or
          over. Keep your details accurate; we use your phone number to reach you about a trip in
          progress.
        </p>
      </LegalSection>

      <LegalSection title="Bookings and fares">
        <ul>
          <li>
            <strong>The fare is shown before you confirm.</strong> In-city bookings are sold as a
            package of time at a fixed price. Outstation bookings are priced by distance band and
            by the number of days the journey covers.
          </li>
          <li>
            <strong>Extras are shown in the same breakdown</strong> — a paid pickup zone or a night
            charge, where they apply — so the total you confirm is the total you owe.
          </li>
          <li>
            <strong>A booking is confirmed when a driver accepts it</strong>, not when you submit
            it. If no driver accepts, nothing is charged.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Cancellations and waiting time">
        <p>
          You can cancel a booking. A cancellation after a driver has accepted and started
          travelling to you may carry a charge, because the driver has already given up other work
          and covered distance to reach you.
        </p>
        {/*
          TODO (business): state the actual rules. At minimum —
            • the free-cancellation window (before acceptance? N minutes after?),
            • the cancellation fee itself,
            • how long a driver waits at pickup before the booking is treated as a no-show,
            • what a customer no-show is charged.
          The apps already speak of "how cancellation fees apply"; this page is where the numbers
          belong, and support cannot enforce a rule that was never published.
        */}
        <p>
          Your driver will wait at the pickup point for a reasonable period. If you do not arrive
          and cannot be reached, the booking may be cancelled and treated as a no-show.
        </p>
      </LegalSection>

      <LegalSection title="Payment">
        <p>
          Pay by cash to your driver, or online through the app. Online payments are handled by our
          payment provider; we do not receive or store your card or UPI details. Where a payment
          fails or is reversed, the amount remains owed.
        </p>
      </LegalSection>

      <LegalSection title="Your responsibilities as a vehicle owner">
        <p>This is the section most specific to a driver-on-hire service, and it matters:</p>
        <ul>
          <li>
            <strong>The vehicle must be legal and roadworthy</strong> — valid registration, valid
            insurance, and in a condition safe to drive.
          </li>
          <li>
            <strong>Your insurance is what covers the vehicle.</strong> Satisfy yourself that your
            policy covers a person other than you driving it. We are not your insurer.
          </li>
          <li>
            <strong>Fuel, tolls, parking and permits are yours</strong> unless agreed otherwise for
            a particular journey.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Conduct">
        <p>
          We expect courtesy in both directions. Drivers will not be asked to exceed speed limits,
          drive an unsafe vehicle, carry anything unlawful, or continue beyond a reasonable
          working day. Customers can expect a driver to arrive sober, licensed and on time.
          Harassment, threats or discrimination end an account on either side.
        </p>
      </LegalSection>

      <LegalSection title="For drivers">
        <ul>
          <li>
            <strong>You are paid a set amount for each job</strong>, shown to you before you accept
            it. A journey spanning several days is paid for each of those days.
          </li>
          <li>
            <strong>Your documents must be valid.</strong> You must hold a current driving licence
            and keep your documents up to date. An expired document stops you receiving work until
            it is renewed.
          </li>
          <li>
            <strong>Accepting a trip is a commitment.</strong> Repeatedly accepting and then
            abandoning trips may lead to your account being suspended.
          </li>
          {/*
            TODO (business): payout schedule and mechanism — how often drivers are paid, by what
            method, the minimum payout, and what happens to earnings on a suspended account.
          */}
        </ul>
      </LegalSection>

      <LegalSection title="Suspension">
        <p>
          We may suspend or close an account that breaches these terms, that we reasonably believe
          is being used fraudulently, or where it is necessary for someone&apos;s safety.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          We take care in verifying that drivers are licensed and their documents current, and in
          operating the service properly. We are responsible for our own failure to take that care.
        </p>
        <p>
          We are not responsible for the condition of your vehicle, for your insurance cover, or
          for losses that could not reasonably have been foreseen. Nothing in these terms limits
          liability that cannot be limited by law — including for death or personal injury caused
          by negligence, or for fraud.
        </p>
        {/*
          TODO (legal): a liability cap, if you want one, and how it interacts with the Consumer
          Protection Act 2019. This is the section least safe to leave to a draft.
        */}
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. The date at the top shows when they last changed, and
          continuing to use DriverZone after a change means accepting the updated terms.
        </p>
      </LegalSection>

      <LegalSection title="Governing law and contact">
        <p>
          These terms are governed by the laws of India, and the courts of West Bengal have
          jurisdiction over any dispute.
        </p>
        <p>
          Questions go to <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>. See also our{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
