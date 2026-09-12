'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import type { Direction, ExplainTripResponse } from '@driverzone/contracts';
import {
  Badge,
  Button,
  DefinitionList,
  FieldRow,
  FormField,
  Input,
  Panel,
  Select,
} from '@driverzone/design-system';
import { quotesApi } from '@/lib/api/endpoints/quotes';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * "WHY WAS THIS TRIP PRICED THAT WAY?" — two pairs of coordinates in, the server's own verdict out.
 *
 * WHAT IT IS FOR. The recurring report is "an in-city tour that also falls inside an outstation
 * band's range gets charged as outstation". It does not: in-city outranks outstation
 * unconditionally, at every distance, in both directions, and the quote path tries it FIRST —
 * before it even measures the road. So that report is always one of three facts about the data,
 * and until this screen existed all three looked identical from the outside:
 *
 *   1. the drop point is outside the city polygon (in-city needs BOTH points in ONE city zone),
 *   2. the pickup is outside every city polygon,
 *   3. that city has no in-city package, or every variant on it is switched off.
 *
 * IT RUNS THE REAL LADDER, not a description of it — the same `resolveForTrip` a customer's quote
 * goes through — so a verdict here cannot differ from the price a customer would be given. It
 * creates no quote and charges nothing.
 *
 * ENABLED ONLY ONCE ALL FOUR COORDINATES PARSE. A half-typed latitude would otherwise fire a
 * request per keystroke at a point in the Bay of Bengal.
 */
const DIRECTIONS: Array<{ value: Direction; label: string }> = [
  { value: 'ONE_WAY', label: 'One way' },
  { value: 'ROUND_TRIP', label: 'Round trip' },
];

interface Coords {
  pickupLat: string;
  pickupLng: string;
  dropLat: string;
  dropLng: string;
}

const EMPTY: Coords = { pickupLat: '', pickupLng: '', dropLat: '', dropLng: '' };

export function TripResolutionPanel() {
  const [draft, setDraft] = useState<Coords>(EMPTY);
  const [direction, setDirection] = useState<Direction>('ONE_WAY');
  /**
   * The coordinates ACTUALLY ASKED ABOUT, committed on submit rather than read from `draft`.
   *
   * Typing is not a question. Querying off the draft would fire a request per keystroke and, far
   * worse, swap the verdict under someone who is halfway through correcting one digit of a
   * longitude — so the answer on screen would belong to a trip they never asked about.
   */
  const [asked, setAsked] = useState<Coords | null>(null);

  const parsed = asked === null ? null : parseCoords(asked);

  const explain = useQuery(
    authedQueryOptions({
      queryKey: keys.tripResolution.explain(
        parsed === null ? '' : `${JSON.stringify(parsed)}|${direction}`,
      ),
      fetch: (token, signal) =>
        quotesApi.explainTrip(token, { ...(parsed ?? blank()), direction }, signal),
      enabled: parsed !== null,
      staleTime: staleTime.configuration,
    }),
  );

  const ready = parseCoords(draft) !== null;

  return (
    <Panel
      title="Why did this trip price that way?"
      icon={<Compass className="size-4" />}
      className="mt-4"
    >
      <p className="text-xs text-text-subtle max-w-3xl mb-4">
        Paste the pickup and drop coordinates of a trip and see which product the server picks, and
        why. In-city always beats outstation when both points are inside the same city zone — so a
        trip across town that priced as an outstation band means the drop fell outside the polygon,
        or that city has nothing sellable. This reads only; nothing is quoted or charged.
      </p>

      <form
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setAsked(draft);
        }}
      >
        <CoordField
          label="Pickup latitude"
          value={draft.pickupLat}
          onChange={(pickupLat) => setDraft({ ...draft, pickupLat })}
        />
        <CoordField
          label="Pickup longitude"
          value={draft.pickupLng}
          onChange={(pickupLng) => setDraft({ ...draft, pickupLng })}
        />
        <CoordField
          label="Drop latitude"
          value={draft.dropLat}
          onChange={(dropLat) => setDraft({ ...draft, dropLat })}
        />
        <CoordField
          label="Drop longitude"
          value={draft.dropLng}
          onChange={(dropLng) => setDraft({ ...draft, dropLng })}
        />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FormField label="Direction">
              {({ id }) => (
                <Select
                  id={id}
                  value={direction}
                  onValueChange={(value) => setDirection(value as Direction)}
                  options={DIRECTIONS}
                />
              )}
            </FormField>
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={!ready}>
            Resolve
          </Button>
        </div>
      </form>

      {explain.isError && (
        <p className="text-xs text-danger mt-4" role="alert">
          {explain.error.message}
        </p>
      )}

      {explain.data !== undefined && !explain.isFetching && <Verdict result={explain.data} />}
    </Panel>
  );
}

