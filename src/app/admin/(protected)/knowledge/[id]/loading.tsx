import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading document">
      <HeaderSkeleton pills={0} />
      <FormSkeleton sections={1} fields={3} />
    </SkeletonPage>
  );
}
