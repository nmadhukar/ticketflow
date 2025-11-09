import MainWrapper from "@/components/main-wrapper";
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
import { useEffect, useState, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { useDebounce } from "@/hooks/useDebounce";
import TicketDetail from "../components/ticket-detail";

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
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-white";
    case "low":
      return "bg-green-500 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getCategoryColor = (category: string) => {
  switch (category) {
    case "bug":
      return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400";
    case "feature":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
    case "support":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400";
    case "enhancement":
      return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
    case "incident":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400";
    case "request":
      return "bg-teal-100 text-teal-800 dark:bg-teal-900/20 dark:text-teal-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const getPriorityIcon = (priority: string) => {
  switch (priority) {
    case "high":
      return <AlertTriangle className="h-3 w-3 text-red-200" />;
    case "medium":
      return <CircleDot className="h-3 w-3 text-yellow-200" />;
    case "low":
      return <CheckCircle className="h-3 w-3 text-green-200" />;
    default:
      return <CircleDot className="h-3 w-3 text-slate-200" />;
  }
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "bug":
      return <AlertTriangle className="h-3 w-3 text-red-500" />;
    case "feature":
      return <Zap className="h-3 w-3 text-blue-500" />;
    case "support":
      return <User className="h-3 w-3 text-purple-500" />;
    case "enhancement":
      return <Target className="h-3 w-3 text-green-500" />;
    case "incident":
      return <AlertTriangle className="h-3 w-3 text-orange-500" />;
    case "request":
      return <FileText className="h-3 w-3 text-blue-500" />;
    default:
      return <Tag className="h-3 w-3 text-slate-400" />;
  }
};

