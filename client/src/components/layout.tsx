import { PropsWithChildren } from "react";
import { Sidebar } from "./sidebar";
import { useAuth } from "@/hooks/useAuth";

export function Layout({ children }: PropsWithChildren) {
  const { user } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      {(user as any)?.role !== "customer" ? <Sidebar /> : null}
      <main className="flex-1 overflow-y-auto bg-background">{children}</main>
    </div>
  );
}
