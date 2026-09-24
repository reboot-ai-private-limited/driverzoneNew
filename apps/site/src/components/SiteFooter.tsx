import Image from 'next/image';
import Link from 'next/link';

import { Phone, MessageCircle, Mail, MapPin, Check } from 'lucide-react';
import type { ReactElement } from 'react';

const QUICK_LINKS = [
  { label: 'Home',              href: '/' },
  { label: 'About Us',          href: '/about' },
  { label: 'Our Packages',      href: '/#packages-pricing' },
  { label: 'Terms & conditions', href: '/terms' },
  { label: 'Privacy Policy',   href: '/privacy' },
  { label: 'Delete Account',    href: '/delete-account' },
  { label: 'Contact Us',        href: '/contact' },
] as const;

export function SiteFooter(): ReactElement {
  return (
    <footer className="bg-[#0e0e12]">
      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">

        {/* ── Main 4-column grid ──────────────────────────────────────── */}
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">

          {/* Col 1 — Brand */}
          <div>
            <Image
              src="/logo.svg"
              alt="DriverZone — Now you can tell us"
              width={160}
              height={80}
              className="h-16 w-auto invert brightness-0"
            />
            <p className="mt-4 text-[13px] leading-relaxed text-white/55">
              DriverZone offers trusted Driver Hire in Siliguri and Car Driver Hire in Siliguri
              with verified, licensed drivers for your own car and on-time service. Enjoy safe,
              reliable, and convenient travel for all your local and outstation trips.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/#get-the-app"
                className="rounded-pill border border-brand px-5 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand hover:text-fg"
              >
                Hire Driver
              </Link>
              <Link
                href="/#get-the-app"
                className="rounded-pill border border-white/30 px-5 py-2 text-sm font-medium text-white/75 transition-colors hover:border-white/60 hover:text-white"
              >
                Become a Driver
              </Link>
            </div>
          </div>

          {/* Col 2 — Quick links (nav) */}
          <div>
            <h3 className="text-[15px] font-semibold text-white">Quick Link</h3>
            <ul className="mt-5 space-y-3.5">
              {QUICK_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="flex items-center gap-2.5 text-[13px] text-white/55 transition-colors hover:text-white"
                  >
                    <Check size={14} className="shrink-0 text-brand" aria-hidden />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3 — Contact */}
          <div>
            <h3 className="text-[15px] font-semibold text-white">Quick Link</h3>
            <ul className="mt-5 space-y-4">
              <li className="flex items-start gap-3">
                <Phone size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <span className="text-[13px] leading-relaxed text-white/55">
                  <a href="tel:03533568917" className="hover:text-white transition-colors">(0353) 3568917</a>{' '}
                  <a href="tel:+918509299342" className="hover:text-white transition-colors">+91 8509299342</a><br />
                  <a href="tel:+917001606510" className="hover:text-white transition-colors">+91 7001606510</a>
                </span>
              </li>
              <li className="flex items-center gap-3">
                {/* WhatsApp icon — inline SVG (brand icon, not in Lucide) */}
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="size-[15px] shrink-0 text-brand"
                  aria-hidden
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.115 1.533 5.845L.057 23.178a.75.75 0 0 0 .916.919l5.433-1.463A11.945 11.945 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.886 0-3.65-.51-5.168-1.401l-.371-.22-3.843 1.035 1.056-3.748-.242-.386A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                </svg>
                <a
                  href="https://wa.me/918509299342"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-white/55 transition-colors hover:text-white"
                >
                  +91 8509299342
                </a>
              </li>
              <li className="flex items-start gap-3">
                <Mail size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <div className="flex flex-col gap-0.5">
                  <a
                    href="mailto:info@driverzoneonline.com"
                    className="text-[13px] text-white/55 transition-colors hover:text-white"
                  >
                    info@driverzoneonline.com
                  </a>
                  <a
                    href="mailto:driverzone.india@gmail.com"
                    className="text-[13px] text-white/55 transition-colors hover:text-white"
                  >
                    driverzone.india@gmail.com
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <MapPin size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                <a
                  href="https://maps.app.goo.gl/e8CL8U2uQP5K9gJd9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] leading-relaxed text-white/55 transition-colors hover:text-white"
                >
                  Kalibari, Shanti Nagar, Siliguri, West Bengal - 734004
                </a>
              </li>
            </ul>
          </div>

          {/* Col 4 — Map + Social */}
          <div>
            <div className="overflow-hidden rounded-xl">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3564.3999134979285!2d88.454268!3d26.699668199999998!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39e4414c86dea3a9%3A0x7608cebd230b056a!2sDRIVER%20ZONE!5e0!3m2!1sen!2sin!4v1790238585676!5m2!1sen!2sin"
                width="100%"
                height="180"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                title="DriverZone office — Kalibari, Siliguri on Google Maps"
              />
            </div>

            {/* Social icons */}
            <div className="mt-4 flex items-center gap-3">
              <a
                href="https://www.facebook.com/driverzone.siliguri/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="DriverZone on Facebook"
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-brand hover:text-fg"
              >
                {/* Facebook icon */}
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-[18px]" aria-hidden>
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                </svg>
              </a>
              <a
                href="https://www.instagram.com/driverzoneonline/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="DriverZone on Instagram"
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-brand hover:text-fg"
              >
                {/* Instagram icon */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden>
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </a>
            </div>
          </div>

        </div>

        {/* ── Bottom bar ──────────────────────────────────────────────── */}
        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 py-6 text-[13px] text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © Copyright{' '}
            <span className="font-semibold text-brand">Driver Zone</span>
            {' '}- 2026 | All Right Reserved
          </p>
          <p className="flex items-center gap-2">
           <Image
              src="/footer-logo-dev.svg"
              alt="Reboot AI"
              width={137}
              height={11}
              className="h-[14px] w-auto"
            />
          </p>
        </div>

      </div>
    </footer>
  );
}
