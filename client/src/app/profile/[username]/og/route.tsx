import { card } from "@/lib/og-card";
import { apiImage, excerpt, fetchProfile } from "@/lib/seo";

/** Preview card for a profile link. */
export async function GET(_request: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) return card({ name: "Circle", text: "This profile isn’t available. Join Circle to find your people." });
  const stats = `${profile.followerCount} followers · ${profile.followingCount} following · ${profile.postCount} posts`;
  return card({
    name: profile.displayName,
    handle: profile.username,
    text: profile.bio ? excerpt(profile.bio, 170) : `Photos, Reels and moments from ${profile.displayName}.`,
    meta: stats,
    avatar: profile.avatarUrl ? await apiImage(`/users/${profile.username}/avatar.jpg`) : null,
    badge: profile.isPrivate ? "Private" : "Profile",
  });
}
