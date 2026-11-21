import { Suspense } from "react";
import { connection } from "next/server";
import ProfilePage from "./profile-page";

/** Rendered per request on purpose: the link preview metadata depends on the URL. */
async function Connection() {
  await connection();
  return null;
}

export default function Page() {
  return (
    <>
      <ProfilePage />
      <Suspense>
        <Connection />
      </Suspense>
    </>
  );
}
