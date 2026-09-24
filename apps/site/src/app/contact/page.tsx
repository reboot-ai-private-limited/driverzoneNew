import type { Metadata } from 'next';
import { Mail, MapPin, Phone } from 'lucide-react';
import type { ReactElement } from 'react';
import { PageHero } from '@/components/PageHero';
import { CONTACT } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with DriverZone about a booking, a fare, or becoming a driver. Based in Siliguri, serving North Bengal.',
};

/**
 * `/contact`.
 *
 * **There is no contact FORM here, deliberately.** A form needs somewhere to post to — an API
 * route, an email relay, a spam defence, and somebody watching the inbox at the other end. None
 * of that exists yet, and a form that silently drops what people write is worse than no form:
 * the customer believes they have reached you and waits.
 *
 * Direct channels instead. When there is an endpoint to receive submissions, a form belongs here
 * and these details stay alongside it.
 *
 * All three values come from `lib/site.ts`. See the banner in that file — they are placeholders
 * until somebody replaces them.
 */
export default function ContactPage(): ReactElement {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to us"
        lead="Questions about a booking, a fare, or driving with us — all reach the same place."
        breadcrumbs={[{ label: 'Contact' }]}
      />

      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <ContactCard
            icon={Phone}
            label="Phone"
            value={CONTACT.phoneDisplay}
            /* `tel:` needs the number without spaces, or some dialers refuse to parse it. */
            href={`tel:${CONTACT.phone.replace(/\s+/g, '')}`}
          />
          <ContactCard icon={Mail} label="Email" value={CONTACT.email} href={`mailto:${CONTACT.email}`} />
        </div>

        <div className="mt-4 flex items-start gap-4 rounded-xl border border-border bg-bg-sunken p-6">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand">
            <MapPin size={20} className="text-fg" aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold text-fg">Where we are</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{CONTACT.address}</p>
          </div>
        </div>

        <div className="mt-12 space-y-6 text-[17px] leading-relaxed text-muted">
          <h2 className="text-2xl font-bold tracking-tight text-fg">Already have a booking?</h2>
          <p>
            The fastest route is the app — your booking, your driver&apos;s details and your trip
            history are all on the trip screen, and Help &amp; Support in the Account tab reaches
            the same team as the details above.
          </p>

          <h2 className="pt-4 text-2xl font-bold tracking-tight text-fg">Want to drive with us?</h2>
          <p>
            Download the DriverZone Driver app and sign up with your phone number. You will be
            asked for your licence and documents; once they are verified you can go on duty and
            start receiving trips near you.
          </p>
        </div>
      </div>
    </>
  );
}

function ContactCard({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  href: string;
}): ReactElement {
  return (
    <a
      href={href}
      className="flex items-start gap-4 rounded-xl border border-border bg-bg p-6 transition-colors hover:border-border-strong"
    >
      <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand">
        <Icon size={20} className="text-fg" aria-hidden />
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold text-fg">{label}</h2>
        {/* `break-words` so a long address does not push the card wider than its column. */}
        <p className="mt-1.5 break-words text-[15px] text-muted">{value}</p>
      </div>
    </a>
  );
}
