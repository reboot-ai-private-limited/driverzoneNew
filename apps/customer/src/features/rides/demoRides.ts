/**
 * DEMO DATA — every ride on this screen is invented.
 *
 * `GET /customer/bookings` (a LIST) does not exist on the API — only `GET /customer/bookings/:id`
 * does, which is what the real trip screen (`app/trip/[id].tsx`) reads for a booking just made.
 * There is no endpoint this file could call instead. The previous version of this tab said so and
 * rendered an honest empty state rather than fake one — see the git history on
 * `app/(tabs)/rides.tsx` for that reasoning in full.
 *
 * That rule is deliberately overridden HERE, on explicit instruction: show the ride-history and
 * ride-detail screens exactly as designed, and use demo data wherever the backend has nothing to
 * offer. So every screen that reads from this file carries a visible "Demo data" marker — the one
 * condition attached to building this at all. When the list endpoint ships, this file is what
 * gets deleted, and the two screens that read it are what gets pointed at the real thing instead.
 */

export type DemoRideStatus = 'COMPLETED' | 'CANCELLED' | 'RUNNING';

export interface DemoInvoiceLine {
  label: string;
  amount: number;
}

export interface DemoRide {
  id: string;
  status: DemoRideStatus;
  /** ISO 8601, invented. */
  at: string;
  driverName: string;
  driverRating: number;
  /**
   * Fictional, but a real, dialable-shaped number — Call/Message on the detail screen route
   * through the OS dialer/SMS app for real, the same as any "call support" button would. Nothing
   * about the ACTION is fake, only the number it dials.
   */
  driverPhone: string;
  driverExperienceYears: number;
  driverVehicles: string;
  pickup: string;
  drop: string;
  totalPaise: number;
  packageLabel: string;
  tripType: 'One Way' | 'Round Trip';
  timeline: { label: string; at: string; note: string }[];
  invoice: DemoInvoiceLine[];
  discountPaise: number;
  paymentMethod: 'UPI' | 'CASH';
  transactionId: string | null;
  yourRating: number | null;
}

const PAISE = 100;

