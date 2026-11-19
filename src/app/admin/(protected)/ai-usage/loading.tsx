import { ChartSkeleton, HeaderSkeleton, SkeletonPage, StatTilesSkeleton, TableSkeleton } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading AI usage">
      <HeaderSkeleton pills={3} />
      <StatTilesSkeleton count={4} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <TableSkeleton rows={5} columns={4} />
    </SkeletonPage>
  );
}
