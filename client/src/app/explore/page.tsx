import Explore from "@/components/explore";
import MainLayout from "@/components/main-layout";
export const metadata = { title: "Explore" };
export default function Page() {
  return (
    <MainLayout>
      <Explore />
    </MainLayout>
  );
}
