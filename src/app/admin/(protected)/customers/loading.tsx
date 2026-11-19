import { HeaderSkeleton, PaginationSkeleton, SkeletonPage, TableSkeleton } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading customers">
      <HeaderSkeleton pills={4} action={false} />
      <TableSkeleton rows={10} columns={5} />
      <PaginationSkeleton />
    </SkeletonPage>
  );
}
