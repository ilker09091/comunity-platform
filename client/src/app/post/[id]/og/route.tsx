import { card } from "@/lib/og-card";
import { apiImage, excerpt, fetchPost } from "@/lib/seo";

/** Preview card for posts without a photo/video (text posts), shown by WhatsApp, Telegram, X… */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await fetchPost(id);
  if (!post) return card({ name: "Circle", text: "This post isn’t available. Join Circle to see what your friends share." });
  const source = post.kind === "REPOST" && post.referencedPost ? post.referencedPost : post;
  const author = source.author;
  const video = source.media.some((m) => m.type === "VIDEO");
  return card({
    name: author.displayName,
    handle: author.username,
    text: excerpt(source.content, 220) || (video ? "Shared a Reel" : "Shared a post"),
    avatar: author.avatarUrl ? await apiImage(`/users/${author.username}/avatar.jpg`) : null,
    badge: video ? "Reel" : "Post",
  });
}
