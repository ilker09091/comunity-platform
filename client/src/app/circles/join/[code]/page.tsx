"use client";
import { useParams } from "next/navigation";
import MainLayout from "@/components/main-layout";
import { CircleJoin } from "@/components/circles";
export default function Page() {
  const { code } = useParams<{ code: string }>();
  return (
    <MainLayout>
      <CircleJoin code={code.toUpperCase()} />
    </MainLayout>
  );
}
