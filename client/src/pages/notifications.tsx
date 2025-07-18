import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Layout } from "@/components/layout";
import { Bell, CheckCircle, AlertCircle, Info, UserPlus, MessageSquare, Calendar, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: string;
  type: "task_assigned" | "task_updated" | "comment_added" | "team_invite" | "system" | "reminder";
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  actionUrl?: string;
}

// Mock notifications data - in a real app, this would come from an API
const mockNotifications: Notification[] = [
  {
    id: "1",
    type: "task_assigned",
    title: "New Task Assigned",
    message: "You have been assigned to 'Fix login authentication issue'",
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
    actionUrl: "/tasks/1"
  },
  {
    id: "2",
    type: "comment_added",
    title: "New Comment",
    message: "John Doe commented on 'Update user dashboard'",
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    actionUrl: "/tasks/2"
  },
  {
    id: "3",
    type: "task_updated",
    title: "Task Status Changed",
    message: "Task 'Implement dark mode' has been marked as resolved",
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    actionUrl: "/tasks/3"
  },
  {
    id: "4",
    type: "team_invite",
    title: "Team Invitation",
    message: "You have been invited to join the 'Backend Development' team",
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 2 days ago
    actionUrl: "/teams/2"
  },
  {
    id: "5",
    type: "system",
    title: "System Maintenance",
    message: "Scheduled maintenance will occur tonight from 11 PM to 1 AM EST",
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), // 3 days ago
  },
  {
    id: "6",
    type: "reminder",
    title: "Task Due Soon",
    message: "Task 'Prepare quarterly report' is due in 2 days",
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 96).toISOString(), // 4 days ago
    actionUrl: "/tasks/4"
  }
];

function getNotificationIcon(type: Notification["type"]) {
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

function getNotificationColor(type: Notification["type"]) {
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

  // In a real app, this would fetch notifications from the API
  const { data: notifications = mockNotifications, isLoading } = useQuery({
    queryKey: ["/api/notifications"],
    queryFn: () => Promise.resolve(mockNotifications),
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  const readNotifications = notifications.filter(n => n.read);
  const unreadNotifications = notifications.filter(n => !n.read);

  const markAllAsRead = () => {
    // In a real app, this would call an API to mark all notifications as read
    console.log("Mark all as read");
  };

  const markAsRead = (id: string) => {
    // In a real app, this would call an API to mark a specific notification as read
    console.log("Mark as read:", id);
  };

  if (isLoading) {
    return (
      <Layout>
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
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Bell className="h-8 w-8" />
            <div>
              <h1 className="text-3xl font-bold">Notifications</h1>
              <p className="text-muted-foreground">
                Stay updated with your tasks and team activities
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <Badge variant="destructive">
                {unreadCount} unread
              </Badge>
            )}
            <Button variant="outline" onClick={markAllAsRead} disabled={unreadCount === 0}>
              Mark All as Read
            </Button>
          </div>
        </div>

        <div className="space-y-6">
          {unreadNotifications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  Unread Notifications
                </CardTitle>
                <CardDescription>
                  {unreadCount} new notification{unreadCount !== 1 ? 's' : ''} requiring your attention
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {unreadNotifications.map((notification, index) => (
                  <div key={notification.id}>
                    <div className="flex items-start gap-4 p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex-shrink-0 mt-1">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-semibold text-sm">{notification.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {notification.type.replace('_', ' ')}
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
                <CardDescription>
                  Your notification history
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {readNotifications.map((notification, index) => (
                  <div key={notification.id}>
                    <div className="flex items-start gap-4 p-4 rounded-lg border">
                      <div className="flex-shrink-0 mt-1 opacity-60">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-medium text-sm opacity-80">{notification.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs opacity-60">
                              {notification.type.replace('_', ' ')}
                            </Badge>
                            {notification.actionUrl && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => window.location.href = notification.actionUrl!}
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

          {notifications.length === 0 && (
            <Card>
              <CardContent className="text-center py-12">
                <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Notifications</h3>
                <p className="text-muted-foreground">
                  You're all caught up! We'll notify you when something important happens.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}