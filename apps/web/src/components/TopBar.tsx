'use client';

import { Bell, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Badge, IconButton, Tooltip } from '@driverzone/design-system';
import { useSession } from '@/lib/auth/SessionProvider';
import { formatMobile } from '@/lib/format';

export interface TopBarProps {
  pinned: boolean;
  onTogglePin: () => void;
}

export function TopBar({ pinned, onTogglePin }: TopBarProps) {
  const { admin } = useSession();

  return (
    <header className="flex items-center justify-between gap-4 h-14 px-4 bg-surface border-b border-border">
      <Tooltip content={pinned ? 'Collapse navigation' : 'Keep navigation open'} side="bottom">
        <IconButton
          variant="ghost"
          size="sm"
          onClick={onTogglePin}
          label={pinned ? 'Collapse navigation' : 'Keep navigation open'}
          icon={
            pinned ? (
              <PanelLeftClose aria-hidden className="size-4" />
            ) : (
              <PanelLeftOpen aria-hidden className="size-4" />
            )
          }
        />
      </Tooltip>

      <div className="flex items-center gap-4">
        <Tooltip content="Alerts — not built yet" side="bottom">
          <span className="relative inline-flex" aria-disabled>
            <IconButton
              variant="ghost"
              size="sm"
              disabled
              label="Alerts"
              icon={<Bell aria-hidden className="size-4" />}
            />
          </span>
        </Tooltip>

        {admin !== null && (
          <div className="flex items-center gap-2">
            <span className="flex flex-col leading-tight text-right">
              <span className="text-xs text-text">{admin.full_name}</span>
              <span className="text-xs text-text-subtle tnum">
                {formatMobile(admin.mobile_number)}
              </span>
            </span>
            <Badge tone="accent">Admin</Badge>
          </div>
        )}
      </div>
    </header>
  );
}
