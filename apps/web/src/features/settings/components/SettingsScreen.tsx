'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import {
  Button,
  DataState,
  PageHeader,
  Panel,
  Skeleton,
  TopProgressBar,
  toast,
} from '@driverzone/design-system';
import type { SettingDto } from '@driverzone/contracts';
import { ApiError } from '@/lib/api/ApiError';
import { toErrorState } from '@/lib/api/toErrorState';
import { useSettings } from '../hooks/useSettings';
import { useResetSettings, useUpdateSettings } from '../hooks/useSettingsMutations';
import { diffDrafts, mapFieldErrors, mergeDrafts, toDrafts, type Draft, type Drafts } from '../lib/draft';
import { SettingField } from './SettingField';

/**
 * The global settings screen — the fare, waiting, dispatch and cancellation numbers ops tunes
 * without a deploy.
 *
 * THE FORM IS NOT HAND-BUILT. It renders from `GET /admin/settings`, which returns every key with
 * its group, label, unit and description, so a setting added on the API side appears here with no
 * change to this file (see `SettingField`). What this component owns is the part that is genuinely
 * about the page rather than about any one field: the drafts, what has changed, and the save.
 *
 * ONE SAVE FOR THE WHOLE PAGE, because the API checks cross-key rules against the configuration
 * the write would produce. Moving the early-morning window is a valid edit on its own and
 * incoherent next to a late-night window it would overlap; per-field autosave would let exactly
 * that through, one request at a time. So: edit freely, save once, and a rejection lands on the
 * fields that caused it.
 */
