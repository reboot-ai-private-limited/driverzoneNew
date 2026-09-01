# Trip Reviews & Ratings

A two-sided review system executed post-trip. Both the customer and the driver are prompted to rate each other and the trip experience. 

Unlike the simpler `rating` number mentioned in early docs, this is a dedicated ledger of reviews that tracks exactly **who reviewed whom**, for **which trip**, at **what time**, alongside structured tags and text feedback.

## Goals & Invariants

- **Two-Sided:** Customer reviews the driver/trip; Driver reviews the customer.
- **Trip-Bound:** A review is always permanently tied to a specific `bookingId`. 
- **Idempotent / Immutable:** A party can only rate a trip once. Once submitted, a rating cannot be edited by the user (only an admin can remove/hide a malicious review).
- **Retaliation Prevention (Blind Reviews):** If a customer gives a 1-star review, the driver must not see it (or have their average dropped visibly) until the driver has also submitted their review, or until the review window expires.
- **Time-Bound:** Reviews can only be submitted within a configurable time window after the trip ends (e.g., 24 hours), driven by the Settings module (`reviews.submission_window_hours`).
- **Structured Feedback:** Alongside a 1–5 star integer, reviewers select predefined tags. (For now, the available tags can be hardcoded in the mobile apps to simplify configuration).

---

## Database Schema

### New Collection: `reviews`

Each review is its own document. We do not array-push reviews into the `booking` or `user` document, because querying "all 1-star reviews for a driver" across 50,000 bookings is slow and unwieldy.

```typescript
const ReviewSchema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  
  reviewerId: { type: Schema.Types.ObjectId, required: true },
  reviewerRole: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },
  
  revieweeId: { type: Schema.Types.ObjectId, required: true },
  revieweeRole: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },
  
  rating: { type: Number, min: 1, max: 5, required: true },
  tags: { type: [String], default: [] }, 
  comment: { type: String, maxlength: 500 },
  
  // Is this review visible in average calculations?
  // Kept false until the other party reviews, or 48h elapses.
  isPublished: { type: Boolean, default: false },
  
  // Ops visibility
}, { timestamps: true });

// A user can only review a specific booking once.
ReviewSchema.index({ bookingId: 1, reviewerId: 1 }, { unique: true });

// For fetching all reviews a driver/customer has received.
ReviewSchema.index({ revieweeId: 1, isPublished: 1, createdAt: -1 });
```

### Updates to `drivers` and `customers` collections

We cache the rolling average on the identity documents. High-frequency queries (like dispatch deciding who gets a ride) read from here, not by aggregating the `reviews` collection.

```typescript
// On both Customer and Driver documents
rating: { type: Number, default: 5.0 },
ratingCount: { type: Number, default: 0 },
```

> **Averaging Strategy:** The average is updated via a background worker or upon `isPublished` flipping to `true`. To prevent one bad review years ago from ruining a driver's score, the average is calculated over their **last 100 trips**, not lifetime.

---

## API Contracts

Base URL: `https://api.driverzone.in/v1`

### Customer

| Method | Path | Notes |
|---|---|---|
| `POST` | `/customer/bookings/:id/rate` | Rate the driver for this trip |

#### `POST /customer/bookings/:id/rate`

```jsonc
{
  "rating": 4,
  "tags": ["CLEAN_CAR", "POLITE"],
  "comment": "AC could have been cooler, but great driving."
}
```

**201 CREATED**
```jsonc
{ "id": "rev_01J...", "rating": 4 }
```
*(409 CONFLICT if already rated. 403 FORBIDDEN if the trip isn't `COMPLETED` or doesn't belong to this customer.)*

### Driver

| Method | Path | Notes |
|---|---|---|
| `POST` | `/driver/bookings/:id/rate` | Rate the customer for this trip |

#### `POST /driver/bookings/:id/rate`

```jsonc
{
  "rating": 5,
  "tags": ["ON_TIME"],
  "comment": ""
}
```

**201 CREATED**
```jsonc
{ "id": "rev_01J...", "rating": 5 }
```

### Admin

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/reviews` | `?reviewee_id=&booking_id=&rating_lte=` |
| `DELETE` | `/admin/reviews/:id` | Delete a fraudulent review |
| `PATCH` | `/admin/reviews/:id/flag` | Toggle the ops-attention flag |

#### `GET /admin/reviews`

Queryable ledger of all reviews. Often filtered to `?rating_lte=2` to find trips that need ops intervention — though a 1- or 2-star review already arrives with `admin_flagged` raised, so `?flagged=true` is the usual entry point.

```jsonc
// 200 OK
{
  "data": [
    {
      "id": "rev_01J...",
      "booking_id": "bk_01J...",
      "reviewer": { "id": "...", "role": "CUSTOMER", "name": "Anita Sharma" },
      "reviewee": { "id": "...", "role": "DRIVER", "name": "Bimal Rai" },
      "rating": 1,
      "tags": ["RUDE", "UNSAFE_DRIVING"],
      "comment": "Driver was speeding.",
      "created_at": "2026-08-31T14:22:00Z",
    }
  ],
  "meta": { "total": 1, "page": 1 }
}
```

---

## Business Logic & Lifecycle

1. **Trip Completion:** When `POST /driver/bookings/:id/complete` fires, the app navigates both the Customer and Driver to the Rating screen.
2. **Submission Window:** The API rejects any `POST` to `/rate` if the current time is past `booking.completedAt + settings.reviews.submission_window_hours`.
3. **Submission:** When either party submits a rating within the window, a `Review` document is created with `isPublished: false`.
4. **Visibility & Aggregation (The "Blind" Phase):**
   - If **both** reviews for a booking exist, the second `POST /rate` publishes them itself — there is nothing left to retaliate against once both sides have committed.
   - If only one side ever rates, the worker's sweep (`runSweep` in `apps/api/src/worker.ts`, once a minute) releases it when `submission_window_hours` elapses. It is the same sweep that re-enqueues dropped dispatch jobs, not a second scheduler.
   - Only when `isPublished: true` is the user's overall `rating` cache recomputed. Both paths go through `PublishReviewsUseCase`, so a published review and a stale cache is not a reachable state.
