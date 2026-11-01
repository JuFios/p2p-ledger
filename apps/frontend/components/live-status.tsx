'use client';

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
    <p
      role="status"
      style={{ color: status === 'online' ? 'green' : '#845100' }}
    >
      ● {labels[status]}
    </p>
  );
}
