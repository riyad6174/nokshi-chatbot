import { HeaderSkeleton, DetailSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading customer">
      <HeaderSkeleton />
      <DetailSkeleton />
    </SkeletonPage>
  );
}
