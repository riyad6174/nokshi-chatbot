import { HeaderSkeleton, ListSkeleton, PaginationSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading conversations">
      <HeaderSkeleton pills={0} action={false} />
      <ListSkeleton rows={9} />
      <PaginationSkeleton />
    </SkeletonPage>
  );
}
