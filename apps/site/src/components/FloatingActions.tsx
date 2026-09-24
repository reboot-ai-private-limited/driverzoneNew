import { PhoneOutgoing } from 'lucide-react';
import type { ReactElement } from 'react';

const WA_HREF   = 'https://wa.me/918509299342';
const CALL_HREF = 'tel:+918509299342';

export function FloatingActions(): ReactElement {
  return (
    <div className="fixed bottom-6 right-5 z-50 flex flex-col gap-3">

      {/* WhatsApp */}
      <a
        href={WA_HREF}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat on WhatsApp"
        className="flex size-14 items-center justify-center rounded-[18px] bg-gradient-to-t from-[#00C33B] to-[#1AFF5F] shadow-lg transition-transform hover:scale-110 active:scale-95"
      >
        {/* WhatsApp logo SVG */}
        <svg viewBox="0 0 32 32" fill="none" className="size-8" aria-hidden>
          <path
            d="M16 2C8.268 2 2 8.268 2 16c0 2.478.677 4.797 1.855 6.784L2 30l7.43-1.832A13.93 13.93 0 0 0 16 30c7.732 0 14-6.268 14-14S23.732 2 16 2Z"
            fill="white"
          />
          <path
            d="M22.003 19.613c-.322-.161-1.905-.94-2.2-1.047-.294-.107-.508-.16-.722.161-.214.322-.83 1.047-1.018 1.262-.187.214-.375.24-.697.08-.322-.16-1.36-.502-2.59-1.6-.957-.855-1.604-1.91-1.791-2.232-.187-.322-.02-.496.14-.656.144-.143.322-.375.483-.562.16-.188.213-.322.32-.536.107-.214.053-.401-.027-.562-.08-.16-.722-1.74-.988-2.383-.26-.626-.524-.54-.722-.55l-.615-.01a1.18 1.18 0 0 0-.856.4c-.294.322-1.124 1.098-1.124 2.678s1.151 3.106 1.311 3.32c.16.214 2.266 3.46 5.49 4.852.768.331 1.367.529 1.834.677.77.245 1.472.21 2.026.127.618-.092 1.904-.779 2.172-1.531.268-.75.268-1.393.187-1.53-.08-.134-.294-.215-.616-.376Z"
            fill="#25D366"
          />
        </svg>
      </a>

      {/* Call */}
      <a
        href={CALL_HREF}
        aria-label="Call us"
        className="flex size-14 items-center justify-center rounded-[18px] bg-gradient-to-t from-[#075EFF] to-[#7BA9FF] shadow-lg transition-transform hover:scale-110 active:scale-95"
      >
        <PhoneOutgoing size={24} className="text-white" aria-hidden />
      </a>

    </div>
  );
}
