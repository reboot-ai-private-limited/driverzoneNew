# Design Language

What the admin panel looks like, and the rules that keep it consistent. How it is _built_ is
[`frontend-architecture.md`](frontend-architecture.md); which screens exist is
[`../LLD/admin-panel.md`](../LLD/admin-panel.md).

This applies to `apps/web` only. The mobile apps share the token **values** through
`@driverzone/design-system/tokens` and nothing else — see [`shared-packages.md`](shared-packages.md).

---

## Principles

**A dense operations console, not a marketing site.** An ops person spends their day on the
bookings list. Fitting twenty rows on screen instead of twelve is worth more than air.

**No shadows. Anywhere.** Separation comes from a hairline border, a change of surface, or plain
whitespace. Shadows on a flat interface produce a soft, unfocused page where everything floats
slightly and nothing is clearly on top of anything.

> The one place this bites is **overlays** — a modal, a dropdown menu, the hover-expanded nav.
> Those genuinely must read as _above_ the page. They get an opaque surface plus a 1px
> `borderStrong`, and modals add a scrim over the content behind. That is the answer; do not
> reintroduce a shadow to "fix" a dropdown that looks flat.

**Not everything is a card.** The default container is nothing at all: a heading, a hairline
rule, content. `<Panel>` — bordered, no shadow — is for content that is a genuinely separate
object, like the grouped field lists on a detail screen. A list inside a card inside a card is
the failure this rule exists to prevent.

**Light theme only.** One palette to get right and one set of contrast pairs to verify. Dark mode
is a real request for a tool used at 11pm and it can be added later; shipping it half-checked is
worse than not shipping it.

**Desktop-first, and honest about it.** The panel targets ≥1024px. Below `md` it shows a message
saying so rather than reflowing a zone editor onto a phone and pretending that works.

---

## Color

The brand primary is **`#C0FF72`**. Understanding one fact about it determines the whole palette:

> **`#C0FF72` is a near-white lime.** It scores **1.18:1 against white** and **17.79:1 against
> black**. It is a _surface_, not an _ink_.

So the accent is used as a **fill with dark text on it** — a primary button, the active nav item,
a selected pill. It can never be link text, an icon colour, a focus ring, or a border on white,
because at 1.18:1 none of those are visible. The logo's `#1EBC00` fails too, at 2.55:1.

Anything that needs to be a _coloured ink_ — links, focus rings, selected state, the active tab
underline — uses **`interactive`**, a dark sibling from the same lime family that passes on every
surface we put it on.

### Tokens

Raw values live in `packages/design-system/src/tokens.ts`; the semantic names below live in
`theme.css` and are **the only ones a component may reference**. A component that reaches for
`colors.accent` directly has bypassed the layer where the contrast rules are enforced.

| Semantic token      | Value     | Used for                                      | Contrast                                        |
| ------------------- | --------- | --------------------------------------------- | ----------------------------------------------- |
| `surface`           | `#FFFFFF` | panels, table body, overlays                  | —                                               |
| `surface-sunken`    | `#F7F8F5` | page background                               | 1.07 on white                                   |
| `surface-muted`     | `#EDEFEA` | table header, row hover, skeleton base        | 1.16 on white                                   |
| `text`              | `#1C1B1F` | body and headings                             | 17.13 on surface, 16.07 on sunken               |
| `text-subtle`       | `#5C635A` | secondary cell line, labels, hints            | 6.20 on surface, 5.82 on sunken                 |
| `accent`            | `#C0FF72` | **fill only** — primary button, active nav    | —                                               |
| `accent-hover`      | `#AEF255` | its hover/pressed state                       | —                                               |
| `accent-ink`        | `#1C1B1F` | text and icons **on** accent                  | 14.51 on accent                                 |
| `interactive`       | `#3F6212` | links, focus ring, selected, active underline | 7.08 on surface, 6.65 on sunken, 6.00 on accent |
| `interactive-hover` | `#365314` | its hover state                               | 8.73 on surface                                 |
| `border`            | `#D8DCD5` | hairlines, dividers, table rules, `Panel`     | decorative                                      |
| `border-strong`     | `#8A9281` | form control boundaries, overlay edges        | 3.23 on surface                                 |
| `success`           | `#1a7f37` |                                               | 5.08                                            |
| `warning`           | `#9a6700` |                                               | 4.87                                            |
| `danger`            | `#cf222e` | destructive actions, `ERROR` violations       | 5.36                                            |

