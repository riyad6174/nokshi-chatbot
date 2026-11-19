import { FormSkeleton, HeaderSkeleton, SkeletonPage } from "@/components/dashboard/AdminSkeletons";

export default function Loading() {
  return (
    <SkeletonPage label="Loading chatbot settings">
      <HeaderSkeleton pills={4} />
      <FormSkeleton sections={2} fields={4} />
    </SkeletonPage>
  );
}