export default function Tasks() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading: isLoadingAuth, user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation(["common", "tickets"]);
  const currentUserId = (user as any)?.id as string | undefined;
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [expandedTicketId, setExpandedTicketId] = useState<number | null>(null);
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

  // Update filters when debounced search changes
  useEffect(() => {
    setFilters((prev) => ({ ...prev, search: debouncedSearch }));
  }, [debouncedSearch]);

  useEffect(() => {
    // Reset to first page when filters change
    setPage(0);
    // Collapse any expanded detail when filters change
    setExpandedTicketId(null);
  }, [filters.search, filters.status, filters.category]);

  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all")
    params.set("status", filters.status);
  if (filters.category && filters.category !== "all")
    params.set("category", filters.category);
  if (filters.search) params.set("search", filters.search);
  params.set("limit", String(pageSize));
  params.set("offset", String(page * pageSize));
  const baseUrl = showMine ? "/api/tasks/my" : "/api/tasks";
  const tasksUrl = showMine ? baseUrl : `${baseUrl}?${params.toString()}`;

  useEffect(() => {
    setPage(0);
    setExpandedTicketId(null);
  }, [showMine]);

  useEffect(() => {
    // Ensure active query refetches immediately when toggling views
    queryClient.invalidateQueries({ queryKey: [tasksUrl] });
  }, [showMine, tasksUrl, queryClient]);

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
  } = useQuery<any[]>({
    queryKey: [tasksUrl],
    retry: false,
    enabled: isAuthenticated,
    initialData: [],
    refetchOnMount: "always",
  });

  // Teams for assignment are fetched after role is known

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("DELETE", `/api/tasks/${taskId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      toast({
        title: t("messages.success"),
        description: t("tickets.taskDeleted"),
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
        description: t("tickets.failedToDelete"),
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: [tasksUrl] });
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

  const canUpdateStatus = (task: any) => {
    if (role === "admin" || role === "manager") return true;
    if (role === "agent") {
      return task.assigneeType === "user" && task.assigneeId === currentUserId;
    }
    return false;
  };

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
    setExpandedTicketId(null);
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleDeleteTask = (taskId: number) => {
    if (confirm(t("tickets.confirmDelete"))) {
      deleteTaskMutation.mutate(taskId);
    }
  };

  const filteredTasks = tasks?.filter((task: any) => {
    if (
      filters.search &&
      !task.title.toLowerCase().includes(filters.search.toLowerCase()) &&
      !task.description?.toLowerCase().includes(filters.search.toLowerCase()) &&
      !task.ticketNumber?.toLowerCase().includes(filters.search.toLowerCase())
    ) {
      return false;
    }
    if (
      filters.status &&
      filters.status !== "all" &&
      task.status !== filters.status
    )
      return false;
    if (
      filters.category &&
      filters.category !== "all" &&
      task.category !== filters.category
    )
      return false;
    if (
      filters.priority &&
      filters.priority !== "all" &&
      task.priority !== filters.priority
    )
      return false;
    return true;
  });

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

  const isLoading = tasksLoading || isFetchingTasks;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t("actions.loading")}
      </div>
    );
  }

  return (
    <MainWrapper
      title={t("tickets:title")}
      subTitle={t("tickets:subtitle", {
        defaultValue: "Manage and track all tickets across your projects",
      })}
      action={
        !isLoading &&
        !!tasks?.length &&
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
      {/* Enhanced Filters Bar */}
      <Card className="mb-6 shadow-business">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("tickets:filters.searchPlaceholder")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10 h-10"
              />
            </div>

            {/* Filter Controls */}
            <div className="flex gap-3 items-center">
              <Select
                value={filters.status}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger className="w-[140px] h-10">
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
                  setFilters((prev) => ({ ...prev, category: value }))
                }
              >
                <SelectTrigger className="w-[140px] h-10">
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
                  setFilters((prev) => ({ ...prev, priority: value }))
                }
              >
                <SelectTrigger className="w-[140px] h-10">
                  <SelectValue placeholder={t("tickets:filters.priority")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("tickets:priority.all")}
                  </SelectItem>
                  <SelectItem value="high">
                    {t("common:priority.high")}
                  </SelectItem>
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
                    setShowMine(!!v);
                  }}
                  disabled={isLoading}
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
          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {filteredTasks?.length || 0} {t("tickets:filters.of")}{" "}
                {tasks?.length || 0} {t("tickets:filters.tickets")}
              </span>
              {(filters.search ||
                filters.status !== "all" ||
                filters.category !== "all" ||
                filters.priority !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setFilters({
                      search: "",
                      status: "all",
                      category: "all",
                      priority: "all",
                    })
                  }
                  className="h-7 px-2"
                >
                  {t("tickets:filters.clearFilters")}
                </Button>
              )}
              {!showMine && (
                <>
                  <div className="ml-4 text-sm text-muted-foreground">
                    {t("tickets:filters.page")} {page + 1}
                  </div>
                  <div className="flex gap-2 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 0 || isLoading}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      {t("tickets:filters.prev")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isLoading || (tasks?.length || 0) < pageSize}
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

      {/* Tasks Table */}
      <Card className="shadow-business">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="max-w-md mx-auto">
                <Spinner size="lg" className="mx-auto mb-3" />
                <p className="text-slate-500">Loading tickets...</p>
              </div>
            </div>
          ) : filteredTasks?.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.ticket")}
                    </th>
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.title")}
                    </th>
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.priority")}
                    </th>
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.status")}
                    </th>
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.category")}
                    </th>
                    <th className="min-w-max text-left p-4 font-medium">
                      {t("tickets:table.columns.assignedTo")}
                    </th>
                    {(role === "admin" || role === "manager") && (
                      <th className="min-w-max text-left p-4 font-medium">
                        AI Info
                      </th>
                    )}
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.dueDate")}
                    </th>
                    <th className="text-left p-4 font-medium">
                      {t("tickets:table.columns.created")}
                    </th>
                    <th className="text-center p-4 font-medium">
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
                          className="p-4"
                          onDragOver={handleDragOver}
                          onDrop={(e) =>
                            handleDrop(
                              e,
                              task?.assigneeId,
                              task?.assigneeTeamId
                            )
                          }
                        >
                          <Badge
                            variant="outline"
                            className="font-mono text-xs"
                          >
                            <span className="min-w-max">
                              {task.ticketNumber}
                            </span>
                          </Badge>
                        </td>
                        <td className="p-4">
                          <div>
                            <p
                              className="font-medium line-clamp-1 cursor-pointer hover:text-primary hover:underline"
                              onClick={() => handleEditTask(task)}
                            >
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mt-1 w-56">
                                {task.description}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="p-4 w-fit">
                          <Badge
                            className={cn(
                              "min-w-max flex items-center gap-1 w-fit text-xs lowercase shadow-sm",
                              getPriorityColor(task.priority)
                            )}
                          >
                            <span> {getPriorityIcon(task.priority)}</span>
                            <span> {task.priority?.toUpperCase()}</span>
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            className={cn(
                              "min-w-max flex items-center gap-1 w-fit text-xs lowercase shadow-sm",
                              getStatusColor(task.status)
                            )}
                          >
                            <span> {getStatusIcon(task.status)}</span>
                            <span>
                              {task.status?.replace("_", " ").toUpperCase()}
                            </span>
                          </Badge>
                        </td>
                        <td className="p-4">
                          <Badge
                            className={`${getCategoryColor(
                              task.category
                            )} border flex items-center gap-1 text-xs w-fit lowercase shadow-sm`}
                          >
                            <span> {getCategoryIcon(task.category)}</span>
                            <span> {task.category?.toUpperCase()}</span>
                          </Badge>
                        </td>
                        <td className="p-4 whitespace-nowrap">
                          {task.assigneeType === "team" &&
                          task.assigneeTeamId ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Users className="h-4 w-4" />
                              <span>
                                {task.teamName ||
                                  task.assigneeName ||
                                  `Team #${task.assigneeTeamId}`}
                              </span>
                            </div>
                          ) : task.assigneeId ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <User className="h-4 w-4" />
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
                        {(role === "admin" || role === "manager") && (
                          <td className="p-4 whitespace-nowrap">
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
                        <td className="p-4 whitespace-nowrap">
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
                        <td className=" p-4">
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
                        <td className="p-4">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-expanded={expandedTicketId === task.id}
                              onClick={() => {
                                setExpandedTicketId((prev) =>
                                  prev === task.id ? null : task.id
                                );
                              }}
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {(role === "admin" || role === "manager") && (
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                      Quick Assign
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
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
                                {role === "agent" &&
                                  !(
                                    task.assigneeType === "user" &&
                                    task.assigneeId === currentUserId
                                  ) && (
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
                                  )}
                                {canUpdateStatus(task) && (
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                      Update Status
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuSubContent>
                                      {[
                                        "open",
                                        "in_progress",
                                        "resolved",
                                        "closed",
                                        "on_hold",
                                      ]
                                        .filter((s) => s !== task.status)
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
                                {/* Hide Edit Ticket for agents when viewing all tickets and ticket is not directly assigned to them */}
                                {!(
                                  role === "agent" &&
                                  !showMine &&
                                  (task.assigneeType !== "user" ||
                                    task.assigneeId !== currentUserId)
                                ) && (
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
                                    onClick={() => handleDeleteTask(task.id)}
                                    className="text-red-600"
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    {t("tickets:deleteTicket")}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                      {expandedTicketId === task.id && (
                        <tr className="bg-gray-300">
                          <td
                            className="p-4"
                            colSpan={
                              role === "admin" || role === "manager" ? 10 : 9
                            }
                          >
                            <TicketDetail
                              ticketId={task.id}
                              onClose={() => setExpandedTicketId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  {showMine ? "No tickets assigned" : "No tickets found"}
                </h3>
                <p className="text-slate-500 mb-6">
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
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Create First Ticket
                    </Button>
                  )}
              </div>
            </div>
          )}
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
