import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { DeleteAccountForm } from '@/components/DeleteAccountForm';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Delete your account',
  description:
    'How to have your DriverZone account and personal data deleted, what is removed, and what we are required to keep.',
};

/**
 * `/delete-account` — the web deletion route Google Play requires, submitted in the Data Safety
 * form. It must work without the app installed, so the form here uses the session-less
 * `/api/account-deletion/:role/{otp,confirm}` endpoints; the apps have their own in-app flow.
 */
export default function DeleteAccountPage(): ReactElement {
  return (
    <LegalPage
      title="Delete your account"
      lead="You can close your DriverZone account and delete the personal data we hold about you — right here, without the app."
    >
      <LegalSection title="Delete your account now">
        <p>
          Choose your account type and enter the mobile number you sign in with. We will send a
          6-digit code to that number on WhatsApp (or by SMS) to confirm it is really you, then
          delete the account straight away.
        </p>
        <div className="mt-6">
          <DeleteAccountForm />
        </div>
      </LegalSection>

      <LegalSection title="Other ways to delete">
        <ul>
          <li>
            <strong>In the app:</strong> open the DriverZone app, go to <strong>Profile → Delete
            account</strong>, and follow the steps.
          </li>
          <li>
            <strong>By email:</strong> if you no longer have access to your phone number, email{' '}
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> with the subject line{' '}
            <strong>Delete my account</strong>, your account&apos;s phone number, and whether it is
            a customer or driver account. We will verify the request before deleting anything.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What gets deleted">
        <ul>
          <li>Your profile: name, phone number and profile photo.</li>
          <li>Your saved addresses and preferences.</li>
          <li>Your device notification tokens, so nothing further is sent to your phone.</li>
          <li>
            For drivers: your uploaded documents, including your driving licence and its images.
          </li>
          <li>
            Your account itself. You will not be able to sign in with that number afterwards, and
            signing up again creates a new, empty account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What we have to keep">
        <p>
          Some records cannot be deleted on request, and it is fairer to say so than to promise
          otherwise:
        </p>
        <ul>
          <li>
            <strong>Records of completed trips and payments.</strong> Tax and accounting law
            requires us to retain transaction records for a set period. These are kept in a form
            that is no longer linked to your profile where that is possible.
          </li>
          <li>
            <strong>Anything subject to an open dispute, safety investigation or legal
            obligation</strong>, for as long as that lasts.
          </li>
        </ul>
        <p>
          Everything outside those categories is removed. See our{' '}
          <Link href="/privacy">Privacy Policy</Link> for what we collect and why.
        </p>
      </LegalSection>

      <LegalSection title="How long it takes">
        <p>
          Deleting through this page or the app happens immediately. Requests sent by email are
          completed within 30 days of verification, and we confirm by email once done.
        </p>
      </LegalSection>

      <LegalSection title="Before you go">
        <p>
          An account can&apos;t be deleted while a trip is still open — complete or cancel it
          first. Drivers must be off duty and have no unsettled earnings or commission, since we
          cannot pay out to a deleted account. Unused wallet credit is lost when you delete.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
