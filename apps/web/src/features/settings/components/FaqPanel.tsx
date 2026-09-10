'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle, Plus, Trash2 } from 'lucide-react';
import { Button, DataState, FormField, Input, Panel, Skeleton, toast } from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { useFaqs } from '../hooks/useFaqs';
import { useReplaceFaqs } from '../hooks/useFaqMutations';
import {
  buildBody,
  deletedCount,
  emptyDraft,
  isDirty,
  moveDraft,
  toDrafts,
  validate,
  type FaqDraft,
} from '../lib/faqDraft';

/**
 * The FAQs, edited on the settings page.
 *
 * WHY IT IS HERE AND NOT ITS OWN SCREEN. It is the same kind of thing as the fields above it —
 * something ops changes without a deploy — and it is where an admin already goes to change what
 * a trip costs. The FAQs are where the charges that AREN'T in a fare get written down (the
 * driver's food, a place to stay on a long trip), so the two belong in one place.
 *
 * IT SAVES ON ITS OWN, and that is the cost of putting it here. The settings form above batches
 * every field into one PATCH because the API checks cross-key invariants against the whole
 * configuration; the FAQs share none of that and go to a different endpoint entirely. So there
 * are two save buttons on this page, and the only honest thing to do is label them for what they
 * each cover — "Save FAQs" here, "Save changes" up there — and keep this panel's dirty state out
 * of the page counter. A single button that saved both would be lying about one of them.
 *
 * REORDERING IS BUTTONS, NOT DRAG. There is no drag-and-drop library in this repo and one row of
 * FAQs does not justify adding one; up/down buttons also work from a keyboard, which a drag
 * handle does not without considerable extra work.
 */
export function FaqPanel({ disabled = false }: { disabled?: boolean }) {
  const query = useFaqs();
  const saved = query.data?.faqs;

  /** `undefined` until the first payload — distinct from `[]`, which means "loaded, and empty". */
  const [drafts, setDrafts] = useState<FaqDraft[] | undefined>(undefined);

  /**
   * Seeded ONCE per payload identity, and the payload only changes after a save (the query does
   * not refetch on focus — see `useFaqs`).
   *
   * This is deliberately not the settings form's merge-by-touched-key dance. That machinery
   * exists because a per-field reset invalidates the whole settings query mid-edit; nothing here
   * invalidates except this panel's own save, and after a save the server's answer IS the new
   * baseline. Reseeding wholesale is therefore correct, and anything cleverer would risk keeping
   * a local row alive that the save had just deleted.
   */
  useEffect(() => {
    if (saved === undefined) return;
    setDrafts(toDrafts(saved));
  }, [saved]);

  const replace = useReplaceFaqs((result) => {
    setDrafts(toDrafts(result.faqs));
    toast.success(result.faqs.length === 1 ? '1 FAQ saved.' : `${String(result.faqs.length)} FAQs saved.`);
  });

  const rows = drafts ?? [];
  const errors = validate(rows);
  const invalid = Object.keys(errors).length > 0;
  const dirty = saved !== undefined && drafts !== undefined && isDirty(rows, saved);
  const busy = disabled || replace.isPending;

  function edit(key: string, patch: Partial<FaqDraft>): void {
    setDrafts((current) =>
      current?.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }

  function save(): void {
    if (saved === undefined || drafts === undefined) return;

    /*
     * THE ONE CONFIRM, and it guards the only irreversible thing this panel does. The API replaces
     * the list, so an entry dropped from the array is deleted outright — and the row that is
     * easiest to remove by accident is the one somebody spent an afternoon wording.
     */
    const removing = deletedCount(drafts, saved);
    if (removing > 0) {
      const message =
        removing === 1
          ? 'This will permanently delete 1 FAQ. Continue?'
          : `This will permanently delete ${String(removing)} FAQs. Continue?`;
      if (!window.confirm(message)) return;
    }

    replace.mutate({ faqs: buildBody(drafts) });
  }

  return (
    <Panel
      title="FAQs"
      icon={<HelpCircle className="size-4" />}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-subtle" aria-live="polite">
            {dirty ? 'Unsaved FAQ changes' : 'No changes'}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            loading={replace.isPending}
            disabled={!dirty || invalid || busy}
            title={invalid ? 'Fill in every question and answer first' : undefined}
          >
            Save FAQs
          </Button>
        </div>
      }
    >
      <p className="mb-4 text-xs text-text-subtle max-w-3xl">
        Shown in the customer app and the driver app, in this order. Both see the same list.
        Unpublished entries stay here and reach neither app — use that to draft, or to pull an
        answer down without losing the text. This is where the charges that are settled in cash
        belong: the app never quotes them, so the amount an admin writes here is the only figure
        anyone has.
      </p>

      <DataState
        loading={query.isLoading}
        error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
        skeleton={<FaqSkeleton />}
      >
        <div className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-sm text-text-subtle py-4">
              No FAQs yet. Both apps show an empty help screen until one is published.
            </p>
          ) : (
            rows.map((draft, index) => (
              <FaqRow
                key={draft.key}
                draft={draft}
                index={index}
                total={rows.length}
                error={errors[draft.key]}
                disabled={busy}
                onChange={(patch) => edit(draft.key, patch)}
                onMove={(to) => setDrafts((current) => (current ? moveDraft(current, index, to) : current))}
                onRemove={() =>
                  setDrafts((current) => current?.filter((row) => row.key !== draft.key))
                }
              />
            ))
          )}

          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrafts((current) => [...(current ?? []), emptyDraft()])}
              disabled={busy}
            >
              <Plus className="size-4" />
              Add FAQ
            </Button>
          </div>
        </div>
      </DataState>
    </Panel>
  );
}

