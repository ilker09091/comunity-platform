import NotificationCenter from "@/components/notifications";
import MainLayout from "@/components/main-layout";
export const metadata = { title: "Notifications" };
export default function Page() {
  return (
    <MainLayout>
      <NotificationCenter />
    </MainLayout>
  );
}
