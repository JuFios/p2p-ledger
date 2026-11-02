'use client';
import { Badge } from './ui/index';

export function LiveStatus({
  status,
}: {
  status: 'online' | 'offline' | 'reconnecting';
}) {
  const labels = {
    online: 'Онлайн',
    offline: 'Офлайн',
    reconnecting: 'Перепідключення…',
  };
  return (
    <span role="status" className="inline-flex shrink-0"><Badge tone={status === 'online' ? 'positive' : 'caution'}><span className="max-w-20 truncate sm:max-w-none">{labels[status]}</span></Badge></span>
  );
}
