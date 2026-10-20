"use client";
import { useParams } from "next/navigation";
import MainLayout from "@/components/main-layout";
import CircleView from "@/components/circle-view";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <MainLayout>
      <CircleView key={id} id={id} />
    </MainLayout>
  );
}
