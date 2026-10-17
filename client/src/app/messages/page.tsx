import MainLayout from "@/components/main-layout";
import Messages from "@/components/messages";
export const metadata = { title: "Messages" };
export default function Page() {
  return (
    <MainLayout>
      <Messages />
    </MainLayout>
  );
}