**Why `border-strong` exists separately.** WCAG 1.4.11 wants 3:1 for the boundary of a control
you can interact with. A hairline light enough to be unobtrusive between table rows is far too
light to be the edge of a text input. Two tokens, two jobs — and a single `border` used for both
means either the table looks heavy or the inputs are invisible.

**Zone fills** (`zone-city`, `zone-pickup-free`, `zone-pickup-paid`, `zone-hill`,
`zone-violation`) are unchanged from `tokens.ts` and are map polygon fills, not UI colour. They
are chosen to be distinguishable from each other on a basemap, which is a different problem from
text contrast. The editor legend in [`../LLD/admin-panel.md`](../LLD/admin-panel.md) is their
specification.

---

## Type and density

|               |                                                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base size     | **14px** — the console default; 16px costs roughly three table rows per screen                                                                                                                                         |
| Scale         | 12 / 14 / 16 / 20 / 28 (`fontSize` in `tokens.ts`)                                                                                                                                                                     |
| Body font     | system stack — no webfont, nothing to wait for                                                                                                                                                                         |
| Numerals      | **`font-variant-numeric: tabular-nums` on every money, count, distance and id column.** Proportional digits make a column of rupee figures ragged and genuinely harder to scan for the wrong one.                      |
| Table row     | ~44px                                                                                                                                                                                                                  |
| Spacing scale | Tailwind's numeric scale off its `--spacing: 0.25rem` base — an 8px rhythm with a 4px half-step. `p-1` 4px, `p-2` 8px, `p-4` 16px, `p-6` 24px, `p-10` 40px. `tokens.ts` carries the same five values for React Native. |
| Radii         | 4 / 8 / 16 / pill (`radius` in `tokens.ts`)                                                                                                                                                                            |

### Two-line cells

The strongest idea in the reference design and worth naming: a table cell carries a primary value
in `text` with a secondary in `text-subtle` beneath it — `WB12AB1234` over `Hyundai i20`,
`Matigara` over `Siliguri, WB`, `18 May 2025` over `10:30 AM`.

It doubles the information per row without a second column. It is the `<CellStack>` primitive, so
it is done once rather than re-invented per table with slightly different spacing each time.

---

## Breakpoints

```css
--breakpoint-sm: 640px;
--breakpoint-lg: 1024px;
--breakpoint-2xl: 1536px;
--breakpoint-md: 768px;
--breakpoint-xl: 1280px;
--breakpoint-3xl: 1920px;
--breakpoint-4xl: 2560px;
--breakpoint-5xl: 3440px;
```

`lg` is where the panel starts working properly. **The content region takes a max width at `3xl`
and above**; a table stretched across 3440px puts the row's first and last cell too far apart to
read as one row, and the rail sits outside that max width so the layout stays anchored left rather
than floating in the middle of an ultrawide.

---

## Layout

```
┌────┬──────────────────────────────────────────────────┐
│ ▣  │  Zone Management                    🔔  ▾ Account │  TopBar
│    │  Home › Zones                       [+ New Zone] │
│ ◫  ├──────────────────────────────────────────────────┤
│ ◑  │  ┌ FilterBar ─────────────────────────────────┐  │
│ ◈  │                                                  │
│ ◇  │  Name          Type    Charge   Area    Ver      │  content
│    │  ──────────────────────────────────────────      │
│    │  Siliguri Central  PICKUP  FREE  12.4km²  3      │
│ ◍  │                                                  │
└────┴──────────────────────────────────────────────────┘
 64px
```

**TopBar** — page title, breadcrumbs, the nav pin toggle, notification bell with count, account
menu. The page's primary action sits at its right, on the breadcrumb line.

**Content** — `surface-sunken` background, sections on `surface`. Bordered `Panel` only where §Principles allows.

### The side nav

The component with the most behaviour, so it is specified rather than left to implementation.

- **Rail** — 64px, always present, icons only. Brand mark at the top, the signed-in admin at the
  bottom.
