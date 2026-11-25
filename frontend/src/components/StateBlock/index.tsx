import type { ReactNode } from 'react';
import { Inbox, SearchX, ShieldOff, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Icon } from '@/components/Icon';
import './style.css';

export type StateKind = 'empty' | 'no-match' | 'error' | 'denied';

const STATE_ICONS: Record<StateKind, LucideIcon> = { empty: Inbox, 'no-match': SearchX, error: TriangleAlert, denied: ShieldOff };

interface StateBlockProps {
  kind: StateKind;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function StateBlock({ kind, title, description, action, compact }: StateBlockProps) {
  return <div className={`ui-state ui-state-${kind}${compact ? ' is-compact' : ''}`} role={kind === 'error' ? 'alert' : undefined}>
    <span className="ui-state-icon"><Icon icon={STATE_ICONS[kind]} size={20} /></span>
    <strong>{title}</strong>
    {description && <p>{description}</p>}
    {action && <div className="ui-state-action">{action}</div>}
  </div>;
}
