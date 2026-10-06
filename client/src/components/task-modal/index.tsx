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

import { useState, useEffect, useMemo } from "react";
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
  AlertCircle,
  CircleDot,
  Target,
  Zap,
  Paperclip,
} from "lucide-react";
import TaskAttachments from "./task-attachments";
import { UserSelectItem } from "@/components/ui/user-select-item";
import type { User as FullUser } from "@shared/schema";

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
  departmentId?: string | number | null;
  teamId?: string | number | null;
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
      return <CircleDot className="h-4 w-4 text-muted-foreground" />;
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
    case "incident":
      return <AlertCircle className="h-4 w-4 text-orange-500" />;
    case "request":
      return <FileText className="h-4 w-4 text-teal-500" />;
    default:
      return <Tag className="h-4 w-4 text-muted-foreground" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "open":
      return "bg-primary/10 text-blue-800 border-blue-200";
    case "in_progress":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "resolved":
      return "bg-green-100 text-green-800 border-green-200";
    case "closed":
      return "bg-muted text-foreground border-border";
    case "on_hold":
      return "bg-orange-100 text-orange-800 border-orange-200";
    default:
      return "bg-muted text-foreground border-border";
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
  agent: ["priority", "status", "notes"],
  customer: ["title", "description"],
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

export default function TaskModal({ isOpen, onClose, task }: TaskModalProps) {
  const { toast } = useToast();
  const { user } = useAuth() as { user?: { role?: string } } as any;
  const queryClient = useQueryClient();
  const { t } = useTranslation(["common", "tickets"]);

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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const formKey = task?.id ? `ticket-${task.id}` : "create";

  // Load meta for create/edit (role-scoped values and permissions)
  const metaUrl = task?.id
    ? `/api/tickets/${task.id}/meta`
    : "/api/tickets/meta";
  const metaQuery = useQuery<any>({
    queryKey: ["ticket-meta", { id: task?.id ?? null }],
    enabled: isOpen,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const res = await apiRequest("GET", metaUrl);
      return await res.json();
    },
  });
  const meta: any = metaQuery.data;

  // Always load the freshest task details when editing to ensure full payload
  const taskDetailsQuery = useQuery<any>({
    queryKey: [task?.id ? `/api/tasks/${task.id}` : undefined],
    enabled: !!task?.id && isOpen,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tasks/${task.id}`);
      return res.json();
    },
  });
  const taskDetails = taskDetailsQuery.data;

  // Optional: debug in development

  const departments = meta?.departments || [];
  // Memoize teams to prevent unnecessary re-renders (stable reference)
  const teams = useMemo(() => meta?.teams || [], [meta?.teams]);
  const assignableUsers = meta?.assignableUsers || [];
  const categoriesMeta = meta?.categories || [];
  const prioritiesMeta = meta?.priorities || [];
  // statusesMeta unused in modal (status handled outside modal)
  const permissions = meta?.permissions || {};
  const isCustomer = (user as any)?.role === "customer";

  const effectivePermissions = permissions;
  const metadataValid = Array.isArray(meta?.categories) &&
    Array.isArray(meta?.priorities) && Array.isArray(permissions.allowedFields);
  const dataReady = metaQuery.isSuccess && metadataValid &&
    (!task?.id || (taskDetailsQuery.isSuccess && !!taskDetails));
  const formReady = dataReady && initializedFor === formKey;
  const formLoadError = metaQuery.isError || (metaQuery.isSuccess && !metadataValid) ||
    (!!task?.id && (taskDetailsQuery.isError || (taskDetailsQuery.isSuccess && !taskDetails)));

  const canEditField = (field: string) => {
    if (!formReady) return false;
    const allowed: string[] = task
      ? effectivePermissions.allowedFields
      : fallbackAllowedByRoleCreate[user?.role || ""] || [];
    return allowed.includes(field);
  };

  const canEditAnything = (() => {
    if (!formReady) return false;
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
      ].some((k) => canEditField(k))
    : formReady;

  // Prefer freshest task details for displaying read-only values
  const displayTask: TaskMinimal | undefined = (taskDetails || task) as any;

  // Reset/initialize form snapshot when task or modal state changes
  useEffect(() => {
    // Clear form when modal closes
    if (!isOpen) {
      setInitializedFor(null);
      setSelectedFiles([]);
      setAssignmentMode(isCustomer ? "team" : "user");
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
    } else if (dataReady && initializedFor !== formKey) {
      // Only process when modal is open and we have task data
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

        const dataToSet = {
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
          // Use derived values from teams array when team-assigned, otherwise use task values if they exist
          departmentId:
            current.assigneeType === "team" && departmentId
              ? departmentId
              : current.departmentId
              ? current.departmentId?.toString()
              : "",
          teamId:
            current.assigneeType === "team" && teamId
              ? teamId
              : current.teamId
              ? current.teamId?.toString()
              : "",
        };
        setFormData(dataToSet);
      }
      setInitializedFor(formKey);
    }
  }, [taskDetails, task, isOpen, dataReady, initializedFor, formKey, teams, isCustomer]);

  const createTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      // If there are files, use FormData; otherwise use JSON
      if (selectedFiles.length > 0) {
        const formData = new FormData();

        // Append all task fields
        Object.keys(taskData).forEach((key) => {
          const value = taskData[key];
          // Skip null, undefined, empty strings, and empty arrays
          if (
            value !== null &&
            value !== undefined &&
            value !== "" &&
            !(Array.isArray(value) && value.length === 0)
          ) {
            if (value instanceof Date) {
              formData.append(key, value.toISOString());
            } else if (Array.isArray(value)) {
              // Arrays travel as a JSON string; the server parses it.
              formData.append(key, JSON.stringify(value));
            } else if (typeof value === "object") {
              formData.append(key, JSON.stringify(value));
            } else if (
              typeof value === "number" ||
              typeof value === "boolean"
            ) {
              formData.append(key, String(value));
            } else {
              formData.append(key, String(value));
            }
          }
        });

        // Append files
        selectedFiles.forEach((file) => {
          formData.append("files", file);
        });

        return await apiRequest("POST", "/api/tasks", formData);
      } else {
        return await apiRequest("POST", "/api/tasks", taskData);
      }
    },
    onSuccess: async (response) => {
      const result = await response.json();

      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      // Invalidate any paged/filtered variants of tasks list
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey?.[0] === "string" &&
          String(q.queryKey[0]).startsWith("/api/tasks"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/agent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/manager"] });

      // Invalidate team tasks if ticket is assigned to a team
      if (result?.assigneeTeamId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/teams", result.assigneeTeamId, "tasks"],
        });
      }

      // Clear selected files
      setSelectedFiles([]);

      // Show warning if some attachments failed
      if (result.warning) {
        toast({
          title: t("messages.success"),
          description: t("tickets:modal.toasts.created"),
        });
        toast({
          title: t("messages.warning", { defaultValue: "Warning" }),
          description: result.warning,
          variant: "default",
        });
      } else {
        toast({
          title: t("messages.success"),
          description: t("tickets:modal.toasts.created"),
        });
      }

      onClose();
    },
    onError: (error: any) => {
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

      // Check for S3 configuration error
      let errorMessage =
        error?.message ||
        t("tickets:modal.toasts.errorCreate", {
          defaultValue: "Failed to create ticket",
        });

      // Check if error data contains S3 configuration error
      if (error?.data?.error === "S3_CONFIGURATION_REQUIRED") {
        errorMessage = error.data.message;
      } else if (
        error?.message?.includes("S3_CONFIGURATION_REQUIRED") ||
        error?.message?.includes("File attachment is not available")
      ) {
        errorMessage =
          user?.role === "admin"
            ? "File storage is not configured. Please configure AWS S3 credentials in environment variables."
            : "File attachment is not available. Please contact your administrator";
      }

      toast({
        title: t("messages.error"),
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return await apiRequest("PATCH", `/api/tasks/${task.id}`, taskData);
    },
    onSuccess: async (response) => {
      const result = await response.json();

      // Invalidate all task list queries (including filtered/paged variants)
      queryClient.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey?.[0] === "string" &&
          String(q.queryKey[0]).startsWith("/api/tasks"),
      });

      // Invalidate ticket detail queries
      if (task?.id) {
        queryClient.invalidateQueries({
          queryKey: [`/api/tasks/${task.id}`],
        });
        // Also invalidate related ticket queries
        queryClient.invalidateQueries({
          predicate: (q) =>
            typeof q.queryKey?.[0] === "string" &&
            String(q.queryKey[0]).includes(`/api/tasks/${task.id}`),
        });
      }

      // Invalidate stats queries
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/agent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/manager"] });

      // Invalidate team tasks if assignment changed to/from a team
      const oldTeamId = task?.assigneeTeamId;
      const newTeamId = result?.assigneeTeamId;

      // Invalidate old team's tasks if team assignment was removed or changed
      if (oldTeamId && oldTeamId !== newTeamId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/teams", oldTeamId, "tasks"],
        });
      }

      // Invalidate new team's tasks if team assignment was added or changed
      if (newTeamId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/teams", newTeamId, "tasks"],
        });
      }

      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.updated"),
      });
      onClose();
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
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formReady || !canEditAnything || createTaskMutation.isPending || updateTaskMutation.isPending) return;

    if (!formData.title.trim()) {
      toast({
        title: "Error",
        description: "Ticket title is required",
        variant: "destructive",
      });
      return;
    }

    // Only require category when creating a new ticket OR if user can edit category
    const isCreating = !task;
    const canEditCategory = canEditField("category");

    if ((isCreating || canEditCategory) && !formData.category) {
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
      notes: formData.notes, // Don't trim - preserve whitespace and allow empty strings
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

    const roleKey = (user?.role || "").toString();
    const allowedFieldsForEdit = Array.isArray(permissions?.allowedFields)
      ? (permissions?.allowedFields as string[])
      : [];
    const allowedFieldsForCreate = fallbackAllowedByRoleCreate[roleKey] || [];

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
      // The server owns a new ticket's status (always open) and rejects it in
      // a create body; attachments travel as multipart files, not a field.
      delete taskData.status;
      delete taskData.attachments;
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

      // Ensure notes is included if it's in allowedFields, even if empty
      // This allows users to clear notes by setting it to empty string
      if (allowedFieldsForEdit.includes("notes")) {
        // Always include notes if allowed, even if empty (to allow clearing)
        // If it was removed by pruneToAllowed, restore it from formData
        if (taskData.notes === undefined) {
          taskData.notes = formData.notes || "";
        }
      } else {
        // If notes is not allowed, remove it from payload
        delete (taskData as any).notes;
      }

      updateTaskMutation.mutate(taskData);
    } else {
      createTaskMutation.mutate(taskData);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90dvh] h-[90dvh] overflow-hidden p-0 flex flex-col">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="border-b bg-muted/40 px-4 pr-12 py-4 sm:px-6 sm:pr-12">
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  {task ? (
                    <FileText className="h-5 w-5 text-primary" />
                  ) : (
                    <Plus className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div className="flex-1">
                  <DialogTitle className="text-xl font-semibold text-foreground">
                    {task
                      ? t("tickets:modal.editTitle", {
                          ticketNumber: task.ticketNumber || "",
                        })
                      : t("tickets:modal.createTitle")}
                  </DialogTitle>
                  <DialogDescription asChild className="text-muted-foreground mt-1"><div>
                    {task ? (
                      <div className="space-y-1">
                        <span>{t("tickets:modal.editDesc")}</span>
                        <div className="flex flex-col gap-1 text-xs">
                          {task.creatorName && task.createdAt && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {t("tickets:modal.meta.createdBy", {
                                defaultValue: "Created by",
                              })}{" "}
                              {task.creatorName}{" "}
                              {t("tickets:modal.meta.on", {
                                defaultValue: "on",
                              })}{" "}
                              {new Date(task.createdAt).toLocaleDateString()}
                            </span>
                          )}
                          {task.lastUpdatedBy && task.updatedAt && (
                            <span className="flex items-center gap-1">
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
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span>
                        {t("tickets:modal.createDesc", {
                          defaultValue:
                            "Fill in the details below to create a new ticket",
                        })}
                      </span>
                    )}
                  </div></DialogDescription>
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
          <div className="min-h-0 flex-1 overflow-hidden">
            <Tabs defaultValue="details" className="h-full flex flex-col">
              <div className="border-b px-6">
                <TabsList className="bg-transparent h-12 p-0 w-full justify-start">
                  <TabsTrigger
                    value="details"
                    className="data-[state=active]:bg-background data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-primary rounded-none px-4 py-2"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {t("tickets:modal.tabs.details")}
                  </TabsTrigger>
                  {!task && (
                    <TabsTrigger
                      value="attachments"
                      className="data-[state=active]:bg-background data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-primary rounded-none px-4 py-2"
                    >
                      <Paperclip className="h-4 w-4 mr-2" />
                      {t("tickets:modal.tabs.attachments")}
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {formLoadError ? (
                  <div role="alert" className="mx-4 mt-4 rounded-lg border border-destructive/30 p-4 text-sm">
                    <p>Could not load ticket options or permissions. Your draft is preserved.</p>
                    <Button type="button" variant="outline" className="mt-3" onClick={() => {
                      void metaQuery.refetch();
                      if (task?.id) void taskDetailsQuery.refetch();
                    }}>Retry ticket form</Button>
                  </div>
                ) : !formReady ? (
                  <p role="status" className="px-6 py-4 text-sm text-muted-foreground">Loading ticket options and permissions…</p>
                ) : null}
                <TabsContent value="details" className="mt-0 h-full">
                  <form onSubmit={handleSubmit} className="p-4 sm:p-6">
                    <fieldset disabled={!formReady} className="min-w-0 space-y-6">
                    {/* Essential Information */}
                    <Card className="border-l-4 border-l-primary">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />
                          {t("tickets:modal.sections.essentialInfo")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Department/Team selection moved under Assignment & Timeline */}
                        <div>
                          <Label
                            htmlFor="title"
                            className="text-sm font-medium text-foreground flex items-center gap-2"
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
                            readOnly={!canEditField("title")}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("tickets:modal.help.titleHint", {
                              defaultValue: "Be specific and descriptive",
                            })}
                          </p>
                        </div>

                        <div>
                          <Label
                            htmlFor="description"
                            className="text-sm font-medium text-foreground flex items-center gap-2"
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
                            readOnly={!canEditField("description")}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            Include context, requirements, and acceptance
                            criteria
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <Label
                              htmlFor="category"
                              className="text-sm font-medium text-foreground flex items-center gap-2"
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
                                <SelectTrigger id="category" className="mt-2">
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
                              className="text-sm font-medium text-foreground flex items-center gap-2"
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
                                <SelectTrigger id="priority" className="mt-2">
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
                            <Label htmlFor="due-date" className="text-sm font-medium text-foreground flex items-center gap-2">
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
                                id="due-date"
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
                      <Card className="border-l-4 border-l-primary/50">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Users className="h-5 w-5 text-primary" />
                            {t("tickets:modal.sections.assignment")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <Label htmlFor="assignment-type" className="min-w-max text-sm font-medium text-foreground flex items-center gap-2">
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
                                <SelectTrigger id="assignment-type" className="mt-2">
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
                                <SelectTrigger id="assignment-type" className="mt-2">
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
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <Label htmlFor="department" className="text-sm font-medium text-foreground">
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
                                    <SelectTrigger id="department" className="mt-2">
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
                                  <Label htmlFor="team" className="text-sm font-medium text-foreground">
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
                                    <SelectTrigger id="team" className="mt-2">
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
                                <Label htmlFor="department" className="text-sm font-medium text-foreground">
                                  {t("tickets:modal.fields.department")}
                                </Label>
                                <Select
                                  value={formData.departmentId}
                                  onValueChange={(value) => {
                                    handleInputChange("departmentId", value);
                                    handleInputChange("teamId", "");
                                  }}
                                >
                                  <SelectTrigger id="department" className="mt-2">
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
                                <Label htmlFor="assignee" className="text-sm font-medium text-foreground">
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
                                  <SelectTrigger id="assignee" className="mt-2">
                                    <SelectValue
                                      placeholder={t(
                                        "tickets:modal.placeholders.searchUser"
                                      )}
                                    />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {assignableUsers?.map((user: any) => (
                                      <UserSelectItem
                                        key={user.id}
                                        user={user as FullUser}
                                        value={user.id}
                                        showEmail={false}
                                      />
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Additional Notes */}
                    <Card className="border-l-4 border-l-primary/30">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="h-5 w-5 text-primary" />
                          {t("tickets:modal.sections.notes")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Textarea
                          aria-label={t("tickets:modal.sections.notes")}
                          readOnly={!canEditField("notes")}
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
                    </fieldset>
                  </form>
                </TabsContent>

                {!task && (
                  <TabsContent value="attachments" className="mt-0 p-6">
                    <TaskAttachments
                      task={task}
                      onFilesChange={setSelectedFiles}
                    />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </div>

          {/* Footer */}
          <div className="border-t bg-muted/40 px-6 py-4">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("tickets:modal.buttons.cancel")}
              </Button>
              {task && formReady && !canEditAnything ? (
                <></>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !formReady || createTaskMutation.isPending || updateTaskMutation.isPending
                  }
                  className="bg-primary hover:bg-primary/90"
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
