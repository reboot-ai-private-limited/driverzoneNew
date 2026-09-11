'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button, FormField, Input, Panel } from '@driverzone/design-system';
import { emptyVariantDraft, type FieldErrors, type VariantDraft } from '../lib/draft';
import { CommissionSplitLine } from './CommissionSplitLine';
import { FareField } from './FareField';

export interface VariantsPanelProps {
  title?: string;
  description?: string;
  variants: VariantDraft[];
  errors: FieldErrors;
  disabled: boolean;
  minVariants?: number;
  scopePrefix?: string;
  onChange: (variants: VariantDraft[]) => void;
}

export function VariantsPanel({
  title = 'Variants',
  description = 'A variant is a duration option — 3 hours, 10 hours. The customer picks one, so a quote returns every active variant, not just the cheapest.',
  variants,
  errors,
  disabled,
  minVariants = 0,
  scopePrefix = 'variants',
  onChange,
}: VariantsPanelProps) {
  return (
    <Panel
      title={title}
      actions={
        <div className="flex items-center gap-3">
          {errors[scopePrefix] !== undefined && (
            <span className="text-xs text-danger">{errors[scopePrefix]}</span>
          )}
          <Button
            size="sm"
            variant="secondary"
            icon={<Plus className="size-4" />}
            disabled={disabled}
            onClick={() => onChange([...variants, emptyVariantDraft()])}
          >
            Add variant
          </Button>
        </div>
      }
    >
      <p className="text-xs text-text-subtle mb-4 max-w-3xl">{description}</p>

      {variants.length === 0 ? (
        <p className="text-xs text-text-subtle italic py-2">
          No hourly variants added. Click &quot;Add variant&quot; above to add one.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {variants.map((variant, index) => (
            <VariantCard
              key={variant.key}
              variant={variant}
              index={index}
              errors={errors}
              disabled={disabled}
              scopePrefix={scopePrefix}
              onChange={(next) =>
                onChange(variants.map((current) => (current.key === variant.key ? next : current)))
              }
              onRemove={
                variants.length > minVariants
                  ? () => onChange(variants.filter((current) => current.key !== variant.key))
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

interface VariantCardProps {
  variant: VariantDraft;
  index: number;
  errors: FieldErrors;
  disabled: boolean;
  scopePrefix: string;
  onChange: (next: VariantDraft) => void;
  onRemove?: (() => void) | undefined;
}

function VariantCard({
  variant,
  index,
  errors,
  disabled,
  scopePrefix,
  onChange,
  onRemove,
}: VariantCardProps) {
  const [open, setOpen] = useState(variant.label === '');
  const scope = `${scopePrefix}.${variant.key}`;
  const hasError = Object.keys(errors).some((key) => key.startsWith(`${scope}.`));

  const set = <K extends keyof VariantDraft>(key: K, value: VariantDraft[K]) =>
    onChange({ ...variant, [key]: value });

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-3 px-3 h-11">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 text-sm text-text min-w-0"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="font-medium truncate">
            {variant.label === '' ? `Variant ${index + 1}` : variant.label}
          </span>
        </button>

        <span className="text-xs text-text-subtle truncate">
          {variant.includedMinutes === '' ? '—' : `${variant.includedMinutes} min`} ·{' '}
          {variant.baseFare === '' ? 'unpriced' : `₹${variant.baseFare}`}
        </span>

        {hasError && !open && <span className="text-xs text-danger">needs fixing</span>}
        {!variant.isActive && <span className="text-xs text-text-subtle">inactive</span>}

        <div className="ml-auto">
          {onRemove !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              disabled={disabled}
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-border p-3 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FormField
              label="Label"
              required
              {...(errors[`${scope}.label`] === undefined
                ? {}
                : { error: errors[`${scope}.label`] })}
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  value={variant.label}
                  onChange={(event) => set('label', event.target.value)}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  disabled={disabled}
                  placeholder="3 Hours"
                />
              )}
            </FormField>

            <FormField
              label="Included time"
              hint="Minutes. There is no overage charge past it."
              required
              {...(errors[`${scope}.includedMinutes`] === undefined
                ? {}
                : { error: errors[`${scope}.includedMinutes`] })}
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={variant.includedMinutes}
                  onChange={(event) => set('includedMinutes', event.target.value)}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  disabled={disabled}
                />
              )}
            </FormField>

            <FareField
              label="Base fare"
              value={variant.baseFare}
              onChange={(value) => set('baseFare', value)}
              error={errors[`${scope}.baseFare`]}
              disabled={disabled}
              required
            />

            <FareField
              label="Driver is paid"
              hint="A flat amount. The company keeps the rest of the fare."
              value={variant.driverAmount}
              onChange={(value) => set('driverAmount', value)}
              error={errors[`${scope}.driverAmount`]}
              disabled={disabled}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={variant.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
              disabled={disabled}
              className="size-4 accent-interactive"
            />
            Active
          </label>

          <div className="border-t border-border pt-3">
            <CommissionSplitLine
              label="Base fare"
              fare={variant.baseFare}
              driverAmount={variant.driverAmount}
            />
          </div>
        </div>
      )}
    </div>
  );
}
