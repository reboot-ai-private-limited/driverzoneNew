/**
 * EVERY REAL-WORLD DETAIL THE SITE PUBLISHES, IN ONE FILE — and the only file in `apps/site` that
 * needs editing before this goes live.
 *
 * It exists because the alternative is worse. The driver app currently ships a Help & Support
 * screen whose own comment reads "Placeholder contact details — swap these for the real support
 * line before release", and a Privacy Policy screen that says it is placeholder text; both went
 * unnoticed because the wrong values were scattered through the screens that used them. A public
 * website is a larger version of the same trap — a phone number in the footer, another in the
 * contact page, a third in the schema markup — so all of them live here, once.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ THE VALUES BELOW MARKED `TODO` ARE NOT REAL. The site renders correctly with them and     │
 * │ says nothing false about the service, but it will publish an email nobody reads and a     │
 * │ phone number that belongs to someone else. Replace them before pointing a domain here.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */

export const CONTACT = {
  email: 'support@driverzoneonline.com',
  phone: '+918509299342',
  phoneDisplay: '+91 85092 99342',
  phoneAlt: '+91 70016 06510',
  address:
    'Near Uttarbanga Sangbad Office, Banipukur Road, Middle Shanti Nagar, Loknath Mandir Road, Dabgram, Siliguri, West Bengal – 734004',
} as const;

/**
 * Where "Get the app" points.
 *
 * `null` until each store listing is live, and every button that links to a store checks for it:
 * a null renders as "Coming soon" rather than a link to a 404. That is deliberate — a dead store
 * link on a launch-day homepage is worse than an honest one, and this site will almost certainly
 * be published before the apps clear review.
 *
 * TODO: paste the listing URLs once the apps are live. The Android ones are
 * `https://play.google.com/store/apps/details?id=in.driverzone.customer` and
 * `…?id=in.driverzone.driver` — the package names are already fixed in each app's `app.json`.
 */
export const APP_LINKS = {
  customerAndroid: null as string | null,
  customerIos: null as string | null,
  driverAndroid: null as string | null,
} as const;

/**
 * The canonical origin, used for absolute URLs in metadata (Open Graph, canonical links).
 *
 * Read from the environment so a preview deployment describes itself honestly rather than
 * claiming to be production — a preview that advertises the production URL in its `og:url` is how
 * a staging build ends up in search results.
 *
 * TODO: set `NEXT_PUBLIC_SITE_URL` in the production environment; the fallback is for local dev.
 */
export const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3001';

/**
 * The date the legal pages were last substantively changed, shown on both.
 *
 * Hardcoded rather than derived from the file's git mtime or `new Date()`: a policy's effective
 * date is a legal claim about when the terms changed, not a build timestamp. A date that moves
 * every deploy tells a reader their terms changed when they did not.
 */
export const LEGAL_LAST_UPDATED = '22 September 2026';