- **Hover expands to 240px as an overlay.** The nav is `position: fixed`; the content region keeps
  its 64px offset and **never reflows**. Animate `transform`, not `width` — animating width
  relayouts the whole page on every frame, and on a table of 128 rows that is visible.
- **Pin** — the TopBar toggle switches to persistent-expanded, which _does_ push content. That is
  the escape hatch for anyone who wants labels permanently. Persisted per admin.
- **Keyboard** — expands on `:focus-within` as well as `:hover`. Hover-only is a trap: an admin
  tabbing into the nav would be navigating a column of unlabelled icons. Labels stay in the
  accessibility tree at all times, including when visually collapsed.
- **Touch** — the hover behaviour is gated behind `@media (hover: hover)`. On a touch device
  there is no hover state to leave, so the panel would open and stay open over the content; the
  pin toggle is the only way in.
- **Active item** — `accent` fill, `accent-ink` label, and a left accent bar so it still reads at
  64px where the label is not visible.
- **Counts** — a dot on the rail, a numeric pill when expanded.

Nav entries come from the screen list in [`../LLD/admin-panel.md`](../LLD/admin-panel.md).
Screens whose API does not exist yet render **disabled with a tooltip saying so, not hidden**:
ops should be able to see the shape of the product, and a nav that silently grows week to week is
harder to trust than one that shows what is coming.

---

## Component inventory

Everything below lives in `packages/design-system/src/ui/`, with two exceptions noted below.
Anything that knows what a zone or a booking _is_ stays in `apps/web/src/features/`.

**Chrome** — `AppShell`, `SideNav`, `TopBar`, `Breadcrumbs`, `PageHeader`. **These live in
`apps/web/src/components/`, not the design system**, because they know about Next's router —
`usePathname` to mark the active nav item, `<Link>` for navigation. Putting them in the design
system would give it a dependency on Next, which is a framework, not a design decision.

