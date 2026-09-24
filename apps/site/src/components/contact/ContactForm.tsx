'use client';

import { useState, useCallback, type ReactElement } from 'react';

const WA_NUMBER = '918509299342';

const PACKAGES = [
  'In-City One Way',
  'In-City Round Trip',
  'Mini Outstation One Way',
] as const;

type FormState = { name: string; mobile: string; pkg: string; location: string; message: string };
type Errors    = Partial<Record<keyof FormState, string | undefined>>;

const base =
  'w-full rounded-lg border px-4 py-3 text-[14px] text-fg placeholder-muted outline-none transition-colors';
const normal  = `${base} border-border bg-bg focus:border-brand focus:ring-1 focus:ring-brand`;
const errored = `${base} border-red-400 bg-red-50 focus:border-red-500 focus:ring-1 focus:ring-red-400`;

function fieldCls(err?: string) { return err ? errored : normal; }

function validate(f: FormState): Errors {
  const e: Errors = {};
  if (!f.name.trim())                       e.name     = 'Name is required';
  if (!f.mobile.trim())                     e.mobile   = 'Mobile number is required';
  else if (f.mobile.length !== 10)          e.mobile   = 'Enter a valid 10-digit mobile number';
  if (!f.pkg)                               e.pkg      = 'Please select a package';
  if (!f.location.trim())                   e.location = 'Location is required';
  return e;
}

export function ContactForm(): ReactElement {
  const [form, setForm] = useState<FormState>({ name: '', mobile: '', pkg: '', location: '', message: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);

  const setField = useCallback(
    (field: keyof FormState) =>
      (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const value = e.target.value;
        setForm((prev) => ({ ...prev, [field]: value }));
        // Clear error on change
        if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined as string | undefined }));
      },
    [errors],
  );

  const onMobileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Numeric only, max 10 digits
      const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
      setForm((prev) => ({ ...prev, mobile: digits }));
      if (errors.mobile) setErrors((prev) => ({ ...prev, mobile: undefined as string | undefined }));
    },
    [errors.mobile],
  );

  const handleSubmit = useCallback(() => {
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitted(true);

    const lines = [
      '*New Booking Enquiry — DriverZone*',
      '',
      `Name: ${form.name}`,
      `Mobile: +91 ${form.mobile}`,
      `Package: ${form.pkg}`,
      `Location: ${form.location}`,
      ...(form.message.trim() ? [`Message: ${form.message}`] : []),
    ];

    window.open(
      `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`,
      '_blank',
      'noopener,noreferrer',
    );

    // Reset after short delay so user sees the success state
    setTimeout(() => {
      setForm({ name: '', mobile: '', pkg: '', location: '', message: '' });
      setErrors({});
      setSubmitted(false);
    }, 3000);
  }, [form]);

  return (
    <div className="rounded-2xl border border-border bg-bg p-8">
      <h2 className="text-xl font-bold text-fg">Get Estimate For Your Project</h2>

      <div className="mt-6 space-y-4">

        {/* Row 1 — Name | Mobile */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <input
              type="text"
              placeholder="Name *"
              value={form.name}
              onChange={setField('name')}
              className={fieldCls(errors.name)}
            />
            {errors.name && <p className="mt-1 text-[12px] text-red-500">{errors.name}</p>}
          </div>
          <div>
            <input
              type="tel"
              inputMode="numeric"
              placeholder="Mobile Number (WhatsApp) *"
              value={form.mobile}
              onChange={onMobileChange}
              maxLength={10}
              className={fieldCls(errors.mobile)}
            />
            {errors.mobile && <p className="mt-1 text-[12px] text-red-500">{errors.mobile}</p>}
          </div>
        </div>

        {/* Row 2 — Package | Location */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="relative">
              <select
                value={form.pkg}
                onChange={setField('pkg')}
                className={`${fieldCls(errors.pkg)} appearance-none cursor-pointer`}
              >
                <option value="" disabled>Select Package *</option>
                {PACKAGES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            {errors.pkg && <p className="mt-1 text-[12px] text-red-500">{errors.pkg}</p>}
          </div>
          <div>
            <input
              type="text"
              placeholder="Location *"
              value={form.location}
              onChange={setField('location')}
              className={fieldCls(errors.location)}
            />
            {errors.location && <p className="mt-1 text-[12px] text-red-500">{errors.location}</p>}
          </div>
        </div>

        {/* Textarea — optional */}
        <textarea
          placeholder="Message (Optional)"
          value={form.message}
          onChange={setField('message')}
          rows={5}
          className={`${normal} resize-none`}
        />

        {/* Submit row */}
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitted}
            className="rounded-pill bg-brand px-7 py-2.5 text-sm font-bold text-fg transition-opacity hover:opacity-90 active:scale-[0.97] disabled:opacity-60 whitespace-nowrap"
          >
            {submitted ? 'Sent!' : 'Request Call'}
          </button>
          <p className="text-[13px] leading-snug text-muted">
            Our Customer Support Team Will Contact You With In 24 Hrs.
          </p>
        </div>

      </div>
    </div>
  );
}
