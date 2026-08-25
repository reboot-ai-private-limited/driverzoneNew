'use client';

import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from './cn';

/**
 * Every API response carries a `requestId`, in the body and in the `x-request-id` header,
 * and it correlates with the server logs that produced it. It is safe to show — it carries no
 * information about anything but the request itself — and "quote this ID to support" is
 * precisely what it is for (packages/contracts/src/http.ts).
 *
 * So an error screen renders it, with a copy button, because an ops person reading it off a
 * monitor into a chat window will transpose a character.
 */
export function RequestId({ id, className }: { id: string; className?: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy request ID"
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-sm',
        'font-mono text-xs text-text-subtle bg-surface-muted hover:text-text',
        className,
      )}
    >
      {id}
      {copied ? <Check aria-hidden className="size-3" /> : <Copy aria-hidden className="size-3" />}
      <span className="sr-only">{copied ? 'Copied' : 'Copy request ID'}</span>
    </button>
  );
}
