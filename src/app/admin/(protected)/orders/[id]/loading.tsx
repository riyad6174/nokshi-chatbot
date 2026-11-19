import { HeaderSkeleton, DetailSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading order">
      <HeaderSkeleton />
      <DetailSkeleton />
    </SkeletonPage>
  );
}