**Data** — `DataTable` (sortable headers, sticky header, column visibility, row selection, row
action menu, horizontal scroll), `Pagination` (numbered pills, prev/next, "Showing 1 to 10 of
128"), `FilterBar` (search, date range, selects, Filter/Reset), `CellStack`, `DefinitionList` /
`FieldRow`, `StatTile`, `Timeline`.

**Forms** — `FormField` (label / hint / error wrapper), `Input`, `Textarea`, `Select`, `Combobox`,
`DateRangePicker`, `Checkbox`, `Radio`, `Switch`, `MoneyInput`, `OtpInput`.

**Actions and feedback** — `Button`, `IconButton`, `DropdownMenu`, `Badge` / `StatusPill`,
`Tooltip`, `Dialog`, `ConfirmDialog`, `Sheet`, `Toast` + `Toaster`, `Tabs`, `TopProgressBar`.

**States** — `Skeleton`, `SkeletonTable`, `SkeletonFieldList`, `EmptyState`, `ErrorState`,
`DataState`, `RequestId`.

**Formatters** — `Money`, `DateTime`, `Distance` also live in `apps/web`, in `lib/format.ts`.
They encode `Asia/Kolkata` and the paise convention, which are product rules rather than visual
ones; the design system's contribution is the `.tnum` class they render with.

### What exists today

The inventory above is the specification. Built so far, against the proving slice:

|                          |                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Built**                | `Button`, `IconButton`, `Input`, `FormField`, `OtpInput`, `Select`, `Badge`, `StatusPill`, `Panel`, `DefinitionList`, `FieldRow`, `DataTable`, `CellStack`, `Pagination`, `FilterBar`, `PageHeader`, `Breadcrumbs`, `Dialog`, `ConfirmDialog`, `DropdownMenu`, `Tooltip`, `Skeleton`, `EmptyState`, `ErrorState`, `DataState`, `RequestId`, `TopProgressBar` |
| **Specified, not built** | `Sheet`, `Tabs`, `Toast`, `Combobox`, `DateRangePicker`, `Checkbox`, `Radio`, `Switch`, `MoneyInput`, `Timeline`, `StatTile`                                                                                                                                                                                                                                 |

Nothing in the second row is blocked — each is wanted by a screen that does not exist yet.
`Sheet` and `MoneyInput` are the zone editor's and the package editor's respectively, so they
are the next two.

Radix backs `Dialog`, `Sheet`, `DropdownMenu`, `Select`, `Tooltip`, `Tabs` and `Popover` —
components whose focus trapping, escape handling and ARIA wiring we would otherwise get subtly
wrong. Everything else is ours.

### Three that carry real rules

**`Button`** — `primary` is `accent` fill with `accent-ink` text, never white text. `danger` is
`danger` fill with white. `secondary` is a `border-strong` outline on `surface`. A button in its
loading state keeps its label and its width; swapping the label for a spinner makes the row jump.

**`MoneyInput`** — takes rupees from the admin and emits **integer paise**. Never a float, per
[`coding-standards.md`](coding-standards.md) §Money. Having one component own that conversion is
what stops `parseFloat` appearing in a pricing form.

**`ConfirmDialog`** — has a destructive variant that takes a _blast radius_ body, not just a
message. The zone deactivation flow in [`../LLD/admin-panel.md`](../LLD/admin-panel.md) — "removes
pickup coverage for ~34% of Siliguri, leaves 8 scheduled bookings without coverage" — is exactly
this component, and the reason it takes structured consequences rather than a string.

---

## Loading

Skeletons, everywhere, per [`frontend-architecture.md`](frontend-architecture.md) §The loading
system. The visual rules:

- A skeleton reproduces the **real geometry** of what it replaces — table rows at the real column
  widths, a field list at the real row count. It is `surface-muted`, with a slow shimmer, and
  never more than one animation speed on a page.
- Skeletons never appear for a background refetch. That gets a 2px `interactive` bar at the top of
  the content region.
- A spinner appears only inside a button that is submitting. Nowhere else.

---

## Brand assets

`logo.svg` is a horizontal lockup at 236×126. `favicon.ico` is wired through `app/layout.tsx`
metadata. Both live in `apps/web/public/`.

> **The lockup has no square mark**, and the 64px rail cannot show a 1.87:1 wordmark. Until a
> mark-only asset exists, the rail renders the lockup's icon portion cropped to a square. This is
> a placeholder and should be replaced by a proper mark.

---

## Guards

Two tests in `packages/design-system` enforce this document. They are the highest-value tests in
the frontend, because everything they check is the kind of thing that decays silently.

**`tokens.drift.test.ts`** — parses `theme.css` and asserts every value matches `tokens.ts`.

> Tailwind v4's `@theme` is CSS and cannot import TypeScript, so these values necessarily exist in
> two files. Generating one from the other would give a package that deliberately ships source a
> build step, and a stale generated file is worse than none. Asserting parity gets the same
> guarantee for a test run. This is the same idea as `identity.typecheck.ts` and
> `zones.typecheck.ts` on the API, which compare Zod schemas against the contract types rather
> than deriving one from the other.

**`theme.contrast.test.ts`** — asserts every declared text-on-surface pair meets 4.5:1, and every
declared UI boundary meets 3:1.

> This is what keeps the lime rule true. `#C0FF72` looks like a brand colour and will read to
> someone as "the colour our text should be" at some point in the next six months. This test is
> the answer that does not depend on anyone having read this file.

**`tokens.drift.test.ts` also refuses a `--spacing-*` key named after Tailwind's `--container-*`
scale** — `3xs 2xs xs sm md lg xl 2xl … 7xl`.

> `max-w-*` reads `--container-*`, and falls back to `--spacing-*` when a key is missing. An
> earlier version of this theme declared a spacing token named `sm`, which silently redefined
> `max-w-sm` from 24rem to **8px**: every max-width in the panel collapsed to a vertical line
> and the login screen rendered as a sliver. Typecheck, lint, tests and the production build
> were all green throughout.
>
> That is why spacing uses the numeric scale here, and why those names are now reserved. A
> constraint that fails this quietly cannot be held by a comment.

Use a numeric utility for spacing. A named `--spacing-*` key is fine for a layout constant whose
name is not on that list — `--spacing-rail` and `--spacing-nav-open` are the two that exist —
and a max-width constant belongs in `--container-*`, which is where `--container-content-max`
lives.
