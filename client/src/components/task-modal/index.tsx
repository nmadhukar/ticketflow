/**
 * TaskModal Component - Unified Ticket Creation and Editing Interface
 *
 * This component provides a comprehensive modal for ticket management with:
 * - Tabbed interface for ticket details, comments, and attachments
 * - Real-time form validation and error handling
 * - AI-powered auto-response integration
 * - File attachment support with drag-and-drop
 * - Dynamic assignment to users or teams
 * - Status and priority management
 * - Comment threading and history
 * - Audit trail for all changes
 *
 * Features modern UX/UI patterns:
 * - Visual card-based form sections with color-coded borders
 * - Contextual icons and improved visual hierarchy
 * - Smart form validation with helpful error messages
 * - Guided workflow for task creation and editing
 * - In-ticket editing capabilities for status, assignment, and due dates
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus,
  Clock,
  User,
  Users,
  Calendar,
  Flag,
  Tag,
  FileText,
  CheckCircle,
  AlertTriangle,
  CircleDot,
  Target,
  Zap,
  Paperclip,
} from "lucide-react";
import TaskAttachments from "./task-attachments";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task?: any;
}

// Narrow minimal Task shape used by this modal (avoid any)
type TaskMinimal = {
  id: number;
  ticketNumber?: string;
  title?: string;
  description?: string;
  category?: string;
  priority?: "low" | "medium" | "high" | "urgent" | string;
  status?: "open" | "in_progress" | "resolved" | "closed" | "on_hold" | string;
  notes?: string;
  assigneeId?: string | number | null;
  assigneeType?: "user" | "team" | string;
  assigneeTeamId?: string | number | null;
  dueDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
  creatorName?: string;
  lastUpdatedBy?: string;
};

const getPriorityIcon = (priority: string) => {
  switch (priority) {
    case "high":
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "medium":
      return <CircleDot className="h-4 w-4 text-yellow-500" />;
    case "low":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    default:
      return <CircleDot className="h-4 w-4 text-slate-400" />;
  }
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case "bug":
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "feature":
      return <Zap className="h-4 w-4 text-blue-500" />;
    case "support":
      return <User className="h-4 w-4 text-purple-500" />;
    case "enhancement":
      return <Target className="h-4 w-4 text-green-500" />;
    default:
      return <Tag className="h-4 w-4 text-slate-400" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "open":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "in_progress":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "resolved":
      return "bg-green-100 text-green-800 border-green-200";
    case "closed":
      return "bg-slate-100 text-slate-800 border-slate-200";
    case "on_hold":
      return "bg-orange-100 text-orange-800 border-orange-200";
    default:
      return "bg-slate-100 text-slate-800 border-slate-200";
  }
};

// Determine editability summary for current user/role when editing
const editableKeys = [
  "title",
  "description",
  "category",
  "priority",
  "status",
  "notes",
  "assigneeId",
  "assigneeType",
  "assigneeTeamId",
  "dueDate",
  "departmentId",
  "teamId",
];

export default function TaskModal({ isOpen, onClose, task }: TaskModalProps) {
  const { toast } = useToast();
  const { user } = useAuth() as { user?: { role?: string } } as any;
  const queryClient = useQueryClient();
  const { t } = useTranslation(["common", "tickets"]);
  const [currentTab, setCurrentTab] = useState("details");
  // Customer create-only assignment mode: 'user' | 'team' | 'department' | 'unassigned'
  const [assignmentMode, setAssignmentMode] = useState<
    "user" | "team" | "department" | "unassigned"
  >((user as any)?.role === "customer" && !task ? "team" : "user");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    priority: "medium",
    status: "open",
    notes: "",
    assigneeId: "",
    assigneeType: (user as any)?.role === "customer" && !task ? "team" : "user",
    assigneeTeamId: "",
    dueDate: "",
    departmentId: "",
    teamId: "",
  });

  // Load meta for create/edit (role-scoped values and permissions)
  const metaUrl = task?.id
    ? `/api/tickets/${task.id}/meta`
    : "/api/tickets/meta";
  const metaQuery = useQuery<any>({
    queryKey: ["ticket-meta", { id: task?.id ?? null }],
    enabled: isOpen,
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await apiRequest("GET", metaUrl);
      return await res.json();
    },
  });
  const meta: any = metaQuery.data;

  // Prime cache with row task snapshot to avoid flash of empty while refetching
  useEffect(() => {
    if (task?.id) {
      queryClient.setQueryData([`/api/tasks/${task.id}`], task as TaskMinimal);
    }
  }, [task, queryClient]);

  // Always load the freshest task details when editing to ensure full payload
  const { data: taskDetails } = useQuery<any>({
    queryKey: [task?.id ? `/api/tasks/${task.id}` : undefined],
    enabled: !!task?.id && isOpen,
    refetchOnMount: "always",
  });

  // Optional: debug in development

  const departments = meta?.departments || [];
  const teams = meta?.teams || [];
  const assignableUsers = meta?.assignableUsers || [];
  const categoriesMeta = meta?.categories || [];
  const prioritiesMeta = meta?.priorities || [];
  // statusesMeta unused in modal (status handled outside modal)
  const permissions = meta?.permissions || {};
  const isCustomer = (user as any)?.role === "customer";

  // Admin fallback: ensure admins are never blocked by missing/lagging meta
  const effectivePermissions = (() => {
    if ((user as any)?.role === "admin") {
      return {
        ...permissions,
        allowedFields: [
          "title",
          "description",
          "category",
          "priority",
          "status",
          "notes",
          "assigneeId",
          "assigneeType",
          "assigneeTeamId",
          "dueDate",
        ],
        allowedAssigneeTypes: ["user", "team"],
      } as any;
    }
    return permissions as any;
  })();

  const canEditField = (field: string) => {
    // Admins always allowed
    if ((user as any)?.role === "admin") return true;
    // On create, allow all fields and rely on server-side validation
    if (!task) return true;
    const allowed: string[] | undefined = effectivePermissions?.allowedFields;
    if (!Array.isArray(allowed)) return true; // fail-open for UX; server still enforces
    return allowed.includes(field);
  };

  const canEditAnything = (() => {
    if (!task) return true; // creating is always editable (server validates)
    if ((user as any)?.role === "admin") return true;
    if (!Array.isArray(permissions?.allowedFields)) return true;
    return editableKeys.some((k) => canEditField(k));
  })();

  const canEditAssignment = task
    ? [
        "assigneeType",
        "assigneeId",
        "assigneeTeamId",
        "departmentId",
        "teamId",
        "dueDate",
      ].some((k) => canEditField(k)) || (user as any)?.role === "admin"
    : true;

  // Prefer freshest task details for displaying read-only values
  const displayTask: TaskMinimal | undefined = (taskDetails || task) as any;

  // Date helpers to normalize yyyy-mm-dd and avoid TZ shifts
  const toYyyyMmDd = (value?: string | null) => {
    if (!value) return "";
    // Handles ISO or date-only strings
    const d = value.includes("T")
      ? new Date(value)
      : new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  };

  const formatHumanDate = (value?: string | null) => {
    if (!value) return "";
    const d = value.includes("T")
      ? new Date(value)
      : new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Reset/initialize form snapshot when task or modal state changes
  useEffect(() => {
    const current = (taskDetails || task) as TaskMinimal | undefined;
    if (current) {
      // Derive department/team selection when team-assigned
      let departmentId = "";
      let teamId = "";
      if (
        current.assigneeType === "team" &&
        current.assigneeTeamId &&
        Array.isArray(teams)
      ) {
        const match = (teams as any[]).find(
          (t) => t.id === current.assigneeTeamId
        );
        if (match) {
          departmentId = match.departmentId?.toString?.() || "";
          teamId = match.id?.toString?.() || "";
        }
      }

      setFormData({
        title: current.title || "",
        description: current.description || "",
        category: current.category || "",
        priority: (current.priority as any) || "medium",
        status: (current.status as any) || "open",
        notes: current.notes || "",
        assigneeId:
          current.assigneeType === "user" && current.assigneeId != null
            ? String(current.assigneeId)
            : "unassigned",
        assigneeType: (current.assigneeType as any) || "user",
        assigneeTeamId:
          current.assigneeType === "team" && current.assigneeTeamId != null
            ? String(current.assigneeTeamId)
            : "unassigned",
        dueDate: current.dueDate ? toYyyyMmDd(current.dueDate) : "",
        departmentId,
        teamId,
      });
      setCurrentTab("details");
    } else {
      setFormData({
        title: "",
        description: "",
        category: "",
        priority: "medium",
        status: "open",
        notes: "",
        assigneeId: "",
        assigneeType: (user as any)?.role === "customer" ? "team" : "user",
        assigneeTeamId: "",
        dueDate: "",
        departmentId: "",
        teamId: "",
      });
      setCurrentTab("details");
    }
  }, [task, taskDetails, isOpen, teams]);

  // Clear local state when modal closes to avoid stale flashes on next open
  useEffect(() => {
    if (!isOpen) {
      setCurrentTab("details");
      setFormData({
        title: "",
        description: "",
        category: "",
        priority: "medium",
        status: "open",
        notes: "",
        assigneeId: "",
        assigneeType: (user as any)?.role === "customer" ? "team" : "user",
        assigneeTeamId: "",
        dueDate: "",
        departmentId: "",
        teamId: "",
      });
    }
  }, [isOpen]);

  const createTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return await apiRequest("POST", "/api/tasks", taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      // Invalidate any paged/filtered variants of tasks list
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey?.[0] === "string" &&
          String(q.queryKey[0]).startsWith("/api/tasks"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      onClose();
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.created"),
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: t("messages.error"),
        description: t("tickets:modal.toasts.errorCreate", {
          defaultValue: "Failed to create ticket",
        }),
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return await apiRequest("PATCH", `/api/tasks/${task.id}`, taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      // Update task detail cache optimistically for a snappier UI
      if (task?.id) {
        queryClient.invalidateQueries({
          queryKey: [`/api/tasks/${task.id}`],
        });
      }
      if (!formData.notes.trim()) {
        onClose();
      }
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.updated"),
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: t("messages.error"),
        description: t("tickets:modal.toasts.errorUpdate", {
          defaultValue: "Failed to update ticket",
        }),
        variant: "destructive",
      });
    },
  });

  const handleInputChange = (field: string, value: string) => {
    console.log("handleInputChange", field, value);
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast({
        title: "Error",
        description: "Ticket title is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.category) {
      toast({
        title: "Error",
        description: "Ticket category is required",
        variant: "destructive",
      });
      return;
    }

    // Assignment validation (role-aware)
    const allowedAssigneeTypes: string[] =
      (effectivePermissions?.allowedAssigneeTypes as any) || [];
    const validateAssignment = () => {
      // If editing but cannot edit assignment, skip client validation (server enforces)
      if (task && !canEditAssignment) return true;

      // Customer create: allow user, team, department-only, unassigned
      if (user?.role === "customer" && !task) {
        if (assignmentMode === "user") {
          if (!formData.assigneeId || formData.assigneeId === "unassigned") {
            toast({
              title: "Error",
              description: "Assignee is required",
              variant: "destructive",
            });
            return false;
          }
          return true;
        }
        if (assignmentMode === "team") {
          if (!formData.departmentId) {
            toast({
              title: "Error",
              description: "Department is required",
              variant: "destructive",
            });
            return false;
          }
          if (!formData.teamId) {
            toast({
              title: "Error",
              description: "Team is required",
              variant: "destructive",
            });
            return false;
          }
          return true;
        }
        if (assignmentMode === "department") {
          if (!formData.departmentId) {
            toast({
              title: "Error",
              description: "Department is required",
              variant: "destructive",
            });
            return false;
          }
          return true;
        }
        // unassigned
        return true;
      }

      // For other roles, ensure selected type is allowed (if meta provided)
      if (
        allowedAssigneeTypes.length &&
        !allowedAssigneeTypes.includes(formData.assigneeType)
      ) {
        toast({
          title: t("messages.error"),
          description: t("tickets:modal.toasts.assignmentNotAllowed", {
            defaultValue: "Selected assignment type is not allowed.",
          }),
          variant: "destructive",
        });
        return false;
      }

      if (formData.assigneeType === "team") {
        if (!formData.departmentId) {
          toast({
            title: "Error",
            description: "Department is required",
            variant: "destructive",
          });
          return false;
        }
        if (!formData.teamId) {
          toast({
            title: "Error",
            description: "Team is required",
            variant: "destructive",
          });
          return false;
        }
      }
      // User assignment allows unassigned; server will coerce null
      return true;
    };

    if (!validateAssignment()) return;

    const taskData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      category: formData.category,
      priority: formData.priority,
      status: formData.status,
      notes: formData.notes.trim(),
      dueDate: formData.dueDate
        ? new Date(`${formData.dueDate}T00:00:00`).toISOString()
        : null,
      attachments: [],
      // For customers, include routing/assignment per selected mode
      ...(isCustomer && !task
        ? assignmentMode === "user"
          ? {
              assigneeType: "user" as const,
              assigneeId: formData.assigneeId,
              assigneeTeamId: null,
              departmentId: undefined,
              teamId: undefined,
            }
          : assignmentMode === "team"
          ? {
              assigneeType: "team" as const,
              assigneeId: null,
              assigneeTeamId: formData.assigneeTeamId
                ? parseInt(formData.assigneeTeamId)
                : formData.teamId
                ? parseInt(formData.teamId)
                : null,
              departmentId: formData.departmentId
                ? parseInt(formData.departmentId)
                : undefined,
              teamId: formData.teamId ? parseInt(formData.teamId) : undefined,
            }
          : assignmentMode === "department"
          ? {
              assigneeType: undefined as any,
              assigneeId: null,
              assigneeTeamId: null,
              departmentId: parseInt(formData.departmentId),
              teamId: null,
            }
          : {
              // unassigned
              assigneeType: undefined as any,
              assigneeId: null,
              assigneeTeamId: null,
              departmentId: undefined,
              teamId: null,
            }
        : {}),
    } as any;

    // Role-aware whitelist (fallback when permissions are absent) matching server policy
    const fallbackAllowedByRoleEdit: Record<string, string[]> = {
      admin: [
        "title",
        "description",
        "category",
        "priority",
        "status",
        "notes",
        "assigneeId",
        "assigneeType",
        "assigneeTeamId",
        "dueDate",
        "departmentId",
        "teamId",
      ],
      manager: [
        "title",
        "description",
        "category",
        "priority",
        "status",
        "notes",
        "assigneeId",
        "assigneeType",
        "assigneeTeamId",
        "dueDate",
        "departmentId",
        "teamId",
      ],
      agent: [
        "title",
        "description",
        "priority",
        "status",
        "notes",
        "assigneeId",
        "assigneeType",
        "assigneeTeamId",
        "dueDate",
      ],
      customer: ["title", "description", "notes", "dueDate"],
    };

    const fallbackAllowedByRoleCreate: Record<string, string[]> = {
      admin: fallbackAllowedByRoleEdit.admin,
      manager: fallbackAllowedByRoleEdit.manager,
      agent: fallbackAllowedByRoleEdit.agent,
      customer: [
        "title",
        "description",
        "notes",
        "dueDate",
        "category",
        "priority",
        "departmentId",
        "teamId",
        "assigneeId",
        "assigneeType",
        "assigneeTeamId",
        "attachments",
      ],
    };

    const roleKey = (user?.role || "").toString();
    const allowedFieldsForEdit = Array.isArray(permissions?.allowedFields)
      ? (permissions?.allowedFields as string[])
      : fallbackAllowedByRoleEdit[roleKey] || fallbackAllowedByRoleEdit.agent;
    const allowedFieldsForCreate =
      fallbackAllowedByRoleCreate[roleKey] || fallbackAllowedByRoleCreate.agent;

    // Prune payload according to context (create vs edit)
    const pruneToAllowed = (payload: any, allowed: string[]) => {
      const set = new Set<string>(allowed);
      Object.keys(payload).forEach((k) => {
        if (!set.has(k)) delete payload[k];
      });
      return payload;
    };

    if (task) {
      pruneToAllowed(taskData, allowedFieldsForEdit);
      // Customer ownership guard before PATCH
      if (isCustomer) {
        const ownerId =
          (taskDetails as any)?.createdBy || (task as any)?.createdBy;
        if (ownerId && ownerId !== (user as any)?.id) {
          toast({
            title: t("messages.error"),
            description: t("tickets:modal.toasts.ownership", {
              defaultValue: "You can only edit your own tickets.",
            }),
            variant: "destructive",
          });
          return;
        }
      }
      if (Object.keys(taskData).length === 0) {
        toast({
          title: t("messages.error"),
          description: t("tickets:modal.toasts.noChangesAllowed", {
            defaultValue: "No changes allowed for your role.",
          }),
          variant: "destructive",
        });
        return;
      }
    } else {
      pruneToAllowed(taskData, allowedFieldsForCreate);
      if (!taskData.title) {
        toast({
          title: t("messages.error"),
          description: t("tickets:modal.toasts.titleRequired", {
            defaultValue: "Ticket title is required.",
          }),
          variant: "destructive",
        });
        return;
      }
    }

    // Avoid sending no-op status updates (server rejects same->same transition)
    if (task) {
      const currentStatus =
        (taskDetails as any)?.status || (task as any)?.status;
      if (
        taskData.status &&
        currentStatus &&
        taskData.status === currentStatus
      ) {
        delete (taskData as any).status;
      }
      updateTaskMutation.mutate(taskData);
    } else {
      createTaskMutation.mutate(taskData);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] overflow-hidden p-0 flex flex-col">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="border-b bg-slate-50 px-6 py-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  {task ? (
                    <FileText className="h-5 w-5 text-blue-600" />
                  ) : (
                    <Plus className="h-5 w-5 text-blue-600" />
                  )}
                </div>
                <div className="flex-1">
                  <DialogTitle className="text-xl font-semibold text-slate-900">
                    {task
                      ? t("tickets:modal.editTitle", {
                          ticketNumber: task.ticketNumber || "",
                        })
                      : t("tickets:modal.createTitle")}
                  </DialogTitle>
                  <DialogDescription className="text-slate-600 mt-1">
                    {task ? (
                      <div className="space-y-1">
                        <p>{t("tickets:modal.editDesc")}</p>
                        <div className="flex flex-col gap-1 text-xs">
                          {task.creatorName && task.createdAt && (
                            <p className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {t("tickets:modal.meta.createdBy", {
                                defaultValue: "Created by",
                              })}{" "}
                              {task.creatorName}{" "}
                              {t("tickets:modal.meta.on", {
                                defaultValue: "on",
                              })}{" "}
                              {new Date(task.createdAt).toLocaleDateString()}
                            </p>
                          )}
                          {task.updatedAt && (
                            <p className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {t("tickets:modal.meta.lastUpdated", {
                                defaultValue: "Last updated",
                              })}{" "}
                              {task.lastUpdatedBy
                                ? `${t("tickets:modal.meta.by", {
                                    defaultValue: "by",
                                  })} ${task.lastUpdatedBy} `
                                : ""}
                              {t("tickets:modal.meta.on", {
                                defaultValue: "on",
                              })}{" "}
                              {new Date(task.updatedAt).toLocaleDateString()}{" "}
                              {t("tickets:modal.meta.at", {
                                defaultValue: "at",
                              })}{" "}
                              {new Date(task.updatedAt).toLocaleTimeString()}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      t("tickets:modal.createDesc")
                    )}
                  </DialogDescription>
                </div>
                {task && (
                  <Badge className={`${getStatusColor(task.status)} border`}>
                    {task.status?.replace("_", " ").toUpperCase()}
                  </Badge>
                )}
              </div>
            </DialogHeader>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <Tabs
              value={currentTab}
              onValueChange={setCurrentTab}
              className="h-full flex flex-col"
            >
              <div className="border-b px-6">
                <TabsList className="bg-transparent h-12 p-0 w-full justify-start">
                  <TabsTrigger
                    value="details"
                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none px-4 py-2"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {t("tickets:modal.tabs.details")}
                  </TabsTrigger>
                  {!task && (
                    <TabsTrigger
                      value="attachments"
                      className="data-[state=active]:bg-white data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none px-4 py-2"
                    >
                      <Paperclip className="h-4 w-4 mr-2" />
                      {t("tickets:modal.tabs.attachments")}
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto">
                <TabsContent value="details" className="mt-0 h-full">
                  <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Essential Information */}
                    <Card className="border-l-4 border-l-blue-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-blue-600" />
                          {t("tickets:modal.sections.essentialInfo")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Department/Team selection moved under Assignment & Timeline */}
                        <div>
                          <Label
                            htmlFor="title"
                            className="text-sm font-medium text-slate-700 flex items-center gap-2"
                          >
                            <FileText className="h-4 w-4" />
                            {t("tickets:modal.fields.taskTitle")}
                          </Label>
                          <Input
                            id="title"
                            placeholder={t("tickets:modal.placeholders.title")}
                            value={formData.title}
                            onChange={(e) =>
                              handleInputChange("title", e.target.value)
                            }
                            className="mt-2 text-base"
                            required
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            {t("tickets:modal.help.titleHint", {
                              defaultValue: "Be specific and descriptive",
                            })}
                          </p>
                        </div>

                        <div>
                          <Label
                            htmlFor="description"
                            className="text-sm font-medium text-slate-700 flex items-center gap-2"
                          >
                            <FileText className="h-4 w-4" />
                            {t("tickets:modal.fields.description")}
                          </Label>
                          <Textarea
                            id="description"
                            placeholder={t(
                              "tickets:modal.placeholders.description"
                            )}
                            rows={4}
                            value={formData.description}
                            onChange={(e) =>
                              handleInputChange("description", e.target.value)
                            }
                            className="mt-2 resize-none"
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            Include context, requirements, and acceptance
                            criteria
                          </p>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <Label
                              htmlFor="category"
                              className="text-sm font-medium text-slate-700 flex items-center gap-2"
                            >
                              <Tag className="h-4 w-4" />
                              {t("tickets:modal.fields.category")}
                            </Label>
                            {task && !canEditField("category") ? (
                              <div className="mt-2">
                                <span className="px-2 py-1 rounded border text-xs">
                                  {(displayTask?.category || "").toUpperCase()}
                                </span>
                              </div>
                            ) : (
                              <Select
                                value={formData.category}
                                onValueChange={(value) =>
                                  handleInputChange("category", value)
                                }
                              >
                                <SelectTrigger className="mt-2">
                                  <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                  {categoriesMeta?.map((c: string) => (
                                    <SelectItem key={c} value={c}>
                                      <div className="flex items-center gap-2">
                                        {getCategoryIcon(c)}
                                        {c.charAt(0).toUpperCase() + c.slice(1)}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>

                          <div>
                            <Label
                              htmlFor="priority"
                              className="text-sm font-medium text-slate-700 flex items-center gap-2"
                            >
                              <Flag className="h-4 w-4" />
                              {t("tickets:modal.fields.priority")}
                            </Label>
                            {task && !canEditField("priority") ? (
                              <div className="mt-2">
                                <span className="px-2 py-1 rounded border text-xs">
                                  {(displayTask?.priority || "").toUpperCase()}
                                </span>
                              </div>
                            ) : (
                              <Select
                                value={formData.priority}
                                onValueChange={(value) =>
                                  handleInputChange("priority", value)
                                }
                              >
                                <SelectTrigger className="mt-2">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {prioritiesMeta?.map((p: string) => (
                                    <SelectItem key={p} value={p}>
                                      <div className="flex items-center gap-2">
                                        {getPriorityIcon(p)}
                                        {p.charAt(0).toUpperCase() + p.slice(1)}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>

                          <div>
                            <Label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              {t("tickets:modal.fields.dueDate")}
                            </Label>
                            {task && !canEditField("dueDate") ? (
                              <div className="mt-2">
                                <span className="px-2 py-1 rounded border text-xs">
                                  {formatHumanDate(displayTask?.dueDate || "")}
                                </span>
                              </div>
                            ) : (
                              <Input
                                type="date"
                                value={toYyyyMmDd(formData.dueDate)}
                                onChange={(e) =>
                                  handleInputChange("dueDate", e.target.value)
                                }
                                className="mt-2"
                              />
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Assignment */}
                    {(!task ||
                      ((user as any)?.role !== "customer" &&
                        canEditAssignment)) && (
                      <Card className="border-l-4 border-l-green-500">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Users className="h-5 w-5 text-green-600" />
                            {t("tickets:modal.sections.assignment")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          <div className="flex items-center justify-between gap-4">
                            <Label className="min-w-max text-sm font-medium text-slate-700 flex items-center gap-2">
                              {t("tickets:modal.fields.assignmentType")}
                            </Label>
                            {task && !canEditField("assigneeType") ? (
                              <div className="mt-2">
                                <span className="px-2 py-1 rounded border text-xs">
                                  {(!task
                                    ? "team"
                                    : displayTask?.assigneeType || "user"
                                  ).toUpperCase()}
                                </span>
                              </div>
                            ) : (user as any)?.role === "customer" && !task ? (
                              <Select
                                value={assignmentMode}
                                onValueChange={(value: any) => {
                                  setAssignmentMode(value);
                                  if (value === "user") {
                                    handleInputChange("departmentId", "");
                                    handleInputChange("teamId", "");
                                    handleInputChange("assigneeTeamId", "");
                                  } else if (value === "team") {
                                    handleInputChange("assigneeId", "");
                                  } else if (value === "department") {
                                    handleInputChange("teamId", "");
                                    handleInputChange("assigneeId", "");
                                    handleInputChange("assigneeTeamId", "");
                                  } else if (value === "unassigned") {
                                    handleInputChange("assigneeId", "");
                                    handleInputChange("assigneeTeamId", "");
                                    handleInputChange("departmentId", "");
                                    handleInputChange("teamId", "");
                                  }
                                }}
                              >
                                <SelectTrigger className="mt-2">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="user">
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4" />
                                      {t("tickets:modal.fields.individualUser")}
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="team">
                                    <div className="flex items-center gap-2">
                                      <Users className="h-4 w-4" />
                                      {t("tickets:modal.fields.team")}
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="department">
                                    <div className="flex items-center gap-2">
                                      <Target className="h-4 w-4" />
                                      {t("tickets:modal.fields.department", {
                                        defaultValue: "Department",
                                      })}
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="unassigned">
                                    <div className="flex items-center gap-2">
                                      <CircleDot className="h-4 w-4" />
                                      {t("tickets:modal.fields.unassigned")}
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Select
                                value={formData.assigneeType}
                                onValueChange={(value) => {
                                  handleInputChange("assigneeType", value);
                                  if (value === "team") {
                                    handleInputChange("assigneeId", "");
                                  } else {
                                    handleInputChange("departmentId", "");
                                    handleInputChange("teamId", "");
                                    handleInputChange("assigneeTeamId", "");
                                  }
                                }}
                              >
                                <SelectTrigger className="mt-2">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="user">
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4" />
                                      {t("tickets:modal.fields.individualUser")}
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="team">
                                    <div className="flex items-center gap-2">
                                      <Users className="h-4 w-4" />
                                      {t("tickets:modal.fields.team")}
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>

                          {(isCustomer && !task
                            ? assignmentMode === "team"
                            : formData.assigneeType === "team") &&
                            (
                              effectivePermissions?.allowedAssigneeTypes || []
                            )?.includes("team") && (
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <Label className="text-sm font-medium text-slate-700">
                                    {t("tickets:modal.fields.department")}
                                  </Label>
                                  <Select
                                    value={formData.departmentId}
                                    onValueChange={(value) => {
                                      handleInputChange("departmentId", value);
                                      // When department changes, clear team to force re-select
                                      handleInputChange("teamId", "");
                                    }}
                                    disabled={
                                      !!task && !canEditField("assigneeTeamId")
                                    }
                                  >
                                    <SelectTrigger className="mt-2">
                                      <SelectValue
                                        placeholder={t(
                                          "tickets:modal.placeholders.selectDept"
                                        )}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {departments?.map((dept: any) => (
                                        <SelectItem
                                          key={dept.id}
                                          value={dept.id.toString()}
                                        >
                                          {dept.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-sm font-medium text-slate-700">
                                    {t("tickets:modal.fields.teamReq")}
                                  </Label>
                                  <Select
                                    value={formData.teamId}
                                    onValueChange={(value) =>
                                      handleInputChange("teamId", value)
                                    }
                                    disabled={
                                      !!task && !canEditField("assigneeTeamId")
                                    }
                                  >
                                    <SelectTrigger className="mt-2">
                                      <SelectValue
                                        placeholder={t(
                                          "tickets:modal.placeholders.selectTeam"
                                        )}
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {teams
                                        ?.filter(
                                          (t: any) =>
                                            !formData.departmentId ||
                                            t.departmentId?.toString() ===
                                              formData.departmentId
                                        )
                                        ?.map((team: any) => (
                                          <SelectItem
                                            key={team.id}
                                            value={team.id.toString()}
                                          >
                                            {team.name}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            )}

                          {isCustomer &&
                            !task &&
                            assignmentMode === "department" && (
                              <div className="w-full space-y-2">
                                <Label className="text-sm font-medium text-slate-700">
                                  {t("tickets:modal.fields.department")}
                                </Label>
                                <Select
                                  value={formData.departmentId}
                                  onValueChange={(value) => {
                                    handleInputChange("departmentId", value);
                                    handleInputChange("teamId", "");
                                  }}
                                >
                                  <SelectTrigger className="mt-2">
                                    <SelectValue
                                      placeholder={t(
                                        "tickets:modal.placeholders.selectDept"
                                      )}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {departments?.map((dept: any) => (
                                      <SelectItem
                                        key={dept.id}
                                        value={dept.id.toString()}
                                      >
                                        {dept.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                          {(isCustomer && !task
                            ? assignmentMode === "user"
                            : formData.assigneeType === "user") &&
                            (
                              effectivePermissions?.allowedAssigneeTypes || []
                            )?.includes("user") && (
                              <div className="col-span-2">
                                <Label className="text-sm font-medium text-slate-700">
                                  {t("tickets:modal.fields.assignToUser")}
                                </Label>
                                <Select
                                  value={formData.assigneeId}
                                  onValueChange={(value) =>
                                    handleInputChange("assigneeId", value)
                                  }
                                  disabled={
                                    !!task && !canEditField("assigneeId")
                                  }
                                >
                                  <SelectTrigger className="mt-2">
                                    <SelectValue
                                      placeholder={t(
                                        "tickets:modal.placeholders.searchUser"
                                      )}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {assignableUsers?.map((user: any) => (
                                      <SelectItem key={user.id} value={user.id}>
                                        <div className="flex items-center gap-2">
                                          <User className="h-4 w-4" />
                                          {user.firstName && user.lastName
                                            ? `${user.firstName} ${user.lastName}`
                                            : user.email}
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Additional Notes */}
                    <Card className="border-l-4 border-l-purple-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="h-5 w-5 text-purple-600" />
                          {t("tickets:modal.sections.notes")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Textarea
                          placeholder={t("tickets:modal.placeholders.notes", {
                            defaultValue:
                              "Add any additional notes, special instructions, or important details...",
                          })}
                          rows={3}
                          value={formData.notes}
                          onChange={(e) =>
                            handleInputChange("notes", e.target.value)
                          }
                          className="resize-none"
                        />
                      </CardContent>
                    </Card>
                  </form>
                </TabsContent>

                {!task && (
                  <TabsContent value="attachments" className="mt-0 p-6">
                    <TaskAttachments task={task} />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </div>

          {/* Footer */}
          <div className="border-t bg-slate-50 px-6 py-4">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("tickets:modal.buttons.cancel")}
              </Button>
              {task && !canEditAnything ? (
                <></>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={
                    createTaskMutation.isPending || updateTaskMutation.isPending
                  }
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {createTaskMutation.isPending || updateTaskMutation.isPending
                    ? task
                      ? t("tickets:modal.buttons.updating")
                      : t("tickets:modal.buttons.creating")
                    : task
                    ? t("tickets:modal.buttons.update")
                    : t("tickets:modal.buttons.create")}
                </Button>
              )}
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
