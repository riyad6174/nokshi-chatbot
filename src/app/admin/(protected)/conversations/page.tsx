import { redirect } from "next/navigation";

// Conversations moved into the Inbox (with human takeover).
export default function ConversationsRedirect() {
  redirect("/admin/inbox?filter=all");
}
