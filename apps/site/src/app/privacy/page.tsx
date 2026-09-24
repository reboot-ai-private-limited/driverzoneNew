import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT, LEGAL } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'What DriverZone collects, why, who it is shared with, and how to have your data deleted.',
};

/**
 * `/privacy` — the URL in the Play Console listing for BOTH apps.
 *
 * Written from the code: the permissions in each `app.json`, the profile DTOs in
 * `packages/contracts`, and the third parties the API talks to. Google cross-checks this page
 * against the Data Safety form and the app's observed behaviour, so a new permission, SDK or
 * profile field changes this page in the same commit. Not yet reviewed by a lawyer.
 */
export default function PrivacyPage(): ReactElement {
  return (
    <LegalPage
      title="Privacy Policy"
      lead="This policy covers the DriverZone customer app, the DriverZone Driver app, and this website."
    >
      <LegalSection title="Who we are">
        <p>
          DriverZone is operated by <strong>{LEGAL.entityName}</strong>, {CONTACT.address}. We
          provide professional drivers to people who own a vehicle — we do not provide vehicles.
          In this policy &quot;we&quot;, &quot;us&quot; and &quot;DriverZone&quot; mean{' '}
          {LEGAL.entityName}, and we are responsible for the personal data described here.
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
            <strong>Profile details you choose to give:</strong> your name, date of birth, gender,
            languages you speak, an alternate phone number, and a profile photo.
          </li>
          <li>
            <strong>An emergency contact</strong> — a name and phone number of someone you choose.
            Please only give us details of someone who is happy for you to share them. We use them
            only if there is an emergency during a trip.
          </li>
          <li>
            <strong>Photos.</strong> When you add a profile photo or upload a document, the app
            asks to use your camera or photo gallery. Only the photo you pick is uploaded; we do
            not access the rest of your gallery.
          </li>
          <li>
            <strong>Your trips.</strong> Pickup and drop points, times, the package chosen, fares,
            cancellations, and the outcome of each booking.
          </li>
          <li>
            <strong>Ratings and reviews</strong> you give or receive after a trip.
          </li>
          <li>
            <strong>Device information.</strong> A notification token for your device, so we can
            send you alerts about your trips, plus basic details about the app version and
            operating system when something goes wrong.
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
            <strong>Your vehicles</strong> — the registration (plate) number and fuel type of the
            vehicles you save, so your driver knows which vehicle to drive.
          </li>
          <li>
            <strong>Payments and wallet.</strong> If you pay online, the payment is handled by our
            payment provider — we receive confirmation that a payment or refund succeeded and its
            reference, but we never receive or store your card, UPI or banking credentials. We keep
            a record of your DriverZone wallet balance and its entries.
          </li>
        </ul>

        <h3>Drivers</h3>
        <ul>
          <li>
            <strong>Location while you are on duty, including in the background.</strong> This is
            how trips near you are offered to you, how customers follow your arrival, and how you
            are brought back online if your phone restarts or closes the app mid-shift. The app
            tells you before asking for this permission, and it stops when you go off duty.
          </li>
          <li>
            <strong>Your application details:</strong> home address, driving experience, the vehicle
            types you can drive, and your documents — driving licence and the other papers
            required to accept work — with their expiry dates.
          </li>
          <li>
            <strong>Your duty and earnings record</strong> — when you were on duty, what you earned
            for each trip, cash you collected, and amounts settled between you and us.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Why we collect it">
        <p>
          To let you sign in and hold an account; to match a booking to a driver and show each of
          you what you need to know about the other; to price, pay for and settle a trip; to verify
          that a driver is licensed and eligible; to send you messages about your account and your
          bookings; to investigate complaints and safety incidents; to prevent fraud; and to meet
          our legal and tax obligations.
        </p>
        <p>
          We do not sell your personal data. We do not use your location or your trip history for
          advertising, and we do not share it with advertisers or data brokers.
        </p>
      </LegalSection>

      <LegalSection title="Messages we send you">
        <ul>
          <li>
            <strong>Sign-in and verification codes</strong>, by WhatsApp or SMS.
          </li>
          <li>
            <strong>Account messages on WhatsApp</strong> — a welcome message when you first sign up
            as a customer, and a confirmation when your driver account is approved.
          </li>
          <li>
            <strong>Trip notifications</strong> in the app about your own bookings.
          </li>
        </ul>
        <p>
          You can stop non-essential WhatsApp messages at any time using the opt-out option in the
          message, by blocking our number in WhatsApp, or by writing to us. Sign-in codes and
          messages about a trip in progress are part of the service and are sent regardless.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>
          <strong>Between a customer and their driver.</strong> When a trip is assigned, each of
          you sees the other&apos;s name, profile photo, phone number and — for the duration of the
          trip — the relevant location. The driver also sees the vehicle details and the pickup
          and drop points for that trip. Neither of you sees the other&apos;s trip history or
          account details.
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
            <strong>Our messaging providers</strong> — delivery of sign-in codes and account
            messages by WhatsApp and SMS.
          </li>
          <li>
            <strong>Razorpay</strong>, our payment provider — processing online payments and
            refunds. They handle your payment credentials directly under their own privacy policy;
            we do not see them.
          </li>
          <li>
            <strong>Cloudinary</strong>, our storage provider — storage of profile photos and
            driver documents.
          </li>
        </ul>
        <p>
          We may also disclose information where the law requires it, or where it is necessary to
          investigate a safety incident, fraud, or a breach of our{' '}
          <Link href="/terms">Terms &amp; Conditions</Link>.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          We keep your profile and account data for as long as your account is open. When you
          delete your account, your profile, contact details, saved addresses, vehicles, photos,
          documents and device tokens are erased.
        </p>
        <p>
          Records of completed trips, payments and settlements are kept for up to{' '}
          {LEGAL.recordRetentionYears} years after the transaction, because tax and accounting law
          requires it, and are no longer linked to your profile where that is possible. Anything
          needed for an open dispute, safety investigation or legal claim is kept until that is
          resolved. Everything else is deleted when we no longer need it.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <ul>
          <li>
            <strong>Location.</strong> You can refuse or withdraw location permission at any time
            in your phone&apos;s settings. Some features — such as setting your pickup point
            automatically, or receiving trip offers as a driver — will not work without it.
          </li>
          <li>
            <strong>Notifications.</strong> You can turn these off in your phone&apos;s settings.
            You will then only see trip updates while the app is open.
          </li>
          <li>
            <strong>Access and correction.</strong> Your profile details are editable in the app.
            For a copy of anything else we hold about you, write to us at the address below.
          </li>
          <li>
            <strong>Deletion.</strong> You can delete your account yourself, at any time, in the app
            (Account → Delete account) or on our{' '}
            <Link href="/delete-account">account deletion page</Link> without installing the app.
          </li>
          <li>
            <strong>Withdrawing consent.</strong> Where we rely on your consent, you can withdraw it
            at any time; this does not affect anything done before you withdrew it.
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
          held in your device&apos;s secure keystore. Driver documents are stored privately and
          viewed only through short-lived links. Traffic between the apps and our servers is
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

      <LegalSection title="Contact and Grievance Officer">
        <p>
          Questions about this policy, or about the data we hold on you, go to{' '}
          <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or {CONTACT.phoneDisplay}.
        </p>
        <p>
          In accordance with the Information Technology Act, 2000 and the Digital Personal Data
          Protection Act, 2023, complaints about how we handle your personal data can be sent to
          our Grievance Officer
          {LEGAL.grievanceOfficerName === null ? '' : `, ${LEGAL.grievanceOfficerName}`}, at{' '}
          <a href={`mailto:${LEGAL.grievanceOfficerEmail}`}>{LEGAL.grievanceOfficerEmail}</a>{' '}
          or by post to {CONTACT.address}. We will acknowledge a complaint within 48 hours and aim
          to resolve it within 30 days.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
