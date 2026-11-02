import { PageHeading } from '@/components/ui/index';
import { bffFetch } from '@/lib/api';
import { Activity } from '@/lib/types';
import { ActivityFeed } from '@/app/activity/activity-feed';

export default async function ActivityPage() {
  let activity: Activity[] = [];
  let error: string | null = null;
  try {
    activity = await bffFetch<Activity[]>('/activity?limit=50');
  } catch (err) {
    error = (err as Error).message;
  }
  return (
    <main className="page">
      <PageHeading
        title="Активність"
        description="Рух коштів, перекази та спільні рахунки в одній стрічці."
      />
      <ActivityFeed initial={activity} initialError={error} />
    </main>
  );
}
