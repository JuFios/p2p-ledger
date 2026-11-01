import { bffFetch } from '@/lib/api';
import { Activity } from '@/lib/types';
import { ActivityFeed } from './activity-feed';

export default async function ActivityPage() {
  let activity: Activity[] = [];
  let error: string | null = null;
  try {
    activity = await bffFetch<Activity[]>('/activity?limit=50');
  } catch (err) {
    error = (err as Error).message;
  }
  return (
    <main style={{ maxWidth: 680, margin: '48px auto', padding: 16 }}>
      <h1>Активність</h1>
      <ActivityFeed initial={activity} initialError={error} />
    </main>
  );
}
