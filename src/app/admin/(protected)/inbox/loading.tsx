import { HeaderSkeleton, ListSkeleton, PaginationSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading inbox">
      <HeaderSkeleton pills={5} action={false} />
      <ListSkeleton rows={9} />
      <PaginationSkeleton />
    </SkeletonPage>
  );
}
