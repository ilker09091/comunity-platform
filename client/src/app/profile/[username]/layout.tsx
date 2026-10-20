import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { profileMetadata } from "@/lib/seo";

/** Link previews (Open Graph / X cards) for shared links; data is what a signed-out visitor sees. */
export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  return profileMetadata((await params).username);
}

/** Marks the route as rendered per request on purpose, so the metadata can depend on the link. */
async function Connection() {
  await connection();
  return null;
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense>
        <Connection />
      </Suspense>
    </>
  );
}
