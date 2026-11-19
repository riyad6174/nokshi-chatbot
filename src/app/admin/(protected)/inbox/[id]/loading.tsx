import { HeaderSkeleton, ThreadSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading conversation">
      <HeaderSkeleton />
      <ThreadSkeleton />
    </SkeletonPage>
  );
}
