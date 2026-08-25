# Packages Module API

The `packages` module acts as the service catalog. It defines the rules and base prices for two main products: **InCity** (hourly rentals) and **Outstation** (long-distance distance bands).

**Base Path:** `/api/packages`

### Authentication & Authorization
All endpoints in this module are administrative endpoints.
- **Header Required:** `Authorization: Bearer <token>`
- **Role Required:** `ADMIN` or `OPS` (Used for catalog management)

---

## 1. InCity Packages

InCity packages are hourly rentals scoped to a `cityZoneId`. They contain variants (e.g., 4 Hrs / 40 km) which contain prices.

### 1.1 Create InCity Package
- **URL:** `POST /api/packages/incity`
- **Body:**
```json
{
  "cityZoneId": "zone_123",
  "name": "Bangalore 4 Hrs / 40 km",
  "description": "Standard InCity Rental",
  "isActive": true,
  "variants": [
    {
      "label": "4 Hrs / 40 km",
      "includedMinutes": 240,
      "includedKm": 40,
      "enforceDropInCity": true,
      "sortOrder": 1,
      "prices": [
        {
          "carCategoryId": "mini_123",
          "baseFarePaise": 50000,
          "nightChargePaise": 5000,
          "driverCommissionType": "PERCENT",
          "driverCommissionValue": 1000,
          "companyCommissionType": "PERCENT",
          "companyCommissionValue": 1500
        }
      ]
    }
  ]
}
```
- **Responses:**
  - `201 Created`
    ```json
    {
      "data": {
        "id": "incity_abc123",
        "cityZoneId": "zone_123",
        "name": "Bangalore 4 Hrs / 40 km",
        "description": "Standard InCity Rental",
        "isActive": true,
        "variants": [
          {
            "id": "variant_xyz789",
            "label": "4 Hrs / 40 km",
            "includedMinutes": 240,
            "includedKm": 40,
            "enforceDropInCity": true,
            "sortOrder": 1,
            "isActive": true,
            "prices": [
              {
                "id": "price_def456",
                "carCategoryId": "mini_123",
                "baseFarePaise": 50000,
                "nightChargePaise": 5000,
                "driverCommissionType": "PERCENT",
                "driverCommissionValue": 1000,
                "companyCommissionType": "PERCENT",
                "companyCommissionValue": 1500,
                "isActive": true
              }
            ]
          }
        ],
        "createdAt": "2026-08-25T10:00:00Z",
        "updatedAt": "2026-08-25T10:00:00Z"
      }
    }
    ```
  - `400 Bad Request`: `VALIDATION_FAILED`
  - `422 Unprocessable Entity`: `PACKAGE_NOT_SELLABLE` (if `isActive: true` but there are no active variants/prices).

### 1.2 List InCity Packages
- **URL:** `GET /api/packages/incity`
- **Query Params:**
  - `isActive`: `true | false` (optional)
- **Responses:**
  - `200 OK`: Array of InCity packages (same schema as Create response).

### 1.3 Get InCity Package by ID
- **URL:** `GET /api/packages/incity/:id`
- **Responses:**
  - `200 OK`: The InCity package object.
  - `404 Not Found`: `NOT_FOUND`

### 1.4 Update InCity Package
- **URL:** `PUT /api/packages/incity/:id`
- **Body:** Partial schema of the Create payload.
- **Responses:**
  - `200 OK`: The updated InCity package entity.
  - `404 Not Found`: `NOT_FOUND`
  - `422 Unprocessable Entity`: `PACKAGE_NOT_SELLABLE`

---

## 2. Outstation Packages

Outstation packages are long-distance trips scoped by `terrain` and a distance band (`minKm` to `maxKm`).

### 2.1 Create Outstation Package
- **URL:** `POST /api/packages/outstation`
- **Body:**
```json
{
  "name": "Pune - Mumbai Drop",
  "terrain": "PLAIN",
  "minKm": 100,
  "maxKm": 200,
  "isActive": true,
  "prices": [
    {
      "carCategoryId": "sedan_123",
      "direction": "ONE_WAY",
      "baseFarePaise": 250000,
      "extraKmRatePaise": 1200,
      "driverAllowancePaise": 30000,
      "driverCommissionType": "PERCENT",
      "driverCommissionValue": 1000,
      "companyCommissionType": "PERCENT",
      "companyCommissionValue": 1500
    }
  ]
}
```
- **Responses:**
  - `201 Created`
    ```json
    {
      "data": {
        "id": "outstation_abc123",
        "name": "Pune - Mumbai Drop",
        "terrain": "PLAIN",
        "minKm": 100,
        "maxKm": 200,
        "isActive": true,
        "prices": [
          {
            "id": "price_def456",
            "carCategoryId": "sedan_123",
            "direction": "ONE_WAY",
            "baseFarePaise": 250000,
            "extraKmRatePaise": 1200,
            "driverAllowancePaise": 30000,
            "driverCommissionType": "PERCENT",
            "driverCommissionValue": 1000,
            "companyCommissionType": "PERCENT",
            "companyCommissionValue": 1500,
            "isActive": true
          }
        ],
        "createdAt": "2026-08-25T10:00:00Z",
        "updatedAt": "2026-08-25T10:00:00Z"
      }
    }
    ```
  - `400 Bad Request`: `VALIDATION_FAILED` (e.g. if minKm >= maxKm)
  - `409 Conflict`: `PACKAGE_BAND_OVERLAP` (Distance band overlaps with an existing package on the same terrain).
  - `422 Unprocessable Entity`: `PACKAGE_NOT_SELLABLE` (if `isActive: true` but there are no active prices).

### 2.2 List Outstation Packages
- **URL:** `GET /api/packages/outstation`
- **Query Params:**
  - `isActive`: `true | false` (optional)
  - `terrain`: `'PLAIN' | 'HILL'` (optional)
- **Responses:**
  - `200 OK`: Array of Outstation packages (same schema as Create response).

### 2.3 Get Outstation Package by ID
- **URL:** `GET /api/packages/outstation/:id`
- **Responses:**
  - `200 OK`: The Outstation package object.
  - `404 Not Found`: `NOT_FOUND`

### 2.4 Update Outstation Package
- **URL:** `PUT /api/packages/outstation/:id`
- **Body:** Partial schema of the Create payload.
- **Responses:**
  - `200 OK`: The updated Outstation package entity.
  - `404 Not Found`: `NOT_FOUND`
  - `409 Conflict`: `PACKAGE_BAND_OVERLAP`
  - `422 Unprocessable Entity`: `PACKAGE_NOT_SELLABLE`
