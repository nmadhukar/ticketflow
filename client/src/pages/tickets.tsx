import MainWrapper from "@/components/main-wrapper";
import { allowedNextStatusesFor } from "@shared/workflow";
import TaskModal from "@/components/task-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  CircleDot,
  Clock,
  Edit3,
  Eye,
  FileText,
  MoreVertical,
  Plus,
  Search,
  Tag,
  Target,
  Brain,
  Trash2,
  User,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useState, useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useDebounce } from "@/hooks/useDebounce";
import TicketDetail from "../components/ticket-detail";
import { useSearch } from "wouter";

const linkedTicketId = (search: string) => {
  const value = new URLSearchParams(search).get("ticket") || "";
  const id = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(id) && id > 0 ? id : null;
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "open":
      return <AlertCircle className="h-3 w-3" />;
    case "in_progress":
      return <Clock className="h-3 w-3" />;
    case "resolved":
      return <CheckCircle className="h-3 w-3" />;
    case "closed":
      return <XCircle className="h-3 w-3" />;
    default:
      return null;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "open":
      return "status-badge-open";
    case "in_progress":
      return "status-badge-in-progress";
    case "resolved":
      return "status-badge-resolved";
    case "closed":
      return "status-badge-closed";
    case "on_hold":
      return "status-badge-on-hold";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "urgent":
      return "bg-destructive text-destructive-foreground";
    case "high":
      return "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200";
    case "medium":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
    case "low":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getPriorityIcon = (priority: string) => {
  switch (priority) {
    case "urgent":
    case "high":
      return <AlertTriangle className="h-3 w-3" />;
    case "medium":
      return <CircleDot className="h-3 w-3" />;
    case "low":
      return <CheckCircle className="h-3 w-3" />;
    default:
      return <CircleDot className="h-3 w-3" />;
  }
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "bug":
      return <AlertTriangle className="h-3 w-3" />;
    case "feature":
      return <Zap className="h-3 w-3" />;
    case "support":
      return <User className="h-3 w-3" />;
    case "enhancement":
      return <Target className="h-3 w-3" />;
    case "incident":
      return <AlertTriangle className="h-3 w-3" />;
    case "request":
      return <FileText className="h-3 w-3" />;
    default:
      return <Tag className="h-3 w-3 text-muted-foreground" />;
  }
};

const PriorityBadge = ({ priority }: { priority: string }) => (
  <Badge variant="outline" className={cn("flex w-fit items-center gap-1 text-xs capitalize", getPriorityColor(priority))}>
    {getPriorityIcon(priority)}
    <span>{priority}</span>
  </Badge>
);

