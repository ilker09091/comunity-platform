import { Suspense } from "react";
import { connection } from "next/server";
import PostPage from "./post-page";

/** Rendered per request on purpose: the link preview metadata depends on the URL. */
async function Connection() {
  await connection();
  return null;
}

export default function Page() {
  return (
    <>
      <PostPage />
      <Suspense>
        <Connection />
      </Suspense>
    </>
  );
}
