import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Phone, Mail, MapPin } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { ContactInfoCard } from '@/components/contact/ContactInfoCard';
import { ContactForm } from '@/components/contact/ContactForm';
import { FaqAccordion } from '@/components/FaqAccordion';
import { SITE_URL } from '@/lib/site';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: 'Contact Driver Zone — Call, WhatsApp or Visit Us in Siliguri',
  description:
    'Get in touch with DriverZone for driver booking, package details, pricing enquiries, or ride support in Siliguri and North Bengal. Call (0353) 3568917, WhatsApp +91 8509299342, or email info@driverzoneonline.com.',
  alternates: {
    canonical: `${SITE_URL}/contact`,
  },
  keywords: [
    'contact DriverZone',
    'driver hire Siliguri contact',
    'book driver Siliguri',
    'DriverZone phone number',
    'DriverZone WhatsApp',
    'driver hire enquiry Siliguri',
  ],
  openGraph: {
    title: 'Contact Driver Zone — Call, WhatsApp or Visit Us in Siliguri',
    description:
      'Reach DriverZone by phone, WhatsApp or email for driver booking assistance and ride support in Siliguri and North Bengal.',
    url: `${SITE_URL}/contact`,
    siteName: 'DriverZone',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/why-choose.webp`,
        width: 1200,
        height: 630,
        alt: 'DriverZone team at the Siliguri office — contact us for driver hire',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact Driver Zone — Call, WhatsApp or Visit Us in Siliguri',
    description:
      'Reach DriverZone by phone, WhatsApp or email for driver booking assistance in Siliguri.',
    images: [`${SITE_URL}/why-choose.webp`],
  },
};

/* ── FAQ data ────────────────────────────────────────────────────────────── */

const FAQS = [
  {
    q: 'How can I book a driver with DriverZone?',
    a: 'You can book a driver through the DriverZone mobile app (available on Android), by messaging us on WhatsApp at +91 8509299342, or by calling (0353) 3568917. You can also fill in the request form on this page and a team member will contact you.',
  },
  {
    q: 'What are DriverZone\'s business hours?',
    a: 'Our booking team is available Monday to Saturday from 8 AM to 9 PM IST. Driver availability may extend beyond these hours depending on the package. For urgent bookings, WhatsApp is the fastest channel.',
  },
  {
    q: 'How quickly will I get a response after submitting the contact form?',
    a: 'We aim to respond to all enquiries within 2–4 hours during business hours. For urgent bookings, we recommend calling or messaging us directly on WhatsApp at +91 8509299342 for an immediate response.',
  },
  {
    q: 'Can I book a driver for an outstation or hill station trip from Siliguri?',
    a: 'Yes. DriverZone covers outstation trips across North Bengal and hill station routes to Darjeeling, Gangtok, Kalimpong, and Mirik. Share your destination and dates through WhatsApp or the contact form and we will confirm a driver and fare.',
  },
  {
    q: 'Do you have a physical office I can visit?',
    a: 'Yes. Our office is located at Kalibari, Shanti Nagar, Siliguri, West Bengal — 734004. You are welcome to visit during business hours (Monday to Saturday, 8 AM to 9 PM). The location is on Google Maps — search for "Driver Zone Siliguri".',
  },
  {
    q: 'How do I report an issue with a booking or driver?',
    a: 'Please call us at (0353) 3568917 or +91 8509299342, or email driverzone.india@gmail.com with your booking details. Our team will investigate and resolve the issue promptly. All driver concerns are taken seriously and logged for review.',
  },
  {
    q: 'Is there a cancellation or rescheduling policy?',
    a: 'Bookings can be rescheduled or cancelled by contacting us at least 2 hours before the scheduled pick-up time. For hill station and outstation trips, we request at least 4 hours notice. Contact us directly for urgent changes.',
  },
] as const;

/* ── JSON-LD schemas ─────────────────────────────────────────────────────── */

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Contact', item: `${SITE_URL}/contact` },
  ],
};

const localBusinessSchema = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: 'DriverZone',
  description:
    'Professional driver hire service in Siliguri offering in-city, outstation, hill station, airport transfer and corporate packages.',
  url: SITE_URL,
  telephone: '+918509299342',
  email: 'info@driverzoneonline.com',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Kalibari, Shanti Nagar',
    addressLocality: 'Siliguri',
    addressRegion: 'West Bengal',
    postalCode: '734004',
    addressCountry: 'IN',
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: 26.699668,
    longitude: 88.454268,
  },
  openingHoursSpecification: {
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    opens: '08:00',
    closes: '21:00',
  },
  sameAs: [
    'https://www.facebook.com/driverzone.siliguri/',
    'https://www.instagram.com/driverzoneonline/',
  ],
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((faq) => ({
    '@type': 'Question',
    name: faq.q,
    acceptedAnswer: { '@type': 'Answer', text: faq.a },
  })),
};

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function ContactPage(): ReactElement {
  return (
    <>
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* Page hero */}
      <PageHero
        eyebrow="Contact"
        title="Get In Touch"
        lead="We are here to help with driver bookings, package details, pricing questions, and ride support across Siliguri and North Bengal. Reach us on call, WhatsApp, or email — whichever is easiest."
        breadcrumbs={[{ label: 'Contact' }]}
      />

      {/* ── Section 1: 3 contact info cards ─────────────────────────────── */}
      <section className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-3">

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
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
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
                className="h-full w-full grayscale transition-[filter] duration-300 hover:grayscale-0"
              />
            </div>

          </div>
        </div>
      </section>

      {/* ── Section 3: FAQ ────────────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">
              Frequently Asked
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Common Questions
            </h2>
            <p className="mt-3 text-[15px] text-muted">
              Quick answers about booking, availability, and reaching our team.
            </p>
          </div>

          <div className="mt-6">
            <FaqAccordion items={FAQS} />
          </div>
        </div>
      </section>
    </>
  );
}

