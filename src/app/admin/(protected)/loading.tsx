import { Bone, ChartSkeleton, HeaderSkeleton, ListSkeleton, SkeletonPage, StatTilesSkeleton } from "@/components/dashboard/AdminSkeletons";

// Shown instantly while a page without its own skeleton loads (and for the overview).
export default function Loading() {
  return (
    <SkeletonPage label="Loading dashboard">
      <HeaderSkeleton action />
      <StatTilesSkeleton count={4} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ChartSkeleton />
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <Bone className="h-3 w-28" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Bone className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Bone className="h-3 w-28" />
                  <Bone className="h-2.5 w-40 opacity-60" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ListSkeleton rows={3} />
    </SkeletonPage>
  );
}
