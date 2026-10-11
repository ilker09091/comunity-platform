import Settings from "@/components/settings";
import MainLayout from "@/components/main-layout";
export const metadata = { title: "Settings" };
export default function Page() {
  return (
    <MainLayout>
      <Settings />
    </MainLayout>
  );
}