export default function Tasks() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: isLoadingAuth, user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation(["common", "tickets"]);
  const currentUserId = (user as any)?.id as string | undefined;
  const search = useSearch();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [expandedTicketId, setExpandedTicketId] = useState<number | null>(() => linkedTicketId(search));
  const detailRef = useRef<HTMLElement>(null);
  const [draggedTask, setDraggedTask] = useState<any | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 500);
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    category: "all",
    priority: "all",
  });
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [showMine, setShowMine] = useState(false);

  useEffect(() => {
    setExpandedTicketId(linkedTicketId(search));
  }, [search]);

  useEffect(() => {
    if (expandedTicketId !== null) detailRef.current?.scrollIntoView?.({ block: "start" });
  }, [expandedTicketId]);

  const openTicketDetail = (id: number) => {
    if (expandedTicketId === id) {
      detailRef.current?.scrollIntoView?.({ block: "start" });
      detailRef.current?.focus({ preventScroll: true });
    }
    setExpandedTicketId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("ticket", String(id));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const closeTicketDetail = () => {
    setExpandedTicketId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("ticket")) {
      url.searchParams.delete("ticket");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  };

  const changeFilter = (field: "status" | "category" | "priority", value: string) => {
    setPage(0);
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  // Update filters when debounced search changes
  useEffect(() => {
    setPage(0);
    setFilters((prev) => ({ ...prev, search: debouncedSearch }));
  }, [debouncedSearch]);

  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all")
    params.set("status", filters.status);
  if (filters.category && filters.category !== "all")
    params.set("category", filters.category);
  if (filters.priority !== "all") params.set("priority", filters.priority);
  if (filters.search) params.set("search", filters.search);
  params.set("limit", String(pageSize));
  params.set("offset", String(page * pageSize));
  const baseUrl = showMine ? "/api/tasks/my" : "/api/tasks";
  const tasksUrl = `${baseUrl}?${params.toString()}`;

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoadingAuth && !isAuthenticated) {
      toast({
        title: t("messages.unauthorized"),
        description: t("messages.loggedOut"),
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoadingAuth, toast]);

  const {
    data: tasks,
    isLoading: tasksLoading,
    isFetching: isFetchingTasks,
    error: tasksError,
    refetch: refetchTasks,
  } = useQuery<any[]>({
    queryKey: [tasksUrl],
    retry: false,
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Teams for assignment are fetched after role is known

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("DELETE", `/api/tasks/${taskId}`);
    },
    onSuccess: (_, deletedId) => {
      if (expandedTicketId === deletedId) closeTicketDetail();
      const deletedPath = `/api/tasks/${deletedId}`;
      queryClient.removeQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === deletedPath ||
          (typeof queryKey[0] === "string" && queryKey[0].startsWith(`${deletedPath}/`)) ||
          (queryKey[0] === "/api/tasks" && String(queryKey[1]) === String(deletedId)),
      });
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => typeof queryKey[0] === "string" && /^\/api\/tasks(?:\/my(?:-groups)?)?(?:\?|$)/.test(queryKey[0]),
      });
      toast({
        title: t("messages.success"),
        description: t("tickets:taskDeleted"),
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: t("messages.error"),
        description: t("tickets:failedToDelete"),
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, updates);
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        predicate: ({ queryKey }) => typeof queryKey[0] === "string" && /^\/api\/tasks(?:\/my(?:-groups)?)?(?:\?|$)/.test(queryKey[0]),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${variables.id}`] });

      // Find the task in the current list to get old assigneeTeamId
      const currentTask = tasks?.find((t: any) => t.id === variables.id);
      const oldTeamId = currentTask?.assigneeTeamId;
      const newTeamId = variables.updates.assigneeTeamId;

      // Invalidate new team's tasks if assigned to a team
      if (newTeamId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/teams", newTeamId, "tasks"],
        });
      }

      // Invalidate old team's tasks if task was moved from a team
      if (oldTeamId && oldTeamId !== newTeamId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/teams", oldTeamId, "tasks"],
        });
      }

      toast({
        title: t("messages.success"),
        description: t("tickets.taskUpdated", {
          defaultValue: "Ticket updated",
        }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("messages.error"),
        description:
          error?.message ||
          t("tickets.failedToUpdate", { defaultValue: "Update failed" }),
        variant: "destructive",
      });
    },
  });

  const role = (user as any)?.role as string | undefined;
  const canCreate = ["customer", "manager", "admin"].includes(role || "");
  const canDelete = role === "admin";
  // The list is already scoped by ticket visibility; metadata narrows editable fields.
  const canEdit = ["customer", "agent", "user", "manager", "admin"].includes(role || "");

  // Teams for assignment
  // - Admins: all teams
  // - Managers: teams created by them (for quick assignment)
  // - Others: teams where user is a member
  const teamsEndpoint = role === "admin" ? "/api/teams" : "/api/teams/my";
  const { data: teams } = useQuery<any[]>({
    queryKey: [teamsEndpoint],
    queryFn: async () => {
      const res = await apiRequest("GET", teamsEndpoint);
      return res.json();
    },
    enabled: !!role && role !== "customer" && isAuthenticated,
    initialData: [],
    refetchOnMount: "always",
  });

  // The statuses the server will accept for this caller on this ticket: the same
  // rule PATCH enforces (shared/workflow.ts), so the menu never offers a refused move.
  const nextStatuses = (task: any): string[] =>
    allowedNextStatusesFor(
      role === "user" ? "agent" : role,
      task.status || "open",
      !!currentUserId && task.createdBy === currentUserId
    );
  const canUpdateStatus = (task: any) => nextStatuses(task).length > 0;

  // Drag and drop handlers (admin/manager only)
  const handleDragStart = (e: any, task: any) => {
    if (!(role === "admin" || role === "manager")) return;
    setDraggedTask(task);
    if (e?.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: any) => {
    if (!(role === "admin" || role === "manager")) return;
    if (!draggedTask) return;
    e.preventDefault();
    if (e?.dataTransfer) e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: any, targetUserId?: string, targetTeamId?: number) => {
    if (!(role === "admin" || role === "manager")) return;
    if (!draggedTask) return;
    e.preventDefault();

    const updates: any = {};
    if (targetUserId) {
      updates.assigneeType = "user";
      updates.assigneeId = targetUserId;
      updates.assigneeTeamId = null;
    } else if (targetTeamId) {
      updates.assigneeType = "team";
      updates.assigneeTeamId = targetTeamId;
      updates.assigneeId = null;
    } else {
      // No target provided → do nothing
      setDraggedTask(null);
      return;
    }

    updateTaskMutation.mutate({ id: draggedTask.id, updates });
    setDraggedTask(null);
  };

  const handleEditTask = (task: any) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleDeleteTask = (taskId: number) => {
    if (confirm(t("tickets:confirmDelete"))) {
      deleteTaskMutation.mutate(taskId);
    }
  };

  const filteredTasks = tasks || [];

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const getTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return formatDate(dateString);
  };

  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const isLoading = tasksLoading;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t("actions.loading")}
      </div>
    );
  }

  return (
    <MainWrapper
      action={
        canCreate && (
          <Button
            onClick={() => {
              setEditingTask(null);
              setIsTaskModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            {t("tickets:newTicket")}
          </Button>
        )
      }
    >
      <div className="mb-6 space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">{t("tickets:title")}</h1>
        <p className="max-w-2xl text-pretty text-sm text-muted-foreground">{t("tickets:subtitle")}</p>
      </div>
      {/* Enhanced Filters Bar */}
      <Card className="mb-6 shadow-business">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="relative min-w-0 flex-1 lg:min-w-48">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label={t("tickets:filters.search")}
                placeholder={t("tickets:filters.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10 h-10"
              />
            </div>

            {/* Filter Controls */}
            <div className="flex flex-wrap gap-3 items-center lg:shrink-0">
              <Select
                value={filters.status}
                onValueChange={(value) =>
                  changeFilter("status", value)
                }
              >
                <SelectTrigger aria-label={t("tickets:filters.status")} className="h-10 min-w-[130px] flex-1 sm:w-[140px] sm:flex-none">
                  <SelectValue placeholder={t("tickets:filters.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("tickets:status.all")}</SelectItem>
                  <SelectItem value="open">
                    {t("common:status.open")}
                  </SelectItem>
                  <SelectItem value="in_progress">
                    {t("common:status.in_progress")}
                  </SelectItem>
                  <SelectItem value="resolved">
                    {t("common:status.resolved")}
                  </SelectItem>
                  <SelectItem value="closed">
                    {t("common:status.closed")}
                  </SelectItem>
                  <SelectItem value="on_hold">
                    {t("common:status.on_hold")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.category}
                onValueChange={(value) =>
                  changeFilter("category", value)
                }
              >
                <SelectTrigger aria-label={t("tickets:filters.category")} className="h-10 min-w-[130px] flex-1 sm:w-[140px] sm:flex-none">
                  <SelectValue placeholder={t("tickets:filters.category")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tickets:category.all")}
                  </SelectItem>
                  <SelectItem value="bug">
                    {t("tickets:category.bug")}
                  </SelectItem>
                  <SelectItem value="feature">
                    {t("tickets:category.feature")}
                  </SelectItem>
                  <SelectItem value="support">
                    {t("tickets:category.support")}
                  </SelectItem>
                  <SelectItem value="enhancement">
                    {t("tickets:category.enhancement")}
                  </SelectItem>
                  <SelectItem value="incident">
                    {t("tickets:category.incident")}
                  </SelectItem>
                  <SelectItem value="request">
                    {t("tickets:category.request")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.priority}
                onValueChange={(value) =>
                  changeFilter("priority", value)
                }
              >
                <SelectTrigger aria-label={t("tickets:filters.priority")} className="h-10 min-w-[130px] flex-1 sm:w-[140px] sm:flex-none">
                  <SelectValue placeholder={t("tickets:filters.priority")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tickets:priority.all")}
                  </SelectItem>
                  <SelectItem value="high">
                    {t("common:priority.high")}
                  </SelectItem>
                  <SelectItem value="urgent">{t("tickets:priority.urgent")}</SelectItem>
                  <SelectItem value="medium">
                    {t("common:priority.medium")}
                  </SelectItem>
                  <SelectItem value="low">
                    {t("common:priority.low")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {role !== "customer" && (
              <div className="flex items-center gap-2">
                <Switch
                  id="only-my-tickets"
                  checked={showMine}
                  onCheckedChange={(v) => {
                    setPage(0);
                    setShowMine(!!v);
                  }}
                />
                <label
                  htmlFor="only-my-tickets"
                  className="text-sm text-muted-foreground select-none"
                >
                  {t("tickets:filters.onlyMyTickets")}
                </label>
              </div>
            )}
          </div>

          {/* Active Filters & Stats */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t">
            <div className="flex w-full flex-wrap items-center gap-2">
              <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
                {isLoading ? "Loading tickets…" : `${filteredTasks.length} ${t("tickets:filters.tickets")} on this page`}
                {isFetchingTasks && !isLoading && " · Updating…"}
              </span>
              {(searchInput || filters.search ||
                filters.status !== "all" ||
                filters.category !== "all" ||
                filters.priority !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchInput("");
                    setPage(0);
                    setFilters({
                      search: "",
                      status: "all",
                      category: "all",
                      priority: "all",
                    });
                  }}
                  className="h-10 px-3"
                >
                  {t("tickets:filters.clearFilters")}
                </Button>
              )}
              {(
                <>
                  <div className="ml-4 text-sm text-muted-foreground">
                    {t("tickets:filters.page")} {page + 1}
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 0 || isFetchingTasks}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      {t("tickets:filters.prev")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isFetchingTasks || (tasks?.length || 0) < pageSize}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {t("tickets:filters.next")}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {expandedTicketId !== null && (
        <section ref={detailRef} tabIndex={-1} className="mb-6 scroll-mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg" aria-label="Selected ticket">
          <TicketDetail key={expandedTicketId} ticketId={expandedTicketId} onClose={closeTicketDetail} />
        </section>
      )}

      {tasksError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-card p-4">
          <p className="text-sm text-destructive">Could not load tickets. Please try again.</p>
          <Button variant="outline" onClick={() => refetchTasks()}>Retry tickets</Button>
        </div>
      )}

      {/* Tasks Table */}
      <Card className="shadow-business">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="max-w-md mx-auto">
                <Spinner size="lg" className="mx-auto mb-3" />
                <p className="text-muted-foreground">Loading tickets...</p>
              </div>
            </div>
          ) : filteredTasks?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed md:table-auto">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="hidden text-left p-3 lg:table-cell lg:p-4 font-medium">
                      {t("tickets:table.columns.ticket")}
                    </th>
                    <th className="text-left p-3 lg:p-4 font-medium">
                      {t("tickets:table.columns.title")}
                    </th>
                    <th className="hidden text-left p-3 md:table-cell lg:p-4 font-medium">
                      {t("tickets:table.columns.priority")}
                    </th>
                    <th className="w-[100px] text-left p-3 md:w-auto lg:p-4 font-medium">
                      {t("tickets:table.columns.status")}
                    </th>
                    <th className="hidden text-left p-4 2xl:table-cell font-medium">
                      {t("tickets:table.columns.category")}
                    </th>
                    <th className="hidden text-left p-3 md:table-cell lg:p-4 font-medium">
                      {t("tickets:table.columns.assignedTo")}
                    </th>
                    {role === "admin" && (
                      <th className="hidden text-left p-4 2xl:table-cell font-medium whitespace-nowrap">
                        AI Info
                      </th>
                    )}
                    <th className="hidden text-left p-4 2xl:table-cell font-medium">
                      {t("tickets:table.columns.dueDate")}
                    </th>
                    <th className="hidden text-left p-4 2xl:table-cell font-medium">
                      {t("tickets:table.columns.created")}
                    </th>
                    <th className="w-[104px] text-center p-3 md:w-auto lg:p-4 font-medium">
                      {t("tickets:table.columns.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredTasks.map((task: any) => (
                    <Fragment key={task.id}>
                      <tr
                        className="hover:bg-muted/50 transition-colors"
                        draggable={role === "admin" || role === "manager"}
                        onDragStart={(e) => handleDragStart(e, task)}
                      >
                        <td
                          className="hidden p-3 lg:table-cell lg:p-4"
                          onDragOver={handleDragOver}
                          onDrop={(e) =>
                            handleDrop(
                              e,
                              task?.assigneeId,
                              task?.assigneeTeamId
                            )
                          }
                        >
                          <span
                            className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground"
                          >
                            <span className="min-w-max">
                              {task.ticketNumber}
                            </span>
                          </span>
                        </td>
                        <td className="min-w-0 p-3 lg:p-4">
                          <div className="min-w-0">
                            <p className="truncate whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground lg:hidden" title={task.ticketNumber}>{task.ticketNumber}</p>
                            <button
                              type="button"
                              className="min-h-10 max-w-sm break-words text-left text-sm font-semibold leading-snug text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                              aria-expanded={expandedTicketId === task.id}
                              onClick={() => openTicketDetail(task.id)}
                            >
                              {task.title}
                            </button>
                            {task.description && (
                              <p className="hidden text-sm text-muted-foreground mt-1 max-w-sm md:line-clamp-2">
                                {task.description}
                              </p>
                            )}
                            <div className="mt-1 md:hidden"><PriorityBadge priority={task.priority} /></div>
                          </div>
                        </td>
                        <td className="hidden p-3 md:table-cell lg:p-4">
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className="p-3 lg:p-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "flex items-center gap-1 w-fit text-xs capitalize",
                              getStatusColor(task.status)
                            )}
                          >
                            <span className="hidden shrink-0 sm:inline-flex">{getStatusIcon(task.status)}</span>
                            <span className="whitespace-normal">
                              {task.status?.replace(/_/g, " ")}
                            </span>
                          </Badge>
                        </td>
                        <td className="hidden p-4 2xl:table-cell">
                          <span
                            className="flex items-center gap-1.5 text-sm capitalize text-muted-foreground"
                          >
                            <span> {getCategoryIcon(task.category)}</span>
                            <span> {task.category}</span>
                          </span>
                        </td>
                        <td className="hidden p-3 md:table-cell lg:p-4">
                          {task.assigneeType === "team" &&
                          task.assigneeTeamId ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground max-w-32 break-words">
                              <Users className="min-w-4 min-h-4 h-4 w-4" />
                              <span>
                                {task.teamName ||
                                  task.assigneeName ||
                                  `Team #${task.assigneeTeamId}`}
                              </span>
                            </div>
                          ) : task.assigneeId ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground max-w-32 break-words">
                              <User className="min-w-4 min-h-4 h-4 w-4" />
                              <span>
                                {task.assigneeName || task.assigneeId}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              Unassigned
                            </span>
                          )}
                        </td>
                        {role === "admin" && (
                          <td className="hidden p-4 whitespace-nowrap 2xl:table-cell">
                            {task.hasAutoResponse ? (
                              <div className="flex items-center gap-2">
                                <Brain className="h-4 w-4 text-primary" />
                                {typeof task.aiConfidence === "number" && (
                                  <span
                                    className={cn(
                                      "text-sm font-medium",
                                      task.aiConfidence >= 0.8
                                        ? "text-green-600 dark:text-green-400"
                                        : task.aiConfidence >= 0.6
                                        ? "text-yellow-600 dark:text-yellow-400"
                                        : "text-red-600 dark:text-red-400"
                                    )}
                                  >
                                    {(task.aiConfidence * 100).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                        )}
                        <td className="hidden p-4 whitespace-nowrap 2xl:table-cell">
                          {task.dueDate ? (
                            <div
                              className={`min-w-max text-sm ${
                                isOverdue(task.dueDate)
                                  ? "text-destructive font-medium"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {formatDate(task.dueDate)}
                            </div>
                          ) : (
                            <span className="min-w-fit text-sm text-muted-foreground">
                              No due date
                            </span>
                          )}
                        </td>
                        <td className="hidden p-4 2xl:table-cell">
                          <div className="text-sm text-muted-foreground">
                            <p className="min-w-max">
                              {task.createdByName ||
                                task.creatorName ||
                                "Unknown"}
                            </p>
                            <span className="min-w-max text-xs">
                              {getTimeAgo(task.createdAt)}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 lg:p-4">
                          <div className="flex items-center justify-center gap-0 sm:gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="View ticket"
                              aria-expanded={expandedTicketId === task.id}
                              onClick={() => openTicketDetail(task.id)}
                              className="h-10 w-10 p-0"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {(() => {
                              // Check if there are any actions available for this user
                              const hasQuickAssign =
                                (role === "admin" || role === "manager") &&
                                (teams || []).length > 0;
                              const hasUpdateStatus = canUpdateStatus(task);
                              const hasEditTicket = canEdit;
                              const hasDelete = canDelete;

                              const hasAnyActions =
                                hasQuickAssign ||
                                hasUpdateStatus ||
                                hasEditTicket ||
                                hasDelete;

                              if (!hasAnyActions) {
                                return null; // Hide overflow icon if no actions available
                              }

                              return (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label="Ticket actions"
                                      className="h-10 w-10 p-0"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {(role === "admin" ||
                                      role === "manager") && (
                                      <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                          Quick Assign
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto">
                                          <DropdownMenuItem
                                            onClick={() => {
                                              if (!currentUserId) return;
                                              updateTaskMutation.mutate({
                                                id: task.id,
                                                updates: {
                                                  assigneeType: "user",
                                                  assigneeId: currentUserId,
                                                  assigneeTeamId: null,
                                                },
                                              });
                                            }}
                                          >
                                            Assign to me
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          {(teams || []).length ? (
                                            (teams || []).map((t: any) => (
                                              <DropdownMenuItem
                                                key={t.id}
                                                onClick={() => {
                                                  updateTaskMutation.mutate({
                                                    id: task.id,
                                                    updates: {
                                                      assigneeType: "team",
                                                      assigneeTeamId: t.id,
                                                      assigneeId: null,
                                                    },
                                                  });
                                                }}
                                              >
                                                Assign to team: {t.name}
                                              </DropdownMenuItem>
                                            ))
                                          ) : (
                                            <DropdownMenuItem disabled>
                                              No teams available
                                            </DropdownMenuItem>
                                          )}
                                        </DropdownMenuSubContent>
                                      </DropdownMenuSub>
                                    )}
                                    {role === "customer" && canUpdateStatus(task) && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          updateTaskMutation.mutate({
                                            id: task.id,
                                            updates: { status: "open" },
                                          });
                                        }}
                                      >
                                        Reopen ticket
                                      </DropdownMenuItem>
                                    )}
                                    {role !== "customer" && canUpdateStatus(task) && (
                                      <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                          Update Status
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                          {/* Only the moves the server accepts (shared rule). */}
                                          {nextStatuses(task)
                                            .map((s) => (
                                              <DropdownMenuItem
                                                key={s}
                                                onClick={() => {
                                                  updateTaskMutation.mutate({
                                                    id: task.id,
                                                    updates: { status: s },
                                                  });
                                                }}
                                              >
                                                {s.replace("_", " ")}
                                              </DropdownMenuItem>
                                            ))}
                                        </DropdownMenuSubContent>
                                      </DropdownMenuSub>
                                    )}
                                    {canEdit && (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          handleEditTask(task);
                                        }}
                                      >
                                        <Edit3 className="h-4 w-4 mr-2" />
                                        {t("tickets:editTicket")}
                                      </DropdownMenuItem>
                                    )}
                                    {canDelete && (
                                      <DropdownMenuItem
                                        onClick={() =>
                                          handleDeleteTask(task.id)
                                        }
                                        className="text-red-600"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        {t("tickets:deleteTicket")}
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !tasksError ? (
            <div className="text-center py-12">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-2">
                  {showMine ? "No tickets assigned" : "No tickets found"}
                </h3>
                <p className="text-muted-foreground mb-6">
                  {filters.search ||
                  filters.status !== "all" ||
                  filters.category !== "all" ||
                  filters.priority !== "all"
                    ? "Try adjusting your filters to see more tickets."
                    : showMine
                    ? "You don't have any tickets assigned yet."
                    : "Get started by creating your first ticket."}
                </p>
                {!filters.search &&
                  filters.status === "all" &&
                  filters.category === "all" &&
                  filters.priority === "all" &&
                  canCreate && (
                    <Button
                      onClick={() => {
                        setEditingTask(null);
                        setIsTaskModalOpen(true);
                      }}
                      className="bg-primary hover:bg-primary/90"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create First Ticket
                    </Button>
                  )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
        }}
        task={editingTask}
      />
    </MainWrapper>
  );
}
