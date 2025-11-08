import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import { AgentStats } from "./stats/agent-stats";
import { ManagerStats } from "./stats/manager-stats";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function StatsDrawer() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const role = (user as any)?.role;

  // Only show for agent or manager roles
  if (role !== "agent" && role !== "manager") {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => setOpen(true)}
            className={cn(
              "fixed top-1/2 left-0 -translate-y-1/2 z-50",
              "rounded-r-lg rounded-l-none",
              "px-4 py-3",
              "shadow-lg hover:shadow-xl",
              "transition-all hover:scale-105"
            )}
            variant="default"
          >
            <BarChart3 className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>View Statistics</p>
        </TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="!w-full sm:!w-3/4 md:!w-1/2 !max-w-none p-0"
        >
          <div className="flex flex-col h-full">
            <SheetHeader className="border-b px-6 py-4 sticky top-0 bg-background z-10">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle>Statistics</SheetTitle>
                  <SheetDescription>
                    {role === "agent"
                      ? "Your personal and team statistics"
                      : "Department and team performance"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-6">
              {role === "agent" ? <AgentStats /> : <ManagerStats />}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
