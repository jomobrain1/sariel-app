import type { ReactNode } from 'react';
import { AccountIcon } from './account-icon';

type IconName = Parameters<typeof AccountIcon>[0]['name'];

/** A collapsible section styled like the dashboard tool rows: icon, title, optional count, chevron. */
export function Toggle({ title, icon, count, hint, open, className, children }: {
  title: string; icon?: IconName; count?: number; hint?: string; open?: boolean; className?: string; children: ReactNode;
}) {
  return <details className={'sariel-toggle' + (className ? ' ' + className : '')} open={open}>
    <summary>
      {icon && <span className="sariel-toggle-icon"><AccountIcon name={icon} /></span>}
      <span className="sariel-toggle-title"><strong>{title}</strong>{hint && <small>{hint}</small>}</span>
      {count !== undefined && <span className="sariel-toggle-count">{count}</span>}
    </summary>
    <div className="sariel-toggle-body">{children}</div>
  </details>;
}
