import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCircle, Info, UserPlus, MessageSquare, Calendar, Settings } from "lucide-react";
import { formatDistanceToNow, isValid } from "date-fns";
import { useLocation } from "wouter";
import MainWrapper from "@/components/main-wrapper";

interface NotificationDTO {
  id: number;
  title: string;
  content: string;
  type: string;
  isRead?: boolean;
  createdAt?: string;
  actionUrl?: string | null;
}

function notificationPath(actionUrl?: string | null): string | null {
  if (!actionUrl) return null;
  try {
    const url = new URL(actionUrl, window.location.origin);
    if (url.origin !== window.location.origin || (!actionUrl.startsWith("/") && !actionUrl.startsWith(window.location.origin))) return null;
    if (url.pathname === "/my-tasks") return "/tickets";
    const oldTicket = url.pathname.match(/^\/tasks\/(\d+)$/);
    if (oldTicket) return `/tickets?ticket=${oldTicket[1]}`;
    if (!/^\/(?:tickets|teams(?:\/\d+)?|departments(?:\/\d+)?|knowledge-base|notifications|settings|guides|admin\/[^/]+)?$/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function notificationIcon(type: string) {
  switch (type) {
    case "task_assigned":
    case "task_updated": return <CheckCircle className="h-5 w-5" />;
    case "comment_added": return <MessageSquare className="h-5 w-5" />;
    case "team_invite": return <UserPlus className="h-5 w-5" />;
    case "system": return <Settings className="h-5 w-5" />;
    case "reminder": return <Calendar className="h-5 w-5" />;
    default: return <Info className="h-5 w-5" />;
  }
}

function timeLabel(createdAt?: string) {
  if (!createdAt) return "Just now";
  const date = new Date(createdAt);
  return isValid(date) ? formatDistanceToNow(date, { addSuffix: true }) : "Date unavailable";
}

async function checkedFetch(url: string, method: "GET" | "PATCH" = "GET") {
  const response = await fetch(url, { method, credentials: "include" });
  if (!response.ok) throw new Error(`Notification request failed (${response.status})`);
  return response;
}

export default function Notifications() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState(false);
  const { data: notifications = [], isLoading, isError, refetch } = useQuery<NotificationDTO[]>({
    queryKey: ["/api/notifications", { read: "all", limit: 50 }],
    queryFn: async () => (await checkedFetch("/api/notifications?limit=50&read=all")).json(),
    retry: false,
    refetchOnMount: "always",
  });
  const refreshNotifications = () => {
    setActionError(false);
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };
  const markAll = useMutation({
    mutationFn: () => checkedFetch("/api/notifications/read-all", "PATCH"),
    onSuccess: refreshNotifications,
    onError: () => setActionError(true),
  });
  const markOne = useMutation({
    mutationFn: (id: number) => checkedFetch(`/api/notifications/${id}/read`, "PATCH"),
    onSuccess: refreshNotifications,
    onError: () => setActionError(true),
  });
  const unread = notifications.filter((note) => !note.isRead);
  const read = notifications.filter((note) => note.isRead);
  const busy = markAll.isPending || markOne.isPending;

  const openNotification = async (note: NotificationDTO, path: string) => {
    if (busy) return;
    if (!note.isRead) {
      try {
        await markOne.mutateAsync(note.id);
      } catch {
        return;
      }
    }
    navigate(path);
  };

  const list = (items: NotificationDTO[], heading: string, description: string) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{heading}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border" aria-label={heading}>
          {items.map((note) => {
            const path = notificationPath(note.actionUrl);
            return (
              <li key={note.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
                <span className="mt-0.5 text-muted-foreground" aria-hidden="true">{notificationIcon(note.type)}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  {path ? (
                    <a href={path} className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(event) => { event.preventDefault(); void openNotification(note, path); }}>
                      {note.title || "Notification"}
                    </a>
                  ) : <h3 className="font-medium">{note.title || "Notification"}</h3>}
                  <p className="text-sm text-muted-foreground break-words">{note.content}</p>
                  <p className="text-xs text-muted-foreground">{timeLabel(note.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={note.isRead ? "outline" : "secondary"} className="capitalize">{note.type.replaceAll("_", " ")}</Badge>
                  {!note.isRead && <Button variant="outline" size="sm" disabled={busy} onClick={() => markOne.mutate(note.id)}>{markOne.isPending && markOne.variables === note.id ? "Marking..." : "Mark as read"}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );

  return (
    <MainWrapper action={unread.length > 0 && <Button variant="outline" disabled={busy} onClick={() => markAll.mutate()}>{markAll.isPending ? "Marking..." : "Mark all as read"}</Button>}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Notifications</h1>
          <p className="text-sm text-muted-foreground text-pretty">Updates that need your attention and recent activity.</p>
        </header>
        {actionError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">Could not update notifications. Try again.</div>}
        {isLoading ? <div role="status" className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">Loading notifications...</div> : isError ? (
          <Card><CardContent className="space-y-3 p-8"><h2 className="font-semibold">Couldn't load notifications</h2><p className="text-sm text-muted-foreground">Check your connection and try again.</p><Button variant="outline" onClick={() => refetch()}>Try again</Button></CardContent></Card>
        ) : notifications.length === 0 ? (
          <Card><CardContent className="flex flex-col items-center gap-3 p-10 text-center"><Bell className="h-8 w-8 text-muted-foreground" aria-hidden="true" /><h2 className="font-semibold">No notifications yet</h2><p className="text-sm text-muted-foreground">Updates will appear here when something needs your attention.</p></CardContent></Card>
        ) : (
          <>
            {unread.length > 0 && list(unread, `Unread (${unread.length})`, "New updates for you")}
            {read.length > 0 && list(read, "Earlier", "Previously read notifications")}
          </>
        )}
      </div>
    </MainWrapper>
  );
}
