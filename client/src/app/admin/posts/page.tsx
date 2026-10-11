import { redirect } from "next/navigation";

// Merged into the Content page.
export default function Page() {
  redirect("/admin/content?tab=posts");
}