interface FaqRowProps {
  draft: FaqDraft;
  index: number;
  total: number;
  error: string | undefined;
  disabled: boolean;
  onChange: (patch: Partial<FaqDraft>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}

function FaqRow({ draft, index, total, error, disabled, onChange, onMove, onRemove }: FaqRowProps) {
  return (
    <div className="border border-border rounded-md p-3 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex flex-col">
          {/*
            Labelled by POSITION, not by direction alone: a screen reader announcing "move up"
            eleven times gives no sense of where in the list the row has got to.
          */}
          <button
            type="button"
            onClick={() => onMove(index - 1)}
            disabled={disabled || index === 0}
            aria-label={`Move to position ${String(index)}`}
            className="p-1 text-text-subtle hover:text-text disabled:opacity-30 disabled:hover:text-text-subtle"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(index + 1)}
            disabled={disabled || index === total - 1}
            aria-label={`Move to position ${String(index + 2)}`}
            className="p-1 text-text-subtle hover:text-text disabled:opacity-30 disabled:hover:text-text-subtle"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        <div className="flex-1">
          <FormField label={`Question ${String(index + 1)}`} error={error} required>
            {({ id, invalid, describedBy }) => (
              <Input
                id={id}
                invalid={invalid}
                aria-describedby={describedBy}
                value={draft.question}
                onChange={(event) => onChange({ question: event.target.value })}
                placeholder="Who pays for the driver’s meals on a long trip?"
                disabled={disabled}
              />
            )}
          </FormField>
        </div>

        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove FAQ ${String(index + 1)}`}
          className="mt-5 p-1.5 text-text-subtle hover:text-danger disabled:opacity-30"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="pl-8 pr-9 flex flex-col gap-3">
        <FormField label="Answer" required>
          {({ id, describedBy }) => (
            <textarea
              id={id}
              aria-describedby={describedBy}
              value={draft.answer}
              onChange={(event) => onChange({ answer: event.target.value })}
              placeholder="You do, directly to the driver — it is not part of the fare shown in the app."
              disabled={disabled}
              rows={3}
              // Matching Input's own classes rather than importing it: Input renders an <input>,
              // and an answer that has to hold a paragraph needs a textarea.
              className="w-full p-2 rounded-md bg-surface text-text text-sm border border-border-strong placeholder:text-text-subtle focus-visible:outline-2 focus-visible:outline-interactive disabled:bg-surface-muted disabled:text-text-subtle resize-y"
            />
          )}
        </FormField>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={draft.isPublished}
            onChange={(event) => onChange({ isPublished: event.target.checked })}
            disabled={disabled}
            className="size-4 accent-interactive"
          />
          Published
          <span className="text-xs text-text-subtle">
            {draft.isPublished ? '— visible in both apps' : '— draft, not shown to anyone'}
          </span>
        </label>
      </div>
    </div>
  );
}

/** Three rows, matching the real geometry, so the panel does not jump when the data lands. */
function FaqSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((row) => (
        <div key={row} className="border border-border rounded-md p-3 flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}
