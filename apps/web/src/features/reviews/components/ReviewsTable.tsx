'use client';

import { useState } from 'react';
import { Badge, ConfirmDialog } from '@driverzone/design-system';
import { Star, EyeOff, Eye, Trash2 } from 'lucide-react';
import type { Review } from '../hooks/useReviews';
import { useDeleteReview, useToggleFlagReview } from '../hooks/useReviews';

/**
 * TWO ACTIONS, AND THEY ARE NOT THE SAME WEIGHT.
 *
 * Flagging is reversible and is the everyday one: it hides a review from public averages while
 * the row stays, so a rating given in anger stops counting without anyone deciding it never
 * happened. Deleting destroys the row — the customer's own words about a trip — and there is no
 * undo, so it asks first and says what it is doing.
 *
 * The delete endpoint has existed since the module shipped and nothing called it; a moderation
 * queue that can only hide is missing the answer to an abusive or personally identifying comment.
 */
export function ReviewsTable({ reviews, refetching }: { reviews: Review[]; refetching?: boolean }) {
  const toggleFlag = useToggleFlagReview();
  const remove = useDeleteReview();

  /** The row awaiting confirmation, or null. Holding the row lets the dialog name the person. */
  const [pendingDelete, setPendingDelete] = useState<Review | null>(null);

  return (
    <>
      <div className={`overflow-x-auto ${refetching ? 'opacity-50 transition-opacity' : ''}`}>
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-text-subtle uppercase border-b border-border">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Reviewee</th>
              <th className="px-4 py-3 font-medium">Rating</th>
              <th className="px-4 py-3 font-medium">Feedback</th>
              <th className="px-4 py-3 font-medium">Reviewer</th>
              <th className="px-4 py-3 font-medium text-center w-28">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reviews.map((rev) => (
              <tr key={rev.id} className="hover:bg-surface-hover group">
                <td className="px-4 py-3 whitespace-nowrap text-text-subtle">
                  {new Date(rev.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    {rev.reviewee.name}
                    {/*
                      The flag has to be visible in the ROW, not only in the button's tooltip —
                      an ops person scanning the queue needs to see what has already been dealt
                      with without hovering every line.
                    */}
                    {rev.admin_flagged ? (
                      <Badge tone="warning" className="text-[10px] uppercase">
                        Flagged
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div
                    className="flex items-center"
                    aria-label={`${rev.rating} out of 5 stars`}
                    role="img"
                  >
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        aria-hidden
                        className={`size-4 ${
                          star <= rev.rating
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-border fill-transparent'
                        }`}
                      />
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 max-w-xs">
                  <div className="flex flex-wrap gap-1 mb-1">
                    {rev.tags.map((tag) => (
                      <Badge key={tag} tone="neutral" className="text-[10px] uppercase">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {rev.comment === null ? null : (
                    <p className="text-text-subtle truncate">{rev.comment}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-text-subtle">{rev.reviewer.name}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-center gap-1">
                    <button
                      type="button"
                      className="p-1 text-text-subtle hover:text-text disabled:opacity-50 transition-colors"
                      title={rev.admin_flagged ? 'Unflag — count it again' : 'Flag — hide from ratings'}
                      aria-label={rev.admin_flagged ? 'Unflag review' : 'Flag review'}
                      onClick={() => toggleFlag.mutate(rev.id)}
                      disabled={toggleFlag.isPending}
                    >
                      {rev.admin_flagged ? <Eye className="size-5" /> : <EyeOff className="size-5" />}
                    </button>

                    <button
                      type="button"
                      className="p-1 text-text-subtle hover:text-danger disabled:opacity-50 transition-colors"
                      title="Delete permanently"
                      aria-label="Delete review"
                      onClick={() => setPendingDelete(rev)}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="size-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete this review?"
        /*
         * The blast radius, one line per consequence — the shape this dialog was built for. The
         * last line matters most: flagging already does the thing an admin usually wants, and
         * someone reaching for delete should be told that before they destroy a customer's own
         * words about a trip.
         */
        consequences={
          pendingDelete === null
            ? []
            : [
                `${pendingDelete.reviewer.name}'s ${pendingDelete.rating}-star review of ${pendingDelete.reviewee.name} is removed for good.`,
                'It stops counting towards their rating.',
                'Flagging hides it from ratings without deleting it.',
              ]
        }
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (pendingDelete === null) return;
          remove.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) });
        }}
      />
    </>
  );
}
