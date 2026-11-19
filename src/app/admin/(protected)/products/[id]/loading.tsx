import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading product">
      <HeaderSkeleton pills={0} />
      <FormSkeleton sections={2} fields={5} />
    </SkeletonPage>
  );
}
