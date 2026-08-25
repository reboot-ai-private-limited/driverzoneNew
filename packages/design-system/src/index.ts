/**
 * Web-only React components and the design tokens.
 *
 * Native equivalents live in @driverzone/mobile-ui, which consumes `./tokens` alone — that
 * subpath imports nothing, which is what keeps a web dependency out of a Metro bundle.
 * See docs/engineering/shared-packages.md.
 *
 * The theme is a separate export: `@driverzone/design-system/theme.css`.
 *
 * EVERY COMPONENT HERE CARRIES `'use client'`. Most of them genuinely need it — hooks, Radix
 * context, event handlers — and marking the handful that do not would give the package two
 * classes of component distinguishable only by reading the file. The admin panel is a client
 * application by design (docs/engineering/frontend-architecture.md §The shape of the app), so
 * a design system whose components are all client components costs it nothing.
 *
 * `tokens.ts` is the exception and stays a plain module: it has no React in it at all, which
 * is what lets @driverzone/mobile-ui consume it from a Metro bundle.
 */
export * from './tokens';

export * from './ui/cn';
export * from './ui/Badge';
export * from './ui/Button';
export * from './ui/DataState';
export * from './ui/DataTable';
export * from './ui/Dialog';
export * from './ui/DropdownMenu';
export * from './ui/EmptyState';
export * from './ui/ErrorState';
export * from './ui/FilterBar';
export * from './ui/Input';
export * from './ui/OtpInput';
export * from './ui/PageHeader';
export * from './ui/Pagination';
export * from './ui/Panel';
export * from './ui/RequestId';
export * from './ui/Select';
export * from './ui/Skeleton';
export * from './ui/Tooltip';
export * from './ui/TopProgressBar';