export function SettingsScreen() {
  const query = useSettings();

  /**
   * `undefined` until the first payload arrives — distinct from `{}`, which would mean "loaded,
   * and the admin has cleared every field".
   */
  const [drafts, setDrafts] = useState<Drafts | undefined>(undefined);
  /** Server-side messages, keyed by setting. Cleared on the next edit of that field. */
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  /** Which key a reset is in flight for, so only that row's button spins. */
  const [resetting, setResetting] = useState<string | undefined>(undefined);

  /**
   * Keys the admin has actually typed in, kept in a ref because nothing renders from it.
   *
   * This is what stops a refetch eating unsaved work. Resetting one field invalidates the whole
   * query, so the payload identity changes and the seeding effect below runs — with a plain
   * reseed that would wipe every OTHER field the admin had edited and not yet saved. Comparing
   * drafts against the server values cannot tell those apart either: a just-reset key looks
   * "edited" too, because the local draft still holds the override that was deleted.
   *
   * So the record is explicit. A key is touched when it is typed in, and untouched again once the
   * server has accepted it — saved, reset, or discarded.
   */
  const touched = useRef<Record<string, true>>({});

  const groups = useMemo(() => query.data?.groups ?? [], [query.data]);
  const settings = useMemo(() => groups.flatMap((group) => group.settings), [groups]);

  /**
   * Seeded from the server, and re-seeded whenever the payload identity changes — which happens
   * after a save or a reset, since both invalidate the query. That is what makes the saved values
   * the new baseline: without it every field would still read as changed against the values the
   * page was opened with.
   *
   * FIELDS THE ADMIN IS STILL EDITING SURVIVE IT. Everything else takes the server's value, so a
   * reset shows up immediately and a save settles, while three half-finished edits elsewhere on
   * the page are not silently thrown away by an invalidation the admin did not ask for.
   */
  useEffect(() => {
    if (query.data === undefined) return;
    const fresh = toDrafts(query.data.groups.flatMap((group) => group.settings));
    setDrafts((current) =>
      current === undefined ? fresh : mergeDrafts(fresh, current, Object.keys(touched.current)),
    );
    setServerErrors({});
  }, [query.data]);

  const { values, invalid, dirtyKeys } = useMemo(
    () => (drafts === undefined ? { values: {}, invalid: {}, dirtyKeys: [] } : diffDrafts(settings, drafts)),
    [settings, drafts],
  );

  /** The server has taken these, so they are no longer the admin's uncommitted work. */
  const release = useCallback((settled: readonly string[]) => {
    for (const key of settled) delete touched.current[key];
  }, []);

  const update = useUpdateSettings((result) => {
    release(result.updated);
    toast.success(
      result.updated.length === 1
        ? '1 setting updated.'
        : `${result.updated.length} settings updated.`,
    );
  });

  const reset = useResetSettings((result) => {
    // Released by the key that was ASKED for, not the one that came back: the API returns an
    // empty list when there was no override to delete, and leaving that key marked as the
    // admin's own work would make the reseed keep a stale draft forever.
    if (resetting !== undefined) release([resetting]);
    if (result.reset.length > 0) toast.success('Reset to the default.');
    // An empty `reset` is the API telling us the key had no override to remove. Nothing changed
    // and nothing is wrong, so it gets no toast — a success message for a no-op teaches the admin
    // that the button lies.
    setResetting(undefined);
  });

  const onFieldChange = useCallback((key: string, draft: Draft) => {
    touched.current[key] = true;
    setDrafts((current) => (current === undefined ? current : { ...current, [key]: draft }));
    // The server's verdict was about the value that was sent. The moment this field changes it is
    // stale, and leaving it up makes a fixed field look broken.
    setServerErrors((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const onSave = useCallback(() => {
    if (Object.keys(values).length === 0) return;
    setServerErrors({});
    update.mutate(
      { values },
      {
        onError: (error) => {
          // `useApiMutation` has already toasted the server's message. This adds the field-level
          // half: which boxes, and why. A 403 or a network fault maps to nothing and is left to
          // the toast alone.
          if (error instanceof ApiError) setServerErrors(mapFieldErrors(error.data));
        },
      },
    );
  }, [values, update]);

  const onDiscard = useCallback(() => {
    if (query.data === undefined) return;
    touched.current = {};
    setDrafts(toDrafts(query.data.groups.flatMap((group) => group.settings)));
    setServerErrors({});
  }, [query.data]);

  const onResetField = useCallback(
    (key: string) => {
      setResetting(key);
      reset.mutate([key], { onError: () => setResetting(undefined) });
    },
    [reset],
  );

  /**
   * The browser's own "leave site?" prompt. Crude, unstyleable, and the only thing that survives
   * a closed tab — which is how this page's work is actually lost, not by clicking away inside
   * the app.
   */
  useEffect(() => {
    if (dirtyKeys.length === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyKeys.length]);

  const fieldErrors = { ...invalid, ...serverErrors };
  const busy = update.isPending || reset.isPending;
  const blocked = Object.keys(invalid).length > 0;

  return (
    <div className="flex flex-col gap-4 pb-24">
      <TopProgressBar active={query.isFetching || busy} />

      <PageHeader
        title="Settings"
        breadcrumbs={[{ label: 'Settings' }]}
        actions={
          <SaveBar
            dirtyCount={dirtyKeys.length}
            blocked={blocked}
            saving={update.isPending}
            disabled={busy}
            onSave={onSave}
            onDiscard={onDiscard}
          />
        }
      />

      <p className="text-xs text-text-subtle max-w-3xl">
        These take effect within a minute, on new quotes only — a booking&apos;s fare is frozen when
        it is confirmed, so nothing in flight changes price. Amounts are in{' '}
        <strong className="font-medium text-text">whole rupees</strong>.
      </p>

      <DataState
        loading={query.isLoading}
        error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
        skeleton={<SettingsSkeleton />}
      >
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <Panel key={group.group} title={group.label} icon={<SettingsIcon className="size-4" />}>
              <div className="divide-y divide-border">
                {group.settings.map((setting: SettingDto) => {
                  const draft = drafts?.[setting.key];
                  if (draft === undefined) return null;
                  return (
                    <SettingField
                      key={setting.key}
                      setting={setting}
                      draft={draft}
                      onChange={(next) => onFieldChange(setting.key, next)}
                      error={fieldErrors[setting.key]}
                      dirty={dirtyKeys.includes(setting.key)}
                      onReset={() => onResetField(setting.key)}
                      resetting={resetting === setting.key}
                      disabled={busy}
                    />
                  );
                })}
              </div>
            </Panel>
          ))}
        </div>
      </DataState>
    </div>
  );
}

interface SaveBarProps {
  dirtyCount: number;
  blocked: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * Both buttons stay MOUNTED and disabled when there is nothing to save, rather than appearing on
 * the first keystroke. Controls that materialise next to where you are typing move the rest of
 * the header, and on a page of nineteen number fields that is a misclick waiting to happen.
 */
function SaveBar({ dirtyCount, blocked, saving, disabled, onSave, onDiscard }: SaveBarProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-subtle" aria-live="polite">
        {dirtyCount === 0
          ? 'No changes'
          : `${dirtyCount} unsaved change${dirtyCount === 1 ? '' : 's'}`}
      </span>
      <Button variant="ghost" size="sm" onClick={onDiscard} disabled={dirtyCount === 0 || disabled}>
        Discard
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={onSave}
        loading={saving}
        disabled={dirtyCount === 0 || blocked || disabled}
        // Said out loud rather than left to a greyed-out button: a disabled primary action with
        // no stated reason is the most common way an admin concludes the page is broken.
        title={blocked ? 'Fix the highlighted fields first' : undefined}
      >
        Save changes
      </Button>
    </div>
  );
}

/** The real geometry — six panels of rows — so the page does not jump when the data lands. */
function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[1, 4, 4, 2, 1, 6].map((rows, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={index} className="bg-surface border border-border rounded-md">
          <div className="px-4 h-12 border-b border-border flex items-center">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="p-4 flex flex-col gap-6">
            {Array.from({ length: rows }, (_, row) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={row} className="grid grid-cols-1 md:grid-cols-[1fr_20rem] gap-6">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-10 w-32" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
