'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import type { Polygon } from '@driverzone/geo';
import { Button, Dialog } from '@driverzone/design-system';
import { parseZoneGeoJson } from '../lib/geojson-import';

/**
 * Paste a boundary in. THE PRIMARY WAY A ZONE SHOULD GET ITS SHAPE — see `geojson-import.ts`.
 *
 * The reason this is not a corner-case feature: the city zone and every hill zone correspond to
 * a boundary that already exists and is published. Siliguri Municipal Corporation, the
 * Darjeeling and Kalimpong subdivisions — all of them are OSM relations, exportable in about a
 * minute. Hand-tracing a shape that is already drawn somewhere is slower and less accurate on
 * any basemap, commercial ones included, and it puts a zone edge in the wrong place with nobody
 * able to say by how much.
 *
 * Which matters most for hill zones, where the edge IS the price boundary.
 */
export function GeoJsonImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (polygon: Polygon) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);

  const reset = (): void => {
    setText('');
    setError(undefined);
    setNote(undefined);
  };

  const submit = (): void => {
    const result = parseZoneGeoJson(text);
    if (!result.ok) {
      setError(result.message);
      setNote(undefined);
      return;
    }
    // The note is shown by the caller alongside the imported shape, not here — the dialog is
    // closing, and a message that vanishes with it has not been read.
    onImport(result.polygon);
    if (result.note !== undefined) setNote(result.note);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Import a boundary"
      description="Paste GeoJSON — a Feature, a FeatureCollection, or a bare geometry."
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={text.trim() === ''}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="flex items-start gap-1.5 text-xs text-text-subtle">
          <Info aria-hidden className="size-3.5 shrink-0 mt-px" />
          Administrative boundaries — a municipal corporation, a subdivision — are published as OSM
          relations and export straight to GeoJSON. Starting from one is faster and more accurate
          than tracing it.
        </p>

        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(undefined);
          }}
          rows={10}
          spellCheck={false}
          placeholder='{ "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [ … ] } }'
          aria-label="GeoJSON"
          aria-invalid={error !== undefined || undefined}
          className="w-full p-2 rounded-md bg-surface text-text font-mono text-xs border border-border-strong placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-interactive resize-y aria-invalid:border-danger"
        />

        {error !== undefined && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {note !== undefined && <p className="text-xs text-warning">{note}</p>}

        <p className="text-xs text-text-subtle">
          The winding order is normalised on import, so a clockwise ring from any exporter is safe
          to paste.
        </p>
      </div>
    </Dialog>
  );
}
