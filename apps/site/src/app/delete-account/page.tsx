import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Delete your account',
  description:
    'How to have your DriverZone account and personal data deleted, what is removed, and what we are required to keep.',
};

/**
 * `/delete-account` — a Google Play requirement, and the reason this page exists as a URL at all.
 *
 * Play requires any app that lets people create an account to offer account deletion **from a web
 * page reachable without installing the app**, and that URL is submitted in the Data Safety form.
 * A deletion option buried in the app alone does not satisfy it: the reviewer has to be able to
 * reach this from a browser, and so does someone who has already uninstalled.
 *
 * **THE IN-APP HALF IS NOT BUILT YET.** Play wants both — this page AND a path inside each app —
 * and there is currently no `deleteAccount` endpoint in `apps/api` and no row in either app's
 * Account screen. So this page documents a request-by-email process, which is a legitimate
 * mechanism on its own, and the copy below is written to be true of that process rather than of
 * a button that does not exist.
 *
 * When the endpoint and the in-app flow land, the "How to ask" section gains a first option
 * pointing at them and this page stays as the web route it is required to be.
 */
export default function DeleteAccountPage(): ReactElement {
  return (
    <LegalPage
      title="Delete your account"
      lead="You can ask us to close your DriverZone account and delete the personal data we hold about you."
    >
      <LegalSection title="How to ask">
        <p>
          Email <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> from the address on your
          account, or write to us from any address with the subject line{' '}
          <strong>Delete my account</strong>, including:
        </p>
        <ul>
          <li>the phone number your DriverZone account uses;</li>
          <li>whether it is a customer account or a driver account.</li>
        </ul>
        <p>
          We will confirm the request is genuinely from you — usually by sending a code to that
          phone number — before we delete anything. This step exists to stop somebody else closing
          your account.
        </p>
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
          We aim to complete verified deletion requests within 30 days, and will confirm by email
          once it is done.
        </p>
      </LegalSection>

      <LegalSection title="Before you go">
        <p>
          If you have a trip booked, it will be cancelled. If you are a driver with earnings not
          yet paid out, settle those with us first — we cannot pay out to a deleted account.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
