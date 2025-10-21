import { Sidebar } from "./sidebar";
import { useAuth } from "@/hooks/useAuth";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      {(user as any)?.role !== "customer" && <Sidebar />}
      <main className="flex-1 overflow-y-auto bg-gray-50/50">{children}</main>
    </div>
  );
}
