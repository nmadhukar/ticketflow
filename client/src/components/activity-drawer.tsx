import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Plus,
  CheckCircle,
  MessageCircle,
  UserCheck,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";

export function ActivityDrawer() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const role = (user as any)?.role;
  const { t } = useTranslation(["common", "dashboard"]);
  const [, setLocation] = useLocation();

  // Only show for admin role
  if (role !== "admin") {
    return null;
  }

  const { data: activity, isLoading: activityLoading } = useQuery<any[]>({
    queryKey: ["/api/activity"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/activity?limit=50");
      return res.json();
    },
    enabled: open, // Only fetch when drawer is open
    retry: false,
  });

  const handleActivityClick = (taskId: number) => {
    setLocation(`/tickets/${taskId}`);
    setOpen(false);
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => setOpen(true)}
            className={cn(
              "fixed top-1/2 right-0 -translate-y-1/2 z-50",
              "rounded-l-lg rounded-r-none",
              "px-4 py-3",
              "shadow-lg hover:shadow-xl",
              "transition-all hover:scale-105"
            )}
            variant="default"
          >
            <Activity className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p>Recent Activities</p>
        </TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="!w-full sm:!w-3/4 md:!w-1/2 !max-w-none p-0"
        >
          <div className="flex flex-col h-full">
            <SheetHeader className="border-b px-6 py-4 sticky top-0 bg-background z-10">
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle>{t("dashboard:recentActivity.title")}</SheetTitle>
                  <SheetDescription>
                    Recent system activities and updates
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-6">
              {activityLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner size="lg" />
                </div>
              ) : activity && activity.length > 0 ? (
                <div className="space-y-4">
                  {activity.map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() =>
                        item.taskId && handleActivityClick(item.taskId)
                      }
                      className={cn(
                        "flex space-x-3 p-3 rounded-md transition-colors",
                        item.taskId
                          ? "cursor-pointer hover:bg-muted/50"
                          : "cursor-default"
                      )}
                    >
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        {item.action === "created" && (
                          <Plus className="h-5 w-5 text-blue-600" />
                        )}
                        {item.action === "completed" && (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        )}
                        {item.action === "commented" && (
                          <MessageCircle className="h-5 w-5 text-yellow-600" />
                        )}
                        {item.action === "updated" && (
                          <UserCheck className="h-5 w-5 text-purple-600" />
                        )}
                        {![
                          "created",
                          "completed",
                          "commented",
                          "updated",
                        ].includes(item.action) && (
                          <Activity className="h-5 w-5 text-slate-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800">
                          <span className="font-medium">
                            {item.userName || item.userId || "System"}
                          </span>{" "}
                          {item.action}{" "}
                          {item.taskTitle ? "a ticket" : "an item"}
                        </p>
                        {item.taskTitle && (
                          <p className="text-xs text-muted-foreground font-medium mt-1 truncate">
                            {item.taskTitle}
                          </p>
                        )}
                        {item.field && item.oldValue && item.newValue && (
                          <p className="text-xs text-slate-500 mt-1">
                            Changed {item.field} from "{item.oldValue}" to "
                            {item.newValue}"
                          </p>
                        )}
                        <p className="text-xs text-slate-500 mt-2">
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  {t("dashboard:recentActivity.noActivity")}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
