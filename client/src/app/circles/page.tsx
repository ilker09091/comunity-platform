import MainLayout from "@/components/main-layout";
import CirclesHome from "@/components/circles";
export const metadata = { title: "Circles" };
export default function Page() {
  return (
    <MainLayout>
      <CirclesHome />
    </MainLayout>
  );
}
