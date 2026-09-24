import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Phone, Mail, MapPin } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { ContactInfoCard } from '@/components/contact/ContactInfoCard';
import { ContactForm } from '@/components/contact/ContactForm';
import { SITE_URL } from '@/lib/site';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: 'Contact Driver Zone — Get In Touch with Us',
  description:
    'Contact Driver Zone for driver booking assistance, package details, ride support, or general service inquiries in Siliguri and North Bengal. Call, email, or visit us.',
  alternates: {
    canonical: `${SITE_URL}/contact`,
  },
  openGraph: {
    title: 'Contact Driver Zone — Get In Touch with Us',
    description:
      'Contact Driver Zone for driver booking assistance, package details, ride support, or general service inquiries in Siliguri and North Bengal.',
    url: `${SITE_URL}/contact`,
    siteName: 'Driver Zone',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Contact Driver Zone — Get In Touch with Us',
    description:
      'Contact Driver Zone for driver booking assistance and ride support in Siliguri and North Bengal.',
  },
};

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function ContactPage(): ReactElement {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Get In Touch"
        lead="Driver Zone for driver booking assistance, package details, ride support, or general service inquiries. Our team is available to help customers with city rides, outstation travel, airport transfers, and hill journey requirements through reliable customer support and professional booking coordination. Contact us for the latest pricing, booking policies, driver availability, or any travel-related assistance through our official phone number, email, or support channels."
        breadcrumbs={[{ label: 'Contact' }]}
      />

      {/* ── Section 1: 3 contact info cards ─────────────────────────────── */}
      <section className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">

          {/* 3 contact info cards */}
          <div className="mt-10 grid gap-6 sm:grid-cols-3">

            <ContactInfoCard icon={Phone} title="Call With Us">
              <a href="tel:03533568917" className="hover:text-fg transition-colors">
                (0353) 3568917
              </a>
              {' / '}
              <a href="tel:+918509299342" className="hover:text-fg transition-colors">
                +91 8509299342
              </a>
              <br />
              <a href="tel:+917001606510" className="hover:text-fg transition-colors">
                +91 7001606510
              </a>
            </ContactInfoCard>

            <ContactInfoCard icon={Mail} title="Email With Us">
              <div className="flex flex-col gap-0.5">
                <a
                  href="mailto:info@driverzoneonline.com"
                  className="hover:text-fg transition-colors"
                >
                  info@driverzoneonline.com
                </a>
                <a
                  href="mailto:driverzone.india@gmail.com"
                  className="hover:text-fg transition-colors"
                >
                  driverzone.india@gmail.com
                </a>
              </div>
            </ContactInfoCard>

            <ContactInfoCard icon={MapPin} title="Visit Our Location">
              <a
                href="https://maps.app.goo.gl/e8CL8U2uQP5K9gJd9"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-fg transition-colors"
              >
                Kalibari, Shanti Nagar, Siliguri,<br />
                West Bengal - 734004
              </a>
            </ContactInfoCard>

          </div>
        </div>
      </section>

      {/* ── Section 2: Form + Google Maps ───────────────────────────────── */}
      <section className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="grid gap-6 md:grid-cols-2">

            <ContactForm />

            <div className="overflow-hidden rounded-2xl md:min-h-[460px]">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3564.3999134979285!2d88.454268!3d26.699668199999998!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39e4414c86dea3a9%3A0x7608cebd230b056a!2sDRIVER%20ZONE!5e0!3m2!1sen!2sin!4v1790238585676!5m2!1sen!2sin"
                width="100%"
                height="100%"
                style={{ border: 0, minHeight: '460px' }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                title="DriverZone office — Kalibari, Siliguri on Google Maps"
                className="h-full w-full"
              />
            </div>

          </div>
        </div>
      </section>
    </>
  );
}
