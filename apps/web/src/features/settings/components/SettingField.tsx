'use client';

import { useId } from 'react';
import { RotateCcw } from 'lucide-react';
import { Badge, IconButton, Input, cn } from '@driverzone/design-system';
import type { SettingDto } from '@driverzone/contracts';
import { type Draft, isWindowDraft } from '../lib/draft';

/**
 * One setting, rendered from its own metadata.
 *
 * NOTHING HERE KNOWS ANY SETTING BY NAME. The control is chosen by `unit`, the copy is the
 * server's `label` and `description`, and the reset affordance is driven by `is_overridden`. That
 * is the whole point of the registry on the API side: a setting added next month appears here,
 * correctly rendered, with no edit to this file. A `switch` on `key` would undo that on its first
 * special case.
 *
 * The label/control wiring is done by hand rather than with `<FormField>`, which stacks its label
 * above its control. A settings list reads far better as a two-column row — what it is on the
 * left, what it is set to on the right — and this keeps the same `aria-describedby` and
 * `role="alert"` contract that component establishes.
 */

const UNIT_SUFFIX: Record<string, string> = {
  MINUTES: 'minutes',
  SECONDS: 'seconds',
  COUNT: '',
};

export interface SettingFieldProps {
  setting: SettingDto;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** Client-side parse failure or a server message mapped back onto this key. */
  error?: string | undefined;
  dirty: boolean;
  onReset: () => void;
  resetting: boolean;
  disabled: boolean;
}

export function SettingField({
  setting,
  draft,
  onChange,
  error,
  dirty,
  onReset,
  resetting,
  disabled,
}: SettingFieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const describedBy = error !== undefined ? messageId : `${id}-description`;

  return (
    <div
      className={cn(
        'grid grid-cols-1 md:grid-cols-[1fr_20rem] gap-x-6 gap-y-2 py-4',
        // The changed marker is a rail down the left edge rather than a background wash: at a
        // dozen edited rows a tinted background turns the page into a colour field, and the
        // admin still has to read every row to find what they touched.
        dirty && 'border-l-2 border-l-interactive -ml-4 pl-4',
      )}
    >
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor={id} className="text-sm font-medium text-text">
            {setting.label}
          </label>
          {setting.is_overridden && !dirty && <Badge tone="info">Changed</Badge>}
          {dirty && <Badge tone="warning">Unsaved</Badge>}
        </div>
        <p id={`${id}-description`} className="text-xs text-text-subtle">
          {setting.description}
        </p>
        <p className="text-xs text-text-subtle font-mono">{setting.key}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Control
            id={id}
            setting={setting}
            draft={draft}
            onChange={onChange}
            invalid={error !== undefined}
            describedBy={describedBy}
            disabled={disabled}
          />
          {/*
            Reset is a SERVER action, not a local revert — it deletes the override so the
            built-in default takes over, which is a different outcome from typing the default
            value back in. Only offered on a key that actually has an override to delete.
          */}
          {setting.is_overridden && (
            <IconButton
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-4" />}
              label={`Reset ${setting.label} to its default`}
              title={`Reset to default (${describeValue(setting.default_value)})`}
              onClick={onReset}
              loading={resetting}
              disabled={disabled}
            />
          )}
        </div>

        {error !== undefined ? (
          <p id={messageId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : (
          <p className="text-xs text-text-subtle">
            Default: {describeValue(setting.default_value)}
          </p>
        )}
      </div>
    </div>
  );
}

interface ControlProps {
  id: string;
  setting: SettingDto;
  draft: Draft;
  onChange: (draft: Draft) => void;
  invalid: boolean;
  describedBy: string;
  disabled: boolean;
}

function Control({ id, setting, draft, onChange, invalid, describedBy, disabled }: ControlProps) {
  if (setting.unit === 'TIME_WINDOW') {
    const window = isWindowDraft(draft) ? draft : { start: '', end: '' };
    return (
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="time"
          value={window.start}
          onChange={(e) => onChange({ ...window, start: e.target.value })}
          invalid={invalid}
          aria-describedby={describedBy}
          aria-label={`${setting.label} — start`}
          disabled={disabled}
          className="w-32"
        />
        <span className="text-xs text-text-subtle shrink-0">to</span>
        <Input
          type="time"
          value={window.end}
          onChange={(e) => onChange({ ...window, end: e.target.value })}
          invalid={invalid}
          aria-describedby={describedBy}
          aria-label={`${setting.label} — end`}
          disabled={disabled}
          className="w-32"
        />
      </div>
    );
  }

  const text = isWindowDraft(draft) ? '' : draft;
  const suffix = UNIT_SUFFIX[setting.unit] ?? '';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="relative">
        {setting.unit === 'RUPEES' && (
          <span
            aria-hidden
            className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-text-subtle"
          >
            ₹
          </span>
        )}
        <Input
          id={id}
          // `inputMode` rather than `type="number"`: a number input's spinner and scroll-wheel
          // behaviour changes a fare by accident, and Safari accepts `1e3` in one. The value is
          // parsed and range-checked in `lib/draft.ts` either way.
          inputMode="numeric"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          invalid={invalid}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn('w-32', setting.unit === 'RUPEES' && 'pl-6')}
        />
      </div>
      {suffix !== '' && <span className="text-xs text-text-subtle shrink-0">{suffix}</span>}
    </div>
  );
}

/** Used for "Default: …" and the reset tooltip. Windows read as a range, money keeps its ₹. */
export function describeValue(value: SettingDto['default_value']): string {
  if (typeof value === 'number') return String(value);
  return `${value.start}–${value.end}`;
}
