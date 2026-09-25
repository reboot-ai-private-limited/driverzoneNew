'use client';

import Image from 'next/image';
import { useState, type ReactElement } from 'react';
import {
  BadgeCheck,
  Wallet,
  Headphones,
  ClipboardList,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

type Feature = {
  id: string;
  label: string;
  icon: LucideIcon;
  image: string;
  imageAlt: string;
  title: string;
  body: readonly string[];
};

const FEATURES = [
  {
    id: 'verified-drivers',
    label: 'Verified Drivers',
    icon: BadgeCheck,
    image: '/why-choose/verified-drivers.webp',
    imageAlt: 'Illustration of a verified DriverZone driver on a smartphone screen',
    title: 'Verified Drivers',
    body: [
      'At Driver Zone, customer safety and trust are our highest priorities. Every driver on our platform goes through a professional verification process before becoming available for bookings. This includes identity verification, driving licence checks, route experience validation, and basic background screening.',
      'Our drivers are experienced in handling city rides, long-distance travel, outstation routes, and hill driving conditions across North Bengal and nearby regions. We focus on punctuality, professional behaviour, and customer-friendly service standards to ensure a smooth travel experience for every passenger.',
      'Whether you need a driver for a short city ride, a business trip, or a long hill journey, Driver Zone connects you with trained professionals who understand safety, navigation, and responsible driving practices. Our goal is to provide reliable driver support that gives customers complete peace of mind during every trip.',
    ],
  },
  {
    id: 'affordable-pricing',
    label: 'Affordable Pricing',
    icon: Wallet,
    image: '/why-choose/affordable-pricing.webp',
    imageAlt: 'Illustration showing a transparent fare breakdown on a screen',
    title: 'Affordable Pricing',
    body: [
      'We believe professional driver services should be accessible to everyone. Driver Zone offers competitive, transparent pricing with no hidden charges — the fare you see before booking is the fare you pay.',
      'Choose from hourly in-city packages or fixed day-rate outstation plans. Every package is priced to reflect the real cost of the journey, so you only pay for what you need.',
      'Whether it is a short errand run or a multi-day outstation trip, our pricing is designed to give you full value without surprises at the end of the ride.',
    ],
  },
  {
    id: '24-7-support',
    label: '24/7 Service and Support',
    icon: Headphones,
    image: '/why-choose/support.webp',
    imageAlt: 'Illustration of a support agent assisting a customer',
    title: '24/7 Service and Support',
    body: [
      'Driver Zone operates round the clock so you are never left without help. Our support team is available 24 hours a day, seven days a week, to assist with bookings, driver queries, or any issue that comes up during a trip.',
      'Need to modify a booking at midnight or reschedule an early morning pickup? Reach us through the app or our helpline and a member of our team will respond promptly.',
      'We are committed to making every journey smooth from the moment you book to the moment you arrive. Reliable support is part of the service, not an add-on.',
    ],
  },
  {
    id: 'on-time-reporting',
    label: 'On Time Driver Reporting',
    icon: ClipboardList,
    image: '/why-choose/reporting.webp',
    imageAlt: 'Illustration of a driver punctuality reporting dashboard',
    title: 'On Time Driver Reporting',
    body: [
      'Every Driver Zone driver is expected to arrive at the pickup point on time, every time. Our platform tracks driver punctuality and maintains a record of each trip\'s reporting time.',
      'Drivers who consistently meet their reporting commitments are highlighted in our system, and customers can see their driver\'s rating once a driver is assigned.',
      'Late arrivals are flagged and followed up with the driver directly. We hold our drivers to the same standard of professionalism that you would expect from any trusted service provider.',
    ],
  },
  {
    id: 'safe-trusted',
    label: 'Safe & Trusted',
    icon: Shield,
    image: '/why-choose/safe-trusted.webp',
    imageAlt: 'Illustration of a shield representing passenger safety and trust',
    title: 'Safe & Trusted',
    body: [
      'Safety is at the core of everything Driver Zone does. From verified driver credentials to real-time trip tracking, every feature is designed with the passenger\'s security in mind.',
      'Our drivers carry valid licences and undergo background checks before joining the platform. Documents are reviewed on a rolling basis — a driver whose papers lapse is automatically suspended from accepting new trips.',
      'Customers can share their trip and driver details with a contact of their choice straight from the app, so family or colleagues know who is driving and where the trip is headed.',
    ],
  },
  {
    id: 'customize',
    label: 'Customize',
    icon: SlidersHorizontal,
    image: '/why-choose/customize.webp',
    imageAlt: 'Illustration of a customisable booking interface on a phone',
    title: 'Customize Your Booking',
    body: [
      'No two trips are the same, and Driver Zone is built to accommodate that. Customers can choose their pickup time, preferred package duration, trip type, and terrain — all from a single booking screen.',
      'For outstation journeys, specify whether the trip is one-way or round, and select the terrain that matches the route. The system calculates the fare based on your exact requirements.',
      'Regular customers can save preferences and rebook frequently-used trips in a few taps. We designed the booking flow to reduce friction so you spend less time on the app and more time on your journey.',
    ],
  },
] as const satisfies readonly Feature[];

export function WhyChooseSection(): ReactElement {
  const [activeId, setActiveId] = useState<string>(FEATURES[0].id);

  const active = (FEATURES as readonly Feature[]).find((f) => f.id === activeId) ?? FEATURES[0];

  return (
    <section id="why-choose" className="bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-0">
        {/* Heading */}
        <p className="text-sm font-semibold uppercase tracking-wider text-muted">
          Why Choose Driver Zone
        </p>
        <h2 className="mt-1 max-w-6xl text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Verified professionals with safety, support and convenience.
        </h2>

        {/* ── Pills row ────────────────────────────────────────────────── */}
        <div className="-mx-4 mt-6 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div
            className="flex gap-2 pb-2"
            role="tablist"
            aria-label="Feature categories"
          >
            {FEATURES.map((feature) => {
              const isActive = feature.id === activeId;
              const Icon = feature.icon;
              return (
                <button
                  key={feature.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`why-panel-${feature.id}`}
                  onClick={() => setActiveId(feature.id)}
                  className={[
                    'inline-flex flex-none items-center gap-2 rounded-pill border px-4 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
                    isActive
                      ? 'border-brand bg-brand text-fg shadow-md'
                      : 'border-transparent bg-gray-200 text-fg hover:border-border hover:bg-bg-sunken',
                  ].join(' ')}
                >
                  <Icon size={15} aria-hidden />
                  {feature.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Content panel ─────────────────────────────────────────────── */}
        <div
          id={`why-panel-${active.id}`}
          role="tabpanel"
          aria-label={active.label}
          className="mt-4 overflow-hidden rounded-2xl border border-border bg-bg"
        >
          <div className="grid md:grid-cols-[5fr_7fr]">
            {/* Image */}
            <div className="relative aspect-[4/3] bg-bg-sunken md:aspect-auto md:min-h-[400px]">
              <Image
                src={active.image}
                alt={active.imageAlt}
                fill
                sizes="(min-width: 768px) 42vw, 100vw"
                quality={90}
                className="object-cover"
              />
            </div>

            {/* Text */}
            <div className="flex flex-col justify-center p-8 lg:p-12">
              <h3 className="text-2xl font-bold text-fg">{active.title}</h3>
              <div className="mt-4 space-y-3">
                {active.body.map((para, i) => (
                  <p key={para} className="text-[15px] leading-relaxed text-muted">
                    {para}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
