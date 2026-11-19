import { HeaderSkeleton, PaginationSkeleton, SkeletonPage, TableSkeleton } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading products">
      <HeaderSkeleton pills={0} action={true} />
      <TableSkeleton rows={10} columns={5} />
      <PaginationSkeleton />
    </SkeletonPage>
  );
}
