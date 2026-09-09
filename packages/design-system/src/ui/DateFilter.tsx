'use client';

import { useState, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

export type DatePreset = 'all_time' | 'today' | 'last_7_days' | 'this_month' | 'last_month' | 'custom';

export interface DateRangeValue {
  preset: DatePreset;
  startDate: Date | null;
  endDate: Date | null;
}

export interface DateFilterProps {
  value?: DateRangeValue;
  defaultValue?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  onApply?: (value: DateRangeValue) => void;
  align?: 'start' | 'center' | 'end';
  className?: string;
  trigger?: React.ReactNode;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  all_time: 'All Time',
  today: 'Today',
  last_7_days: 'Last 7 Days',
  this_month: 'This Month',
  last_month: 'Last Month',
  custom: 'Custom',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function isSameDay(d1: Date | null, d2: Date | null): boolean {
  if (!d1 || !d2) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function isDateInRange(target: Date, start: Date | null, end: Date | null): boolean {
  if (!start || !end) return false;
  const t = startOfDay(target).getTime();
  const s = startOfDay(start).getTime();
  const e = startOfDay(end).getTime();
  return t >= Math.min(s, e) && t <= Math.max(s, e);
}

function getPresetRange(preset: DatePreset): { startDate: Date | null; endDate: Date | null } {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { startDate: startOfDay(now), endDate: endOfDay(now) };
    case 'last_7_days': {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { startDate: startOfDay(start), endDate: endOfDay(now) };
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { startDate: startOfDay(start), endDate: endOfDay(end) };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: startOfDay(start), endDate: endOfDay(end) };
    }
    case 'all_time':
    case 'custom':
    default:
      return { startDate: null, endDate: null };
  }
}

export function DateFilter({
  value,
  defaultValue = { preset: 'all_time', startDate: null, endDate: null },
  onChange,
  onApply,
  align = 'start',
  className,
  trigger,
}: DateFilterProps) {
  const [open, setOpen] = useState(false);

  // Controlled or uncontrolled internal state
  const [internalValue, setInternalValue] = useState<DateRangeValue>(value ?? defaultValue);
  const activeValue = value ?? internalValue;

  // Staged / working state inside the popover before user clicks "Apply"
  const [stagedPreset, setStagedPreset] = useState<DatePreset>(activeValue.preset);
  const [stagedStartDate, setStagedStartDate] = useState<Date | null>(activeValue.startDate);
  const [stagedEndDate, setStagedEndDate] = useState<Date | null>(activeValue.endDate);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);

  // Calendar viewport (month/year)
  const initialViewDate = activeValue.startDate || new Date();
  const [viewYear, setViewYear] = useState<number>(initialViewDate.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(initialViewDate.getMonth());

  // Reset staged values whenever popover opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setStagedPreset(activeValue.preset);
      setStagedStartDate(activeValue.startDate);
      setStagedEndDate(activeValue.endDate);
      const targetDate = activeValue.startDate || new Date();
      setViewYear(targetDate.getFullYear());
      setViewMonth(targetDate.getMonth());
    }
    setOpen(isOpen);
  };

  const handleSelectPreset = (preset: DatePreset) => {
    setStagedPreset(preset);
    if (preset !== 'custom') {
      const { startDate, endDate } = getPresetRange(preset);
      setStagedStartDate(startDate);
      setStagedEndDate(endDate);
      if (startDate) {
        setViewYear(startDate.getFullYear());
        setViewMonth(startDate.getMonth());
      }
    }
  };

  const handleSelectDay = (dayDate: Date) => {
    setStagedPreset('custom');
    if (!stagedStartDate || (stagedStartDate && stagedEndDate)) {
      setStagedStartDate(startOfDay(dayDate));
      setStagedEndDate(null);
    } else if (stagedStartDate && !stagedEndDate) {
      if (dayDate.getTime() < stagedStartDate.getTime()) {
        setStagedStartDate(startOfDay(dayDate));
        setStagedEndDate(null);
      } else {
        setStagedEndDate(endOfDay(dayDate));
      }
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleClear = () => {
    setStagedPreset('all_time');
    setStagedStartDate(null);
    setStagedEndDate(null);
  };

  const handleApply = () => {
    const finalValue: DateRangeValue = {
      preset: stagedPreset,
      startDate: stagedStartDate,
      endDate: stagedEndDate,
    };
    setInternalValue(finalValue);
    onChange?.(finalValue);
    onApply?.(finalValue);
    setOpen(false);
  };

  // Generate calendar grid days
  const calendarDays = useMemo(() => {
    const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const days: Array<{
      date: Date;
      isCurrentMonth: boolean;
      dayNumber: number;
    }> = [];

    // Leading days from previous month
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      days.push({
        date: new Date(viewYear, viewMonth - 1, d),
        isCurrentMonth: false,
        dayNumber: d,
      });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({
        date: new Date(viewYear, viewMonth, d),
        isCurrentMonth: true,
        dayNumber: d,
      });
    }

    // Trailing days from next month to complete rows (grid multiples of 7)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      days.push({
        date: new Date(viewYear, viewMonth + 1, d),
        isCurrentMonth: false,
        dayNumber: d,
      });
    }

    return days;
  }, [viewYear, viewMonth]);

  // Year options for the selector dropdown
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear - 5; y <= currentYear + 5; y++) {
      years.push(y);
    }
    return years;
  }, []);

  // Format trigger display label
  const triggerLabel = useMemo(() => {
    if (activeValue.preset !== 'custom') {
      return PRESET_LABELS[activeValue.preset];
    }
    if (activeValue.startDate && activeValue.endDate) {
      const formatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
      return `${formatter.format(activeValue.startDate)} – ${formatter.format(activeValue.endDate)}`;
    }
    if (activeValue.startDate) {
      const formatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
      return `From ${formatter.format(activeValue.startDate)}`;
    }
    return 'Custom Date';
  }, [activeValue]);

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              'inline-flex items-center justify-between gap-2 h-10 px-3 rounded-md',
              'bg-surface text-sm text-text border border-border-strong hover:bg-surface-muted',
              'transition-colors cursor-pointer outline-none focus:border-interactive',
              className,
            )}
          >
            <span className="inline-flex items-center gap-2">
              <CalendarIcon aria-hidden className="size-4 text-text-subtle" />
              <span className="font-medium">{triggerLabel}</span>
            </span>
            <ChevronDown aria-hidden className="size-3.5 text-text-subtle" />
          </button>
        )}
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={6}
          // Opaque surface + border-strong, NO shadow as per design-language.md §Principles
          className={cn(
            'z-50 flex rounded-lg bg-surface border border-border-strong overflow-hidden',
            'animate-in fade-in-0 zoom-in-95 duration-100',
          )}
        >
          {/* Left Panel: Presets */}
          <div className="w-44 p-4 border-r border-border flex flex-col bg-surface-sunken/40">
            <span className="text-sm font-semibold text-text mb-3.5">Presets</span>
            <div className="flex flex-col gap-1">
              {(Object.keys(PRESET_LABELS) as DatePreset[]).map((preset) => {
                const isSelected = stagedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={cn(
                      'flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-left transition-colors cursor-pointer',
                      isSelected ? 'text-text font-medium' : 'text-text-subtle hover:text-text hover:bg-surface-muted',
                    )}
                  >
                    {/* Radio indicator circle */}
                    <span
                      className={cn(
                        'size-4 rounded-full border flex items-center justify-center transition-colors shrink-0',
                        isSelected ? 'border-interactive bg-surface' : 'border-border-strong',
                      )}
                    >
                      {isSelected && <span className="size-2 rounded-full bg-interactive" />}
                    </span>
                    <span>{PRESET_LABELS[preset]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Calendar & Actions */}
          <div className="p-4 flex flex-col gap-3 min-w-[290px]">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
              SELECT DATES
            </span>

            {/* Calendar Box */}
            <div className="border border-border rounded-md p-3 bg-surface">
              {/* Month / Year header with arrows */}
              <div className="flex items-center justify-between gap-1 mb-3">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  aria-label="Previous month"
                  className="size-7 flex items-center justify-center rounded text-text-subtle hover:text-text hover:bg-surface-muted transition-colors cursor-pointer"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </button>

                <div className="flex items-center gap-1.5">
                  {/* Month Select */}
                  <div className="relative inline-flex items-center">
                    <select
                      value={viewMonth}
                      onChange={(e) => setViewMonth(Number(e.target.value))}
                      className="appearance-none bg-surface text-text text-sm font-medium pl-2.5 pr-6 py-1 rounded-md border border-border-strong hover:bg-surface-muted cursor-pointer focus:outline-none focus:border-interactive"
                    >
                      {MONTH_NAMES.map((name, i) => (
                        <option key={name} value={i}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden className="absolute right-1.5 size-3.5 text-text-subtle pointer-events-none" />
                  </div>

                  {/* Year Select */}
                  <div className="relative inline-flex items-center">
                    <select
                      value={viewYear}
                      onChange={(e) => setViewYear(Number(e.target.value))}
                      className="appearance-none bg-surface text-text text-sm font-medium pl-2.5 pr-6 py-1 rounded-md border border-border-strong hover:bg-surface-muted cursor-pointer focus:outline-none focus:border-interactive tnum"
                    >
                      {yearOptions.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden className="absolute right-1.5 size-3.5 text-text-subtle pointer-events-none" />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="Next month"
                  className="size-7 flex items-center justify-center rounded text-text-subtle hover:text-text hover:bg-surface-muted transition-colors cursor-pointer"
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
              </div>

              {/* Day names row */}
              <div className="grid grid-cols-7 text-center text-xs font-medium text-text-subtle mb-1">
                {WEEKDAY_NAMES.map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              {/* Day cells grid */}
              <div
                className="grid grid-cols-7 gap-y-0.5 text-center text-sm tnum"
                onMouseLeave={() => setHoverDate(null)}
              >
                {calendarDays.map(({ date, isCurrentMonth, dayNumber }) => {
                  const isStart = isSameDay(date, stagedStartDate);
                  const isEnd = isSameDay(date, stagedEndDate);
                  const effectiveEnd = stagedEndDate || (stagedStartDate ? hoverDate : null);
                  const isInRange =
                    stagedStartDate && effectiveEnd
                      ? isDateInRange(date, stagedStartDate, effectiveEnd)
                      : false;

                  const isRangeBoundary = isStart || isEnd;

                  return (
                    <div
                      key={date.toISOString()}
                      className={cn(
                        'relative flex items-center justify-center h-8',
                        isInRange && !isRangeBoundary && 'bg-surface-muted',
                        isStart && effectiveEnd && !isSameDay(stagedStartDate, effectiveEnd) && 'bg-surface-muted rounded-l-md',
                        isEnd && stagedStartDate && !isSameDay(stagedStartDate, stagedEndDate) && 'bg-surface-muted rounded-r-md',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectDay(date)}
                        onMouseEnter={() => {
                          if (stagedStartDate && !stagedEndDate) {
                            setHoverDate(date);
                          }
                        }}
                        className={cn(
                          'size-8 flex items-center justify-center rounded-md transition-colors cursor-pointer text-xs font-medium',
                          // Current month vs other months
                          !isCurrentMonth && 'text-text-subtle opacity-35',
                          isCurrentMonth && !isRangeBoundary && 'text-text hover:bg-surface-muted',
                          // Selected boundaries get accent fill + dark text as per design tokens
                          isRangeBoundary && 'bg-accent text-accent-ink font-bold hover:bg-accent-hover',
                        )}
                      >
                        {dayNumber}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer buttons: Clear & Apply */}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleClear}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleApply}
              >
                Apply
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
