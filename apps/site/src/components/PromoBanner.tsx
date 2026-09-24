'use client';

import Image from 'next/image';
import { Phone } from 'lucide-react';
import { useState, useCallback, type ReactElement } from 'react';

const WA_NUMBER = '918509299342';

export function PromoBanner(): ReactElement {
  const [phone, setPhone] = useState('');

  const handleBook = useCallback(() => {
    const message = phone.trim()
      ? `*Hello DriverZone!*\n\nI would like to book a cab.\n\nMy contact number: ${phone.trim()}\n\nPlease confirm availability and pricing for my trip. Thank you!`
      : `*Hello DriverZone!*\n\nI would like to book a cab.\n\nPlease share available packages and pricing for my trip. Thank you!`;

    window.open(
      `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }, [phone]);

  return (
    <section
      id="promo-banner"
      className="relative w-full overflow-hidden min-h-[300px] md:min-h-[360px] lg:min-h-[400px]"
    >
      {/* Full-bleed background photo */}
      <Image
        src="/promo-banner.webp"
        alt="DriverZone cars and professional drivers ready to serve across North Bengal"
        fill
        className="object-cover object-center"
        priority
      />

      {/* Dark vignette — transparent left, dark right — keeps text legible */}
      <div className="absolute inset-0 bg-gradient-to-l from-black/20 via-black/20 to-transparent" />

      {/* Content — same max-w-6xl container as every other section */}
      <div className="relative z-10 flex h-full min-h-[300px] md:min-h-[360px] lg:min-h-[400px] items-center">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          {/* Inner: push copy block to the right half */}
          <div className="ml-auto max-w-[480px]">

          {/* Heading */}
          <h2 className="text-2xl font-bold text-white sm:text-3xl md:text-4xl lg:text-[2.75rem] lg:leading-[1.1">
            Your Ride, Your Time &mdash; Book<br />
            <span className="text-brand italic">Trusted Cabs Instantly</span>
          </h2>

          {/* Subtitle */}
          <p className="mt-3 text-sm leading-relaxed text-white/80 md:text-[15px]">
            Affordable city rides, outstation trips &amp; professional cab<br className="hidden md:block" />
            service across North Bengal with Driver Zone.
          </p>

          {/* Phone input + CTA */}
          <div className="mt-8 flex items-center gap-4 flex-wrap sm:flex-nowrap">
            {/* Input pill — glass style */}
            <div className="glass flex items-center gap-2.5 rounded-pill px-3 py-2.5 flex-1 min-w-0">
              <span className="flex size-8 shrink-0 glass items-center justify-center rounded-full">
                <Phone size={13} className="text-white" aria-hidden />
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Enter your mobile number"
                maxLength={15}
                className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-white/60 outline-none"
              />
            </div>

            {/* CTA button — opens WhatsApp with pre-filled message */}
            <button
              type="button"
              onClick={handleBook}
              className="shrink-0 rounded-pill bg-brand px-5 py-3.5 text-sm font-bold text-fg shadow-lg transition-opacity hover:opacity-90 active:scale-[0.97] whitespace-nowrap"
            >
              Book a Cab Now
            </button>
          </div>
          </div>{/* /.ml-auto inner */}
        </div>{/* /.max-w-6xl */}
      </div>
    </section>
  );
}
