"use client";
import { useParams } from "next/navigation";
import Profile from "@/components/profile";
import MainLayout from "@/components/main-layout";
export default function Page() {
  const { username } = useParams<{ username: string }>();
  return (
    <MainLayout>
      <Profile username={username} />
    </MainLayout>
  );
}