function CoordField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <FormField label={label}>
      {({ id }) => (
        <Input
          id={id}
          value={value}
          inputMode="decimal"
          placeholder="26.7271"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

/**
 * The answer, and — when it is the one people come here about — the sentence that says what to fix.
 *
 * THE DIAGNOSIS IS THE POINT. Rendering the trace as bare rows would leave an admin to work out
 * for themselves that `NO_ACTIVE_VARIANT` on a same-city trip means somebody switched off the
 * hourly durations, which is the whole job this screen exists to do for them.
 */
function Verdict({ result }: { result: ExplainTripResponse }) {
  const { trace, verdict } = result;
  const misrouted = trace !== null && trace.to_same_city_zone && verdict.service_type === 'OUTSTATION';

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {verdict.service_type === null ? (
          <Badge tone="danger">Nothing to sell</Badge>
        ) : (
          <Badge tone={verdict.service_type === 'INCITY' ? 'success' : 'neutral'}>
            {verdict.service_type === 'INCITY' ? 'In-city' : 'Outstation'}
          </Badge>
        )}
        <span className="text-sm text-text">
          {verdict.unavailable ?? verdict.package_name ?? '—'}
        </span>
      </div>

      {misrouted && (
        <p className="text-xs text-danger max-w-3xl" role="alert">
          {diagnosis(trace.incity_rejected)}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        <DefinitionList>
          <FieldRow label="Pickup zone">{result.from.pickup_zone?.name ?? 'not served'}</FieldRow>
          <FieldRow label="Pickup city">{result.from.city_zone?.name ?? 'no city zone'}</FieldRow>
          <FieldRow label="Drop city">{result.to.city_zone?.name ?? 'no city zone'}</FieldRow>
          <FieldRow label="Drop hill zone">{result.to.hill_zone?.name ?? 'none'}</FieldRow>
        </DefinitionList>

        <DefinitionList>
          <FieldRow label="Same city">{trace?.to_same_city_zone === true ? 'yes' : 'no'}</FieldRow>
          <FieldRow label="Road distance">
            {result.distance_km === null ? '—' : `${result.distance_km.toFixed(1)} km`}
          </FieldRow>
          <FieldRow label="In-city packages found">{trace?.incity_candidates ?? 0}</FieldRow>
          <FieldRow label="Outstation bands found">{trace?.outstation_candidates ?? 0}</FieldRow>
        </DefinitionList>
      </div>
    </div>
  );
}

/** What to actually DO about each way in-city can lose a trip it should have won. */
function diagnosis(reason: string | null): string {
  if (reason === 'NO_PACKAGE_FOR_CITY') {
    return 'Both points are in the same city, but that city zone has no in-city package at all — so every trip across town prices as a long-distance band. Create one on the InCity tab.';
  }
  if (reason === 'NO_ACTIVE_VARIANT') {
    return 'Both points are in the same city and an in-city package exists, but every duration on it is switched off. Re-activate a variant and this trip prices hourly again.';
  }
  return 'This trip resolved to an outstation band. The in-city ladder was not the reason — check the zones above.';
}

/** Four coordinates, or null when any of them is not a number a point can be built from. */
function parseCoords(raw: Coords): {
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
} | null {
  const values = {
    pickupLat: Number(raw.pickupLat.trim()),
    pickupLng: Number(raw.pickupLng.trim()),
    dropLat: Number(raw.dropLat.trim()),
    dropLng: Number(raw.dropLng.trim()),
  };

  const blankField = Object.values(raw).some((value) => value.trim() === '');
  if (blankField || Object.values(values).some((value) => !Number.isFinite(value))) return null;

  return values;
}

/** Never actually requested — the query is disabled until `parseCoords` returns real ones. */
function blank() {
  return { pickupLat: 0, pickupLng: 0, dropLat: 0, dropLng: 0 };
}
