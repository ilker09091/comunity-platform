import type { Metadata } from "next";
import type { ReactNode } from "react";
import { profileMetadata } from "@/lib/seo";

/** Link previews (Open Graph / X cards) for shared links; data is what a signed-out visitor sees. */
export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  return profileMetadata((await params).username);
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
