/**
 * Tailwind v4 has no `tailwind.config.js` — the theme is CSS. Unlike `apps/web`, which imports
 * its theme from `@driverzone/design-system`, this site's theme lives in `src/app/globals.css`;
 * see the note there about why the public site does not share the admin panel's palette.
 */
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