export const DEMO_RIDES: DemoRide[] = [
  {
    id: 'DZ2405108932',
    status: 'COMPLETED',
    at: '2026-05-10T14:45:00.000Z',
    driverName: 'Rahul Sharma',
    driverRating: 4.8,
    driverPhone: '+919876543210',
    driverExperienceYears: 5,
    driverVehicles: 'Hatchback, Sedan, SUV',
    pickup: 'Siliguri Junction, West Bengal',
    drop: 'Bagdogra Airport, West Bengal',
    totalPaise: 950 * PAISE,
    packageLabel: 'City — 3 Hour',
    tripType: 'One Way',
    timeline: [
      {
        label: 'Trip started',
        at: '2026-05-10T14:45:00.000Z',
        note: 'Siliguri Junction, West Bengal',
      },
      { label: 'Trip running', at: '2026-05-10T14:50:00.000Z', note: 'Enroute to destination' },
      {
        label: 'Trip completed',
        at: '2026-05-10T16:05:00.000Z',
        note: 'Bagdogra Airport, West Bengal',
      },
    ],
    invoice: [
      { label: 'Package price (3 hour)', amount: 800 * PAISE },
      { label: 'Pickup charge', amount: 50 * PAISE },
      { label: 'Waiting charge (20 min)', amount: 50 * PAISE },
      { label: 'Night charge (after 10 PM)', amount: 100 * PAISE },
    ],
    discountPaise: 50 * PAISE,
    paymentMethod: 'UPI',
    transactionId: 'UPI216548793021',
    yourRating: 5,
  },
  {
    id: 'DZ2405097741',
    status: 'COMPLETED',
    at: '2026-05-09T11:20:00.000Z',
    driverName: 'Vikram Das',
    driverRating: 4.6,
    driverPhone: '+919876500002',
    driverExperienceYears: 3,
    driverVehicles: 'Hatchback, Sedan',
    pickup: 'Siliguri Junction, West Bengal',
    drop: 'NJP Railway Station, West Bengal',
    totalPaise: 650 * PAISE,
    packageLabel: 'City — 1 Hour',
    tripType: 'One Way',
    timeline: [
      {
        label: 'Trip started',
        at: '2026-05-09T11:20:00.000Z',
        note: 'Siliguri Junction, West Bengal',
      },
      {
        label: 'Trip completed',
        at: '2026-05-09T12:05:00.000Z',
        note: 'NJP Railway Station, West Bengal',
      },
    ],
    invoice: [{ label: 'Package price (1 hour)', amount: 650 * PAISE }],
    discountPaise: 0,
    paymentMethod: 'CASH',
    transactionId: null,
    yourRating: 4,
  },
  {
    id: 'DZ2405086621',
    status: 'RUNNING',
    at: '2026-05-08T19:30:00.000Z',
    driverName: 'Rahul Sharma',
    driverRating: 4.8,
    driverPhone: '+919876543210',
    driverExperienceYears: 5,
    driverVehicles: 'Hatchback, Sedan, SUV',
    pickup: 'Siliguri Junction, West Bengal',
    drop: 'Malbazar, West Bengal',
    totalPaise: 1250 * PAISE,
    packageLabel: 'Outstation — PKG-2',
    tripType: 'One Way',
    timeline: [
      {
        label: 'Trip started',
        at: '2026-05-08T19:30:00.000Z',
        note: 'Siliguri Junction, West Bengal',
      },
      { label: 'Trip running', at: '2026-05-08T19:35:00.000Z', note: 'Enroute to destination' },
    ],
    invoice: [{ label: 'Package price', amount: 1250 * PAISE }],
    discountPaise: 0,
    paymentMethod: 'CASH',
    transactionId: null,
    yourRating: null,
  },
  {
    id: 'DZ2405075510',
    status: 'CANCELLED',
    at: '2026-05-07T16:15:00.000Z',
    driverName: 'Amit Thapa',
    driverRating: 4.7,
    driverPhone: '+919876500003',
    driverExperienceYears: 4,
    driverVehicles: 'Sedan',
    pickup: 'Siliguri Junction, West Bengal',
    drop: 'Bagdogra Airport, West Bengal',
    totalPaise: 0,
    packageLabel: 'City — 3 Hour',
    tripType: 'One Way',
    timeline: [
      { label: 'Trip cancelled', at: '2026-05-07T16:18:00.000Z', note: 'Cancelled before pickup' },
    ],
    invoice: [],
    discountPaise: 0,
    paymentMethod: 'UPI',
    transactionId: null,
    yourRating: null,
  },
  {
    id: 'DZ2405064422',
    status: 'COMPLETED',
    at: '2026-05-06T09:10:00.000Z',
    driverName: 'Amit Thapa',
    driverRating: 4.7,
    driverPhone: '+919876500003',
    driverExperienceYears: 4,
    driverVehicles: 'Sedan',
    pickup: 'Siliguri Junction, West Bengal',
    drop: 'Darjeeling, West Bengal',
    totalPaise: 2150 * PAISE,
    packageLabel: 'Outstation — PKG-3',
    tripType: 'Round Trip',
    timeline: [
      {
        label: 'Trip started',
        at: '2026-05-06T09:10:00.000Z',
        note: 'Siliguri Junction, West Bengal',
      },
      { label: 'Trip completed', at: '2026-05-06T14:40:00.000Z', note: 'Darjeeling, West Bengal' },
    ],
    invoice: [{ label: 'Package price — round trip', amount: 2150 * PAISE }],
    discountPaise: 0,
    paymentMethod: 'UPI',
    transactionId: 'UPI778213640912',
    yourRating: 5,
  },
];

export function findDemoRide(id: string): DemoRide | null {
  return DEMO_RIDES.find((ride) => ride.id === id) ?? null;
}

/**
 * Whole rupees, Indian digit grouping — hand-rolled rather than `toLocaleString('en-IN')` for the
 * same reason `formatPaise`'s own doc gives elsewhere in this app: Hermes ships a reduced ICU on
 * Android and lakh/crore grouping is exactly the locale data that goes missing, so the built-in
 * formatter silently degrades to plain thousands-grouping on some devices and not others. This
 * screen has no server string to fall back on — it is demo data — so it has to get this right
 * itself rather than lean on a formatter this codebase has already found unreliable.
 */
export function formatDemoPaise(paise: number): string {
  const rupees = Math.round(paise / PAISE);
  const sign = rupees < 0 ? '-' : '';
  const digits = String(Math.abs(rupees));

  // Indian grouping: the last three digits together, then pairs of two moving left —
  // "1234567" → "12,34,567".
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest === '' ? last3 : rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;

  return `${sign}₹${grouped}`;
}
