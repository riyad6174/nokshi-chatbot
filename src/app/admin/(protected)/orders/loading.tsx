import { HeaderSkeleton, PaginationSkeleton, SkeletonPage, TableSkeleton } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading orders">
      <HeaderSkeleton pills={7} action={false} />
      <TableSkeleton rows={10} columns={6} />
      <PaginationSkeleton />
    </SkeletonPage>
  );
}
