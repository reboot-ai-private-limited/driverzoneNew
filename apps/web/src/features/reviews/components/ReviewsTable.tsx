import { Badge } from '@driverzone/design-system';
import { Star, EyeOff, Eye } from 'lucide-react';
import type { Review } from '../hooks/useReviews';
import { useToggleFlagReview } from '../hooks/useReviews';

export function ReviewsTable({ reviews, refetching }: { reviews: Review[]; refetching?: boolean }) {
  const toggleFlag = useToggleFlagReview();

  return (
    <div className={`overflow-x-auto ${refetching ? 'opacity-50 transition-opacity' : ''}`}>
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-text-subtle uppercase border-b border-border">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Reviewee</th>
            <th className="px-4 py-3 font-medium">Rating</th>
            <th className="px-4 py-3 font-medium">Feedback</th>
            <th className="px-4 py-3 font-medium">Reviewer</th>
            <th className="px-4 py-3 font-medium text-center w-24">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reviews.map((rev) => (
            <tr key={rev.id} className="hover:bg-surface-hover group">
              <td className="px-4 py-3 whitespace-nowrap text-text-subtle">
                {new Date(rev.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 font-medium">
                {rev.reviewee.name}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <div className="flex items-center">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`size-4 ${
                          star <= rev.rating
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-border fill-transparent'
                        }`}
                      />
                    ))}
                  </div>
                  
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
                {rev.comment && <p className="text-text-subtle truncate">{rev.comment}</p>}
              </td>
              <td className="px-4 py-3 text-text-subtle">
                {rev.reviewer.name}
              </td>
              <td className="px-4 py-3 text-center">
                <div className="flex justify-center">
                  <button
                    type="button"
                    className="p-1 -mr-1 text-text-subtle hover:text-text disabled:opacity-50 transition-colors"
                    title={rev.admin_flagged ? "Show Review" : "Hide Review"}
                    onClick={() => toggleFlag.mutate(rev.id)}
                    disabled={toggleFlag.isPending}
                  >
                    {rev.admin_flagged ? <Eye className="size-6" /> : <EyeOff className="size-6" />}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
