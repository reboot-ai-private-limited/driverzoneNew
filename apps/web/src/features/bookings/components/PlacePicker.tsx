'use client';

import { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { Input, cn } from '@driverzone/design-system';
import { hasApiKey } from '@/lib/googleMaps';
import type { TripPoint } from '../lib/newBooking';

/**
 * One end of the trip, as the FORM shows it.
 *
 * With a Maps key the point is set on the map beside the form (`BookingPickerMap`) — by search,
 * click or drag — and this field is its read-out: what was chosen, which end the map is currently
 * setting (`active`), a click to switch the map to this end, and a clear.
 *
 * WITHOUT A KEY there is no map, so the field takes an address line and a typed coordinate.
 * Clumsy, but it lets a development panel without credentials still book.
 */
export function PlacePicker({
  label,
  value,
  active,
  color,
  onActivate,
  onChange,
}: {
  label: string;
  value: TripPoint | null;
  active: boolean;
  /** The pin's colour on the map, so the field and the pin read as the same thing. */
  color: string;
  onActivate: () => void;
  onChange: (point: TripPoint | null) => void;
}) {
  if (!hasApiKey && value === null) return <ManualPoint label={label} onPick={onChange} />;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onActivate();
      }}
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2',
        active && hasApiKey ? 'border-interactive ring-2 ring-interactive/30' : 'border-border',
        value === null ? 'bg-surface' : 'bg-surface-muted',
      )}
    >
      <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" style={{ color }} />
      <div className="flex min-w-0 flex-1 flex-col">
        {value === null ? (
          <span className="text-sm text-text-subtle">
            {active ? 'Search above the map, or click the map' : `Click to set the ${label.toLowerCase()}`}
          </span>
        ) : (
          <>
            <span className="text-sm font-medium">{value.address}</span>
            <span className="text-xs tabular-nums text-text-subtle">
              {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
              {active && hasApiKey ? ' · drag the pin to adjust' : ''}
            </span>
          </>
        )}
      </div>
      {value !== null && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          className="text-text-subtle hover:text-interactive"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
            onActivate();
          }}
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The keyless fallback: an address line and a pasted `lat, lng`. */
function ManualPoint({ label, onPick }: { label: string; onPick: (point: TripPoint) => void }) {
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState('');

  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coords);
  const ready = address.trim() !== '' && match !== null;

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder={`${label} address`}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <div className="flex gap-2">
        <Input
          placeholder="Latitude, longitude — e.g. 26.72710, 88.39530"
          value={coords}
          onChange={(e) => setCoords(e.target.value)}
        />
        <button
          type="button"
          disabled={!ready}
          className="rounded-md border border-border px-3 text-sm disabled:opacity-50"
          onClick={() => {
            if (match === null) return;
            onPick({ lat: Number(match[1]), lng: Number(match[2]), address: address.trim() });
          }}
        >
          Use
        </button>
      </div>
    </div>
  );
}
