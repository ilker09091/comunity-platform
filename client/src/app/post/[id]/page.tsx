"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api/client";
import MainLayout from "@/components/main-layout";
import PostCard from "@/components/post-card";
import { LoadingSkeleton, ErrorState } from "@/components/ui";
export default function Page() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["post", id],
    queryFn: ({ signal }) => api("postsGet", { params: { id }, signal }),
  });
  const post = query.data;
  const source = post?.kind === 'REPOST' && post.referencedPost ? post.referencedPost : post;
  const video = source?.media.find(m => m.type === 'VIDEO') ?? post?.referencedPost?.media.find(m => m.type === 'VIDEO');
  useEffect(() => { if (video) router.replace(`/reels?start=${id}&media=${video.id}`); }, [video, id, router]);
  return (
    <MainLayout>
      <Link href="/" className="back-link">
        <ArrowLeft size={16} />
        Back to your feed
      </Link>
      {query.isPending || video ? (
        <LoadingSkeleton />
      ) : query.isError ? (
        <div className="card">
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        </div>
      ) : (
        <PostCard post={query.data} detail />
      )}
    </MainLayout>
  );
}
