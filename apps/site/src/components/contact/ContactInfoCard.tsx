import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

export function ContactInfoCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="group flex flex-col items-center rounded-2xl bg-bg-sunken px-6 py-10 text-center">

      {/* Stacked-card icon — brand square with rotated white card behind */}
      <div className="relative mx-auto w-fit">
        <div className="absolute inset-0 scale-[1.18] rotate-[-10deg] rounded-2xl bg-white shadow-sm transition-transform duration-300 group-hover:rotate-[-4deg]" />
        <div className="relative flex size-[68px] items-center justify-center rounded-2xl bg-brand transition-transform duration-300 group-hover:rotate-6">
          <Icon size={28} className="text-fg" strokeWidth={2} aria-hidden />
        </div>
      </div>

      <h3 className="mt-6 text-[17px] font-bold text-fg">{title}</h3>
      <div className="mt-2 text-[14px] leading-relaxed text-muted">{children}</div>

    </div>
  );
}
