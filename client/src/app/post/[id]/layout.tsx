import type { Metadata } from "next";
import type { ReactNode } from "react";
import { postMetadata } from "@/lib/seo";

/** Link previews (Open Graph / X cards) for shared links; data is what a signed-out visitor sees. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return postMetadata((await params).id);
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
