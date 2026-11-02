import { Card, Skeleton } from './ui/index';
function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
function Rows() {
  return (
    <Card>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b py-5 last:border-0"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </Card>
  );
}
function FormSkeleton() {
  return (
    <Card className="space-y-5">
      <Skeleton className="h-6 w-52 max-w-full" />
      <Skeleton className="h-4 w-2/3" />
      <FieldSkeleton />
      <div className="grid grid-cols-2 gap-3">
        <FieldSkeleton />
        <FieldSkeleton />
      </div>
      <FieldSkeleton />
      <Skeleton className="h-32 w-full" />
      <FieldSkeleton />
      <Skeleton className="h-11 w-full" />
    </Card>
  );
}
function BillCard() {
  return (
    <Card className="space-y-5">
      <div className="flex justify-between gap-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-6 w-24" />
      </div>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-3 w-1/3" />
    </Card>
  );
}
export function PageSkeleton({
  kind = 'cards',
}: {
  kind?: 'cards' | 'transfer' | 'bills' | 'bill' | 'activity' | 'admin';
}) {
  return (
    <main
      className={`page ${kind === 'admin' ? 'max-w-6xl' : ''}`}
      role="status"
      aria-label="Завантаження…"
    >
      <span className="sr-only">Завантаження…</span>
      <Skeleton className="mb-3 h-9 w-60" />
      <Skeleton className="mb-8 h-5 w-72 max-w-full" />
      {kind === 'cards' && (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="space-y-5">
                <div className="flex justify-between">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <Skeleton className="h-6 w-20" />
                </div>
                <div className="space-y-3 pt-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-9 w-44" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-40" />
                </div>
                <div className="space-y-3 border-t pt-5">
                  <FieldSkeleton />
                  <Skeleton className="h-8 w-full" />
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Card className="mt-6 space-y-5">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-4">
              <Skeleton className="h-11 w-44" />
              <Skeleton className="h-11 w-44" />
            </div>
          </Card>
        </>
      )}
      {kind === 'transfer' && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card className="space-y-5">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-2/3" />
            <FieldSkeleton />
            <FieldSkeleton />
            <Skeleton className="h-4 w-3/4" />
            <div className="grid gap-5 sm:grid-cols-2">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <Skeleton className="h-11 w-full" />
          </Card>
          <Card className="flex min-h-80 flex-col justify-center gap-5">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-2 w-full" />
          </Card>
        </div>
      )}
      {kind === 'bills' && (
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <BillCard />
            <BillCard />
          </div>
          <div className="lg:col-span-5">
            <FormSkeleton />
          </div>
        </div>
      )}
      {kind === 'bill' && (
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <BillCard />
            <Rows />
          </div>
          <Card className="space-y-5">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-8 w-40" />
            <FieldSkeleton />
            <Skeleton className="h-11 w-full" />
          </Card>
        </div>
      )}
      {kind === 'activity' && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-28 rounded-full" />
            ))}
          </div>
          <Rows />
          <Rows />
        </div>
      )}
      {kind === 'admin' && (
        <div className="space-y-6">
          <Card className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2].map((i) => (
              <FieldSkeleton key={i} />
            ))}
            <Skeleton className="h-11 w-full self-end" />
          </Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <BillCard />
            <BillCard />
          </div>
          <Rows />
          <div className="grid gap-6 lg:grid-cols-2">
            <Rows />
            <Rows />
          </div>
        </div>
      )}
    </main>
  );
}
