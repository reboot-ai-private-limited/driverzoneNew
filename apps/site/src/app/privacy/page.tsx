import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What DriverZone collects, why, who it is shared with, and how to have your data deleted.',
};

/**
 * `/privacy` — and the URL that goes in the Play Console listing for BOTH apps.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS A DRAFT, WRITTEN FROM THE CODE, AND IT HAS NOT BEEN REVIEWED BY A LAWYER.        │
 * │                                                                                           │
 * │ Every collection and sharing statement below was checked against what the apps actually   │
 * │ do — the permissions in each `app.json`, the SDKs in the merged Android manifests, the    │
 * │ fields on `CustomerProfileDto` and `DriverProfileDto`, and the third parties the API      │
 * │ talks to. It is accurate as a description of the software. That is NOT the same as being  │
 * │ sufficient under the DPDP Act 2023 or Play's User Data policy, and the retention periods  │
 * │ in particular are business decisions nobody has made yet — they are marked where they     │
 * │ appear. Have it reviewed before you rely on it.                                           │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * **It must also stay true.** Google cross-checks a policy against the Data Safety form and
 * against what the app is observed doing; a policy that omits a collection the binary performs is
 * a rejection, and a later one is an enforcement action. If a new SDK, permission or field lands
 * in either app, this page changes in the same commit.
 */
export default function PrivacyPage(): ReactElement {
  return (
    <LegalPage
      title="Privacy Policy"
      lead="This policy covers the DriverZone customer app, the DriverZone Driver app, and this website."
    >
      <LegalSection title="Who we are">
        <p>
          DriverZone provides drivers for hire to people who own a car. In this policy
          &quot;we&quot; and &quot;DriverZone&quot; mean the operator of that service, contactable
          at <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <p>We collect only what the service needs to work, and only for the role you are using.</p>

        <h3>Everyone</h3>
        <ul>
          <li>
            <strong>Your phone number.</strong> It is how you sign in — we send a one-time code by
            WhatsApp or SMS — and how a driver and customer reach each other about a trip in
            progress.
          </li>
          <li>
            <strong>Your name</strong>, and a profile photo if you choose to add one.
          </li>
          <li>
            <strong>Device information.</strong> A notification token for your device, so we can
            send you alerts about your trips, plus basic details about the app version and
            operating system when something goes wrong.
          </li>
          <li>
            <strong>Your trips.</strong> Pickup and drop points, times, the package chosen, fares,
            and the outcome of each booking.
          </li>
        </ul>

        <h3>Customers</h3>
        <ul>
          <li>
            <strong>Location while you are using the app.</strong> To set your pickup point, to
            show you drivers nearby, and to follow your driver on the way to you. The customer app
            does not collect your location in the background.
          </li>
          <li>
            <strong>Saved addresses</strong> that you choose to store.
          </li>
          <li>
            <strong>Payment status.</strong> If you pay online, the payment is handled by our
            payment provider — we receive confirmation that a payment succeeded and its reference,
            but we never receive or store your card, UPI or banking credentials.
          </li>
        </ul>

        <h3>Drivers</h3>
        <ul>
          <li>
            <strong>Location while you are on duty, including in the background.</strong> This is
            how trips near you are offered to you, and how you are brought back online if your
            phone restarts or closes the app mid-shift. It stops when you go off duty.
          </li>
          <li>
            <strong>Your documents.</strong> Driving licence and the other papers required to
            accept work, along with their expiry dates.
          </li>
          <li>
            <strong>Your earnings record</strong> — what you were paid for each completed trip.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Why we collect it">
        <p>
          To let you sign in and hold an account; to match a booking to a driver and show each of
          you what you need to know about the other; to price and settle a trip; to verify that a
          driver is licensed; to send you notifications about your own bookings; to investigate
          complaints and safety incidents; and to meet our legal and tax obligations.
        </p>
        <p>
          We do not sell your personal data. We do not use your location or your trip history for
          advertising, and we do not share it with advertisers or data brokers.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>
          <strong>Between a customer and their driver.</strong> When a trip is assigned, each of
          you sees the other&apos;s name, phone number and — for the duration of the trip — the
          relevant location. Neither of you sees the other&apos;s trip history or account details.
        </p>
        <p>
          <strong>Service providers who process data on our behalf</strong>, under contract and
          only for the purpose we engage them for:
        </p>
        <ul>
          <li>
            <strong>Google</strong> — maps, address search and route information inside the apps.
          </li>
          <li>
            <strong>Google Firebase</strong> — delivery of push notifications to your device.
          </li>
          <li>
            <strong>Our messaging providers</strong> — delivery of your one-time sign-in code by
            WhatsApp and SMS.
          </li>
          <li>
            <strong>Our payment provider</strong> — processing online payments. They handle your
            payment credentials directly under their own privacy policy; we do not see them.
          </li>
          <li>
            <strong>Our storage provider</strong> — secure storage of driver documents.
          </li>
        </ul>
        <p>
          We may also disclose information where the law requires it, or where it is necessary to
          investigate a safety incident, fraud, or a breach of our terms.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your account and trip records for as long as your account is open, and for a
          period afterwards where we are required to — tax and accounting rules oblige us to retain
          records of completed transactions, and a safety or payment dispute may need the trip it
          relates to.{' '}
          {/*
            TODO (business decision, not a drafting one): state the actual retention periods.
            "As long as required" is acceptable to Play but weak under the DPDP Act, which expects
            a purpose-linked period. Someone has to decide how long a closed account's trip history
            is kept, and this sentence should then name it.
          */}
          Data we no longer need for any of these purposes is deleted.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <ul>
          <li>
            <strong>Location.</strong> You can refuse or withdraw location permission at any time
            in your phone&apos;s settings. The apps are built to keep working without background
            location — a driver can still work a shift; some features will be reduced.
          </li>
          <li>
            <strong>Notifications.</strong> You can turn these off in your phone&apos;s settings.
            You will then only see trip updates while the app is open.
          </li>
          <li>
            <strong>Access and correction.</strong> Your profile details are editable in the app.
            For anything else, write to us at the address below.
          </li>
          <li>
            <strong>Deletion.</strong> You can ask us to delete your account and the personal data
            we hold about you. See <Link href="/delete-account">deleting your account</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          DriverZone is not intended for anyone under 18, and we do not knowingly collect data from
          children. If you believe a child has given us their details, contact us and we will
          remove them.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Sign-in codes are stored only as a hash and expire quickly. Your session credentials are
          held in your device&apos;s secure keystore. Traffic between the apps and our servers is
          encrypted in transit. No system is perfectly secure, but we take reasonable measures
          appropriate to the sensitivity of what we hold.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If we change what we collect or why, we will update this page and change the date at the
          top. Significant changes will be notified in the app.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this policy, or about the data we hold on you, go to{' '}
          <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or {CONTACT.phoneDisplay}.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
