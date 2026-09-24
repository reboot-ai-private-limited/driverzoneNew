import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT, LEGAL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description:
    'The terms you agree to when you book a driver through DriverZone or drive using the DriverZone Driver app, including cancellation and refund rules.',
};

/**
 * `/terms` — also serves as the published cancellation & refund policy the payment provider
 * requires. The fee figures come from `LEGAL.cancellation`, which mirrors the API's settings
 * defaults; if an admin changes those, change them there too. Not yet reviewed by a lawyer.
 */
export default function TermsPage(): ReactElement {
  const c = LEGAL.cancellation;

  return (
    <LegalPage
      title="Terms & Conditions"
      lead="These terms apply when you book a driver through DriverZone, and when you drive using the DriverZone Driver app."
    >
      <LegalSection title="Who we are and what we do">
        <p>
          DriverZone is operated by <strong>{LEGAL.entityName}</strong>, {CONTACT.address}.
        </p>
        <p>
          <strong>We provide drivers only — we do not provide vehicles.</strong> DriverZone
          connects people who own a vehicle with verified, licensed drivers who drive that vehicle
          for them. We are not a taxi, cab, rental or transport operator. The vehicle used on every
          trip belongs to, or is arranged by, the customer and remains the customer&apos;s
          responsibility throughout.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You need an account to book or to drive. It is tied to your phone number, verified by a
          one-time code, and it is personal to you — do not let someone else use it. You must be
          18 or over. Keep your details accurate; we use your phone number to reach you about a
          trip in progress.
        </p>
        <p>
          By creating an account you agree to receive sign-in codes and messages about your account
          and bookings by WhatsApp, SMS and app notification. You can opt out of non-essential
          messages at any time — see our <Link href="/privacy">Privacy Policy</Link>.
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
            <strong>Extras are shown in the same breakdown</strong> — such as a pickup zone charge,
            a late-night or early-morning charge, or applicable taxes — so the total you confirm is the total you owe.
            Extending a trip beyond its package is charged at the rate shown in the app.
          </li>
          <li>
            <strong>We then look for a driver.</strong> If no driver accepts your booking, it is
            cancelled at no charge and any amount you paid online is refunded in full.
          </li>
          <li>
            <strong>Fuel, tolls, parking, state permits and taxes for the vehicle</strong> are paid
            by the customer, unless agreed otherwise for a particular journey.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Cancellations by the customer">
        <ul>
          <li>
            <strong>Free</strong> within {c.freeWindowMinutes} minutes of confirming, or at any time
            before a driver is assigned.
          </li>
          <li>
            <strong>Free</strong> for a booking scheduled for later, until{' '}
            {c.scheduledFreeUntilMinutesBefore} minutes before the pickup time.
          </li>
          <li>
            <strong>Free</strong> after a driver is assigned but before they set off towards you.
          </li>
          <li>
            <strong>₹{c.customerFeeEnRoute}</strong> once the driver is on the way to you.
          </li>
          <li>
            <strong>₹{c.customerFeeArrived}</strong> once the driver has arrived at the pickup
            point.
          </li>
          <li>
            <strong>After a trip has started</strong> it cannot be cancelled in the app; contact
            us and we will settle the fare with you.
          </li>
        </ul>
        <p>
          The fee compensates the driver, who has given up other work and travelled to reach you.
          If we cancel a booking ourselves, nobody is charged.
        </p>
      </LegalSection>

      <LegalSection title="Payment and refunds">
        <ul>
          <li>
            <strong>How to pay.</strong> Pay by cash to your driver, or online through the app.
            Online payments are processed by Razorpay; we never receive or store your card, UPI or
            banking details.
          </li>
          <li>
            <strong>Refunds.</strong> If you cancel a booking you paid for online, you are refunded
            the amount paid minus any cancellation fee above. If no driver is found, or we cancel,
            you are refunded in full. Refunds go back to the original payment method and normally
            reach you within {LEGAL.refundWorkingDays} working days, depending on your bank.
          </li>
          <li>
            <strong>Cash bookings.</strong> Nothing is refunded because nothing was collected; a
            cancellation fee on a cash booking is added to your DriverZone wallet as an amount owed
            and is collected with your next trip.
          </li>
          <li>
            <strong>Failed or reversed payments.</strong> If a payment fails or is reversed, the
            amount remains owed.
          </li>
          <li>
            <strong>Disputes.</strong> If you think you were charged wrongly, contact us at{' '}
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> as soon as possible and we will
            review it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your DriverZone wallet">
        <p>
          Your wallet records any credit we give you and any amount you owe (such as an unpaid
          cancellation fee). Wallet credit can
          only be used towards DriverZone trips; it cannot be withdrawn as cash or transferred.
          An amount owed must be paid before or with your next booking. Unused credit is lost if
          you delete your account.
        </p>
      </LegalSection>

      <LegalSection title="Your responsibilities as a vehicle owner">
        <ul>
          <li>
            <strong>The vehicle must be legal and roadworthy</strong> — valid registration, valid
            insurance, pollution certificate and any permits the journey needs, and in a condition
            safe to drive.
          </li>
          <li>
            <strong>Your insurance is what covers the vehicle.</strong> Damage from road incidents
            is covered by the vehicle&apos;s own comprehensive motor insurance, so make sure your
            policy covers a person other than you driving it. We are not your insurer.
          </li>
          <li>
            <strong>Traffic fines (challans).</strong> A fine caused directly by the driver&apos;s
            own misconduct — for example jumping a red light — is DriverZone&apos;s responsibility,
            not yours. A fine caused by the vehicle&apos;s expired papers or by your instruction is
            yours.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Conduct">
        <p>
          We expect courtesy in both directions. Drivers will not be asked to exceed speed limits,
          drive an unsafe or unlawful vehicle, carry anything unlawful, or drive beyond a reasonable
          working day. Customers can expect a driver to arrive sober, licensed and on time.
          Harassment, threats, violence or discrimination end an account on either side.
        </p>
      </LegalSection>

      <LegalSection title="Ratings and reviews">
        <p>
          After a trip you may rate and review the other party. Keep it honest and relevant to the
          trip. We may remove reviews that are abusive, contain personal information, or are
          unrelated to the trip, and ratings are used to maintain the quality of the service.
        </p>
      </LegalSection>

      <LegalSection title="For drivers">
        <ul>
          <li>
            <strong>You are an independent driver-partner, not an employee</strong> of DriverZone.
            You choose when to go on duty and which trips to accept.
          </li>
          <li>
            <strong>Approval.</strong> You can receive trips only after we have verified your
            application and documents. Your documents must stay valid; an expired document stops
            you receiving work until it is renewed.
          </li>
          <li>
            <strong>Earnings.</strong> Each job pays a set amount, shown to you before you accept
            it; a journey spanning several days pays for each day. DriverZone keeps the rest of the
            fare.
          </li>
          <li>
            <strong>Cash and settlement.</strong> When a customer pays you in cash, you hold our
            share of the fare. Your balance in the Driver app shows what you owe us or what we owe
            you, and it is settled with DriverZone periodically.
          </li>
          <li>
            <strong>Safety.</strong> Zero tolerance for driving under the influence of alcohol or
            drugs. Check the customer&apos;s vehicle before setting off and point out any existing
            damage. A traffic fine caused by your own misconduct is your responsibility.
          </li>
          <li>
            <strong>Cancelling an accepted trip</strong> costs ₹{c.driverPenaltyEnRoute} once you
            have set off and ₹{c.driverPenaltyArrived} once you have arrived, debited from your
            balance, and counts towards your cancellation rate. Repeatedly abandoning trips may
            lead to suspension. Trips cancelled by DriverZone never count against you.
          </li>
          <li>
            <strong>Location.</strong> While you are on duty the Driver app shares your location,
            including in the background, so trips can be offered to you and customers can follow
            your arrival. It stops when you go off duty.
          </li>
          <li>
            <strong>Closing your account</strong> requires being off duty with no trip in progress
            and your balance settled.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Suspension and deletion">
        <p>
          We may suspend or close an account that breaches these terms, that we reasonably believe
          is being used fraudulently, or where it is necessary for someone&apos;s safety.
        </p>
        <p>
          You can delete your own account at any time in the app or on our{' '}
          <Link href="/delete-account">account deletion page</Link>, once you have no trip in
          progress and nothing is owed on either side.
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
          liability that cannot be limited by law — including under the Consumer Protection Act,
          2019, for death or personal injury caused by negligence, or for fraud.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. The date at the top shows when they last changed, and
          continuing to use DriverZone after a change means accepting the updated terms. Changes to
          fees apply only to bookings made after the change.
        </p>
      </LegalSection>

      <LegalSection title="Governing law and contact">
        <p>
          These terms are governed by the laws of India, and the courts and consumer forums of
          Siliguri / Jalpaiguri District, West Bengal have exclusive jurisdiction over any dispute.
        </p>
        <p>
          Questions and complaints go to <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>{' '}
          or {CONTACT.phoneDisplay}. See also our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
