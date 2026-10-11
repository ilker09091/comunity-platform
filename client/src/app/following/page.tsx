import Feed from "@/components/feed";
import MainLayout from "@/components/main-layout";
export const metadata = { title: "Following" };
export default function Page() {
  return (
    <MainLayout>
      <Feed mode="following" />
    </MainLayout>
  );
}
