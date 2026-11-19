import { HeaderSkeleton, ListSkeleton, PaginationSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading knowledge base">
      <HeaderSkeleton pills={0} action={true} />
      <ListSkeleton rows={9} />
      <PaginationSkeleton />
    </SkeletonPage>
  );
}
