import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading settings">
      <HeaderSkeleton pills={0} />
      <FormSkeleton sections={2} fields={4} />
    </SkeletonPage>
  );
}
