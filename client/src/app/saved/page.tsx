import Feed from "@/components/feed";
import MainLayout from "@/components/main-layout";
export const metadata = { title: "Saved posts" };
export default function Page() {
  return (
    <MainLayout>
      <Feed mode="saved" />
    </MainLayout>
  );
}
