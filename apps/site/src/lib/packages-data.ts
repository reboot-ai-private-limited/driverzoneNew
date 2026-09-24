export type PackageCategory =
  | 'In-City'
  | 'Outstation'
  | 'Hill Station'
  | 'Special';

export type PackageItem = {
  id: string;
  image: string;
  imageAlt: string;
  category: PackageCategory;
  title: string;
  price: string;
  priceNote: string;
  duration: string;
  features: readonly string[];
  badge?: string;
};

export const ALL_PACKAGES: readonly PackageItem[] = [
  /* ── In-City ─────────────────────────────────────────────────────────── */
  {
    id: 'in-city-one-way-3h',
    image: '/packages/in-city-one-way.webp',
    imageAlt: 'Driver hire for in-city one-way trip in Siliguri',
    category: 'In-City',
    title: 'In-City One Way',
    price: '₹399',
    priceNote: 'Starting price',
    duration: 'For 3 hours',
    features: [
      'Covers up to 30 km within city',
      'Overtime after 3 hrs: ₹99/hour',
      'Driver food: Not included',
      'Verified & background-checked driver',
    ],
    badge: 'Most Popular',
  },
  {
    id: 'in-city-round-trip-3h',
    image: '/packages/in-city-round-trip.webp',
    imageAlt: 'Driver hire for in-city round trip in Siliguri',
    category: 'In-City',
    title: 'In-City Round Trip',
    price: '₹399',
    priceNote: 'Starting price',
    duration: 'For 3 hours',
    features: [
      'Pick-up & drop at same location',
      'Overtime after 3 hrs: ₹99/hour',
      'Driver food: Not included',
      'Verified & background-checked driver',
    ],
  },
  {
    id: 'in-city-one-way-6h',
    image: '/packages/in-city-one-way.webp',
    imageAlt: 'Half-day in-city one-way driver hire in Siliguri',
    category: 'In-City',
    title: 'Half-Day One Way',
    price: '₹699',
    priceNote: 'Starting price',
    duration: 'For 6 hours',
    features: [
      'Covers up to 60 km within city',
      'Overtime after 6 hrs: ₹99/hour',
      'Driver food: Not included',
      'Verified & background-checked driver',
    ],
  },
  {
    id: 'in-city-round-trip-6h',
    image: '/packages/in-city-round-trip.webp',
    imageAlt: 'Half-day in-city round trip driver hire in Siliguri',
    category: 'In-City',
    title: 'Half-Day Round Trip',
    price: '₹799',
    priceNote: 'Starting price',
    duration: 'For 6 hours',
    features: [
      'Pick-up & drop at same location',
      'Overtime after 6 hrs: ₹99/hour',
      'Driver food: Not included',
      'Verified & background-checked driver',
    ],
  },
  {
    id: 'in-city-one-way-8h',
    image: '/packages/in-city-one-way.webp',
    imageAlt: 'Full-day in-city one-way driver hire in Siliguri',
    category: 'In-City',
    title: 'Full-Day One Way',
    price: '₹899',
    priceNote: 'Starting price',
    duration: 'For 8 hours',
    features: [
      'Covers up to 80 km within city',
      'Overtime after 8 hrs: ₹99/hour',
      'Driver food: ₹150 included',
      'Verified & background-checked driver',
    ],
  },
  {
    id: 'in-city-round-trip-8h',
    image: '/packages/in-city-round-trip.webp',
    imageAlt: 'Full-day in-city round trip driver hire in Siliguri',
    category: 'In-City',
    title: 'Full-Day Round Trip',
    price: '₹999',
    priceNote: 'Starting price',
    duration: 'For 8 hours',
    features: [
      'Pick-up & drop at same location',
      'Overtime after 8 hrs: ₹99/hour',
      'Driver food: ₹150 included',
      'Verified & background-checked driver',
    ],
  },

  /* ── Outstation ─────────────────────────────────────────────────────── */
  {
    id: 'mini-outstation-one-way',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Mini outstation one-way driver hire from Siliguri',
    category: 'Outstation',
    title: 'Mini Outstation One Way',
    price: '₹799',
    priceNote: 'Starting price',
    duration: 'Up to 150 km',
    features: [
      'One-way drop to nearby towns',
      'Overtime: ₹99/hour after limit',
      'Driver food: ₹150 included',
      'Verified & background-checked driver',
    ],
    badge: 'Best Value',
  },
  {
    id: 'mini-outstation-round-trip',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Mini outstation round trip driver hire from Siliguri',
    category: 'Outstation',
    title: 'Mini Outstation Round Trip',
    price: '₹1,199',
    priceNote: 'Starting price',
    duration: 'Up to 150 km',
    features: [
      'Return trip included',
      'Overtime: ₹99/hour after limit',
      'Driver food: ₹150 included',
      'Verified & background-checked driver',
    ],
  },
  {
    id: 'outstation-full-day-one-way',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Full-day outstation one-way driver hire from Siliguri',
    category: 'Outstation',
    title: 'Outstation Full Day One Way',
    price: '₹1,299',
    priceNote: 'Starting price',
    duration: 'Up to 300 km / 10 hrs',
    features: [
      'Long-distance one-way drop',
      'Overtime: ₹99/hour after limit',
      'Driver food: ₹150 included',
      'Verified & background-checked driver',
    ],
  },
  {
    id: 'outstation-full-day-round-trip',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Full-day outstation round trip driver hire from Siliguri',
    category: 'Outstation',
    title: 'Outstation Full Day Round Trip',
    price: '₹1,799',
    priceNote: 'Starting price',
    duration: 'Up to 300 km / 10 hrs',
    features: [
      'Same-day return trip',
      'Overtime: ₹99/hour after limit',
      'Driver food: ₹150 included',
      'Verified & background-checked driver',
    ],
  },

  /* ── Hill Station ─────────────────────────────────────────────────────── */
  {
    id: 'darjeeling-day-trip',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Driver hire for Darjeeling day trip from Siliguri',
    category: 'Hill Station',
    title: 'Darjeeling Day Trip',
    price: '₹1,499',
    priceNote: 'Starting price',
    duration: 'Full Day (10–12 hrs)',
    features: [
      'Siliguri ↔ Darjeeling return',
      'Hill-experienced verified driver',
      'Driver food: ₹150 included',
      'Overtime: ₹150/hour after limit',
    ],
    badge: 'Popular Route',
  },
  {
    id: 'gangtok-day-trip',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Driver hire for Gangtok day trip from Siliguri',
    category: 'Hill Station',
    title: 'Gangtok Day Trip',
    price: '₹1,699',
    priceNote: 'Starting price',
    duration: 'Full Day (12–14 hrs)',
    features: [
      'Siliguri ↔ Gangtok return',
      'Hill-experienced verified driver',
      'Driver food: ₹150 included',
      'Overtime: ₹150/hour after limit',
    ],
  },
  {
    id: 'kalimpong-day-trip',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Driver hire for Kalimpong day trip from Siliguri',
    category: 'Hill Station',
    title: 'Kalimpong Day Trip',
    price: '₹1,199',
    priceNote: 'Starting price',
    duration: 'Full Day (8–10 hrs)',
    features: [
      'Siliguri ↔ Kalimpong return',
      'Hill-experienced verified driver',
      'Driver food: ₹150 included',
      'Overtime: ₹150/hour after limit',
    ],
  },
  {
    id: 'mirik-day-trip',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Driver hire for Mirik day trip from Siliguri',
    category: 'Hill Station',
    title: 'Mirik Day Trip',
    price: '₹999',
    priceNote: 'Starting price',
    duration: 'Full Day (8–10 hrs)',
    features: [
      'Siliguri ↔ Mirik return',
      'Hill-experienced verified driver',
      'Driver food: ₹150 included',
      'Overtime: ₹150/hour after limit',
    ],
  },

  /* ── Special ─────────────────────────────────────────────────────────── */
  {
    id: 'airport-transfer-bagdogra',
    image: '/packages/in-city-one-way.webp',
    imageAlt: 'Driver hire for Bagdogra airport transfer from Siliguri',
    category: 'Special',
    title: 'Airport Transfer',
    price: '₹599',
    priceNote: 'Starting price',
    duration: 'One-way to Bagdogra',
    features: [
      'Drop or pick-up at Bagdogra Airport',
      'Fixed fare — no surge pricing',
      'Flight-tracking on request',
      'Verified & background-checked driver',
    ],
    badge: 'Fixed Fare',
  },
  {
    id: 'wedding-event-package',
    image: '/packages/in-city-round-trip.webp',
    imageAlt: 'Driver hire for wedding and events in Siliguri',
    category: 'Special',
    title: 'Wedding & Event Package',
    price: '₹2,499',
    priceNote: 'Per day starting',
    duration: 'Full Day (12 hrs)',
    features: [
      'Professionally dressed driver',
      'Multiple pick-up & drops',
      'Driver food: ₹150 included',
      'Overtime: ₹150/hour after limit',
    ],
  },
  {
    id: 'corporate-monthly',
    image: '/packages/in-city-one-way.webp',
    imageAlt: 'Monthly corporate driver hire package in Siliguri',
    category: 'Special',
    title: 'Corporate Monthly',
    price: '₹9,999',
    priceNote: 'Per month',
    duration: 'Mon – Sat, 8 hrs/day',
    features: [
      'Dedicated driver for your firm',
      'Background-verified professional',
      'Driver food: ₹150/day included',
      'Priority support & replacement',
    ],
    badge: 'Enterprise',
  },
];

export const CATEGORIES: readonly PackageCategory[] = [
  'In-City',
  'Outstation',
  'Hill Station',
  'Special',
];
