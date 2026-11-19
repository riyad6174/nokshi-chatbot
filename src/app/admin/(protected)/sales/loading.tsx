import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading sales settings">
      <HeaderSkeleton pills={0} />
      <FormSkeleton sections={3} fields={4} />
    </SkeletonPage>
  );
}
