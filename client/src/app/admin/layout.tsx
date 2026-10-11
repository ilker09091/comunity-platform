import type { ReactNode } from "react";
import AdminShell from "@/components/admin/shell";
import "./admin.css";

export const metadata = {
  title: { default: "Admin", template: "%s · Admin | Circle" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
