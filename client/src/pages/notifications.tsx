import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Bell,
  CheckCircle,
  AlertCircle,
  Info,
  UserPlus,
  MessageSquare,
  Calendar,
  Settings,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import MainWrapper from "@/components/main-wrapper";

interface NotificationDTO {
  id: number;
  title: string;
  content: string;
  type: string;
  relatedTaskId?: number | null;
  isRead?: boolean;
  createdAt?: string;
  actionUrl?: string;
}

function getNotificationIcon(type: NotificationDTO["type"]) {
  switch (type) {
    case "task_assigned":
    case "task_updated":
      return <CheckCircle className="h-5 w-5 text-blue-500" />;
    case "comment_added":
      return <MessageSquare className="h-5 w-5 text-green-500" />;
    case "team_invite":
      return <UserPlus className="h-5 w-5 text-purple-500" />;
    case "system":
      return <Settings className="h-5 w-5 text-orange-500" />;
    case "reminder":
      return <Calendar className="h-5 w-5 text-red-500" />;
    default:
      return <Info className="h-5 w-5 text-gray-500" />;
  }
}

function getNotificationColor(type: NotificationDTO["type"]) {
  switch (type) {
    case "task_assigned":
    case "task_updated":
      return "blue";
    case "comment_added":
      return "green";
    case "team_invite":
      return "purple";
    case "system":
      return "orange";
    case "reminder":
      return "red";
    default:
      return "gray";
  }
}

export default function Notifications() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [notificationList, setNotificationList] = useState<NotificationDTO[]>(
    []
  );

  // In a real app, this would fetch notifications from the API
  const {
    data: notifications = notificationList,
    isLoading,
    refetch,
  } = useQuery<NotificationDTO[]>({
    queryKey: ["/api/notifications", { read: false }],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?limit=50&read=false`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchOnMount: "always",
  });

  // Update notification list when data changes
  useEffect(() => {
    if (notifications) {
      setNotificationList(notifications);
    }
  }, [notifications]);

  const unreadCount = notificationList.filter((n) => !n.isRead).length;
  const readNotifications = notificationList.filter((n) => n.isRead);
  const unreadNotifications = notificationList.filter((n) => !n.isRead);

  const markAllMutation = useMutation({
    mutationFn: async () => {
      await fetch(`/api/notifications/read-all`, {
        method: "PATCH",
        credentials: "include",
      });
    },
    onSuccess: () => refetch(),
  });
  const markAllAsRead = () => markAllMutation.mutate();

  const markOneMutation = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
    },
    onSuccess: () => refetch(),
  });
  const markAsRead = (id: number) => markOneMutation.mutate(id);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <MainWrapper
      action={
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <Badge variant="destructive">{unreadCount} unread</Badge>
          )}
          <Button
            variant="outline"
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
          >
            Mark All as Read
          </Button>
        </div>
      }
    >
      {unreadNotifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Unread Notifications
            </CardTitle>
            <CardDescription>
              {unreadCount} new notification{unreadCount !== 1 ? "s" : ""}{" "}
              requiring your attention
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {unreadNotifications.map((notification, index) => (
              <div key={notification.id}>
                <div className="flex items-start gap-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex-shrink-0 mt-1">
                    {getNotificationIcon("task_updated")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className={
                          notification.actionUrl
                            ? "cursor-pointer hover:opacity-80 transition-opacity"
                            : ""
                        }
                        onClick={() => {
                          if (notification.actionUrl) {
                            markAsRead(notification.id);
                            const path = notification.actionUrl;
                            // For mock notifications, navigate to appropriate pages
                            if (path.includes("/tasks/")) {
                              navigate("/my-tasks");
                            } else if (path.includes("/teams/")) {
                              navigate("/teams");
                            } else {
                              navigate("/");
                            }
                          }
                        }}
                      >
                        <h4 className="font-semibold text-sm">
                          {notification.title || "Notification"}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {notification.content}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {notification.createdAt
                            ? formatDistanceToNow(
                                new Date(notification.createdAt),
                                { addSuffix: true }
                              )
                            : "just now"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {notification.type.replace("_", " ")}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => markAsRead(notification.id)}
                        >
                          Mark as Read
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                {index < unreadNotifications.length - 1 && <Separator />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {readNotifications.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Previous Notifications
            </CardTitle>
            <CardDescription>Your notification history</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {readNotifications.map((notification, index) => (
              <div key={notification.id}>
                <div className="flex items-start gap-4 p-4 rounded-lg border">
                  <div className="flex-shrink-0 mt-1 opacity-60">
                    {getNotificationIcon("task_updated")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-medium text-sm opacity-80">
                          {notification.title || "Notification"}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {notification.content}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {notification.createdAt
                            ? formatDistanceToNow(
                                new Date(notification.createdAt),
                                { addSuffix: true }
                              )
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs opacity-60">
                          {notification.type.replace("_", " ")}
                        </Badge>
                        {notification.actionUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              // Extract the path from the actionUrl
                              const path = notification.actionUrl;
                              if (path) {
                                // For mock notifications, we'll navigate to appropriate pages
                                if (path.includes("/tasks/")) {
                                  // Navigate to my tasks page since individual task routes aren't implemented
                                  navigate("/my-tasks");
                                } else if (path.includes("/teams/")) {
                                  // Navigate to teams page
                                  navigate("/teams");
                                } else {
                                  // Default to dashboard
                                  navigate("/");
                                }
                              }
                            }}
                          >
                            View
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {index < readNotifications.length - 1 && <Separator />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(!notifications || notifications.length === 0) && (
        <Card>
          <CardContent className="text-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Notifications</h3>
            <p className="text-muted-foreground">
              You're all caught up! We'll notify you when something important
              happens.
            </p>
          </CardContent>
        </Card>
      )}
    </MainWrapper>
  );
}
