import type { ReactElement } from 'react';
import { APP_LINKS } from '@/lib/site';

/**
 * Store buttons that tell the truth about whether there is a store listing yet.
 *
 * **The case this component exists for is the one that will actually happen.** This site is ready
 * before the apps are — they still need a privacy policy, account deletion and three Play
 * declarations before they can be submitted, let alone approved. So for some weeks the homepage
 * will have a prominent "Get the app" section pointing at listings that do not exist.
 *
 * The two bad answers are a link to a 404 and a button that silently does nothing. This renders
 * "Coming soon" instead, as static text rather than a disabled control — a disabled button still
 * invites a click and still reads as a button to a screen reader, where the honest thing to say
 * is that there is nothing to press yet.
 *
 * Switching it on is one edit in `lib/site.ts`; no page changes.
 */
export function AppLinks({
  variant,
  audience,
}: {
  variant: 'onLight' | 'onDark';
  audience: 'customer' | 'driver';
}): ReactElement {
  const links =
    audience === 'customer'
      ? [
          { label: 'Google Play', href: APP_LINKS.customerAndroid },
          { label: 'App Store', href: APP_LINKS.customerIos },
        ]
      : [{ label: 'Google Play', href: APP_LINKS.driverAndroid }];

  const live = links.filter(
    (link): link is { label: string; href: string } => typeof link.href === 'string',
  );

  if (live.length === 0) {
    return (
      <p
        className={
          variant === 'onDark'
            ? 'text-sm font-medium text-on-fg/60'
            : 'text-sm font-medium text-muted'
        }
      >
        {audience === 'customer' ? 'Apps' : 'Driver app'} coming soon to Google Play
        {audience === 'customer' ? ' and the App Store' : ''}.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {live.map((link) => (
        <a
          key={link.label}
          href={link.href}
          /*
           * An outbound link to a domain we do not control. `noopener` is the security half —
           * without it the opened page gets a handle on this one through `window.opener`.
           */
          target="_blank"
          rel="noopener noreferrer"
          className={
            variant === 'onDark'
              ? 'inline-flex items-center justify-center rounded-pill bg-brand px-6 py-3 text-sm font-semibold text-fg transition-opacity hover:opacity-90'
              : 'inline-flex items-center justify-center rounded-pill bg-fg px-6 py-3 text-sm font-semibold text-on-fg transition-opacity hover:opacity-90'
          }
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
