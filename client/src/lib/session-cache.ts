import type { QueryClient } from "@tanstack/react-query";
import type { Models } from "./api/client";

export async function changeSession(
  client: QueryClient,
  user: Models["MeDto"] | null,
) {
  await client.cancelQueries();
  client.setQueryData(["session"], user);
  // Retain mounted observers while clearing data belonging to another session.
  // Removing the entire cache can detach the observer and leave an old account visible.
  void client.resetQueries({
    predicate: (query) => query.queryKey[0] !== "session",
  });
}
