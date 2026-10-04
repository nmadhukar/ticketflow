import { PropsWithChildren, useRef, useState } from "react";
import { Sidebar } from "./sidebar";
import { NavigationContext } from "./navigation-context";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";

export function Layout({ children }: PropsWithChildren) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationTrigger = useRef<HTMLElement | null>(null);
  return (
    <NavigationContext.Provider value={{ open: () => {
      navigationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setNavigationOpen(true);
    } }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-3 focus:text-primary-foreground">Skip to content</a>
      <div className="flex h-dvh min-h-0 overflow-hidden">
        <aside className="hidden shrink-0 lg:block"><Sidebar /></aside>
        <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
          <SheetContent side="left" className="w-72 max-w-[85vw] p-0" onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = navigationTrigger.current?.isConnected ? navigationTrigger.current : document.getElementById("main-content");
            target?.focus({ preventScroll: true });
          }}>
            <SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle><SheetDescription>Choose a workspace page.</SheetDescription></SheetHeader>
            <Sidebar className="w-full border-r-0" onNavigate={() => setNavigationOpen(false)} />
          </SheetContent>
        </Sheet>
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto bg-background outline-none">{children}</main>
      </div>
    </NavigationContext.Provider>
  );
}
