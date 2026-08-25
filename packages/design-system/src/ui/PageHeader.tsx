'use client';

import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 text-xs text-text-subtle">
        {items.map((item, i) => (
          <Fragment key={item.label}>
            {i > 0 && <ChevronRight aria-hidden className="size-3" />}
            <li>
              {item.href === undefined ? (
                <span aria-current={i === items.length - 1 ? 'page' : undefined}>{item.label}</span>
              ) : (
                <a href={item.href} className="hover:text-interactive">
                  {item.label}
                </a>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: string;
  breadcrumbs?: Crumb[];
  /** The page's primary action, on the breadcrumb line. */
  actions?: ReactNode;
}

export function PageHeader({ title, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-text">{title}</h1>
        {breadcrumbs !== undefined && <Breadcrumbs items={breadcrumbs} />}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
