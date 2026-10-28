import { redirect } from "next/navigation";

export default async function ConversationRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/inbox/${encodeURIComponent(id)}`);
}
