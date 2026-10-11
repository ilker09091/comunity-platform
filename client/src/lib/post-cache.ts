import { type QueryClient } from "@tanstack/react-query";
import type { Post } from "./api/client";

// Patch the same resource wherever it appears: feeds, search, saved lists,
// profile timelines, detail queries, quotes and repost references.
function mapData(value: unknown, id: string, patch: Partial<Post>): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => mapData(item, id, patch));
  const record = value as Record<string, unknown>;
  const updated: Record<string, unknown> =
    record.id === id && "likeCount" in record
      ? { ...record, ...patch }
      : { ...record };
  for (const key of ["pages", "items", "referencedPost"])
    if (key in updated) updated[key] = mapData(updated[key], id, patch);
  return updated;
}
export function patchPost(
  client: QueryClient,
  id: string,
  patch: Partial<Post>,
) {
  client.setQueriesData(
    {
      predicate: (q) =>
        ["posts", "post", "discovery"].includes(String(q.queryKey[0])),
    },
    (data) => mapData(data, id, patch),
  );
}
