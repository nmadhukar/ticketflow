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
  Send,
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
  Download,
  Trash2,
  Upload,
} from "lucide-react";
import generateShortId from "@/lib/generateShortId";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task?: any;
}

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

export default function TaskModal({ isOpen, onClose, task }: TaskModalProps) {
  const { toast } = useToast();
  const { user } = useAuth() as { user?: { role?: string } } as any;
  const queryClient = useQueryClient();
  const { t } = useTranslation(["common", "tickets"]);
  const [currentTab, setCurrentTab] = useState("details");
  const [commentText, setCommentText] = useState("");

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    priority: "medium",
    status: "open",
    notes: "",
    assigneeId: "",
    assigneeType: "user",
    assigneeTeamId: "",
    dueDate: "",
    departmentId: "",
    teamId: "",
  });

  // Load meta for create/edit (role-scoped values and permissions)
  const metaUrl = task?.id
    ? `/api/tickets/${task.id}/meta`
    : "/api/tickets/meta";
  const { data: meta } = useQuery<any>({
    queryKey: [metaUrl],
    enabled: true,
    initialData: {},
    refetchOnMount: "always",
  });

  // Always load the freshest task details when editing to ensure full payload
  const { data: taskDetails } = useQuery<any>({
    queryKey: [task?.id ? `/api/tasks/${task.id}` : undefined],
    enabled: !!task?.id && isOpen,
    refetchOnMount: "always",
  });

  const departments = meta?.departments || [];
  const teams = meta?.teams || [];
  const assignableUsers = meta?.assignableUsers || [];
  const categoriesMeta = meta?.categories || [];
  const prioritiesMeta = meta?.priorities || [];
  const statusesMeta = meta?.statuses || [];
  const permissions = meta?.permissions || {};

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

  const { data: taskComments } = useQuery<any[]>({
    queryKey: ["/api/tasks", task?.id, "comments"],
    enabled: !!task?.id && isOpen,
    retry: false,
    initialData: [],
    refetchOnMount: "always",
  });

  const { data: taskAttachments, refetch: refetchAttachments } = useQuery<
    any[]
  >({
    queryKey: ["/api/tasks", task?.id, "attachments"],
    enabled: !!task?.id && isOpen,
    retry: false,
    initialData: [],
    refetchOnMount: "always",
  });

  useEffect(() => {
    const current = (taskDetails || task) as any;
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
        priority: current.priority || "medium",
        status: current.status || "open",
        notes: current.notes || "",
        assigneeId: current.assigneeId || "unassigned",
        assigneeType: current.assigneeType || "user",
        assigneeTeamId: current.assigneeTeamId?.toString?.() || "unassigned",
        dueDate: current.dueDate
          ? new Date(current.dueDate).toISOString().split("T")[0]
          : "",
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
        assigneeType: "user",
        assigneeTeamId: "",
        dueDate: "",
        departmentId: "",
        teamId: "",
      });
      setCurrentTab("details");
    }
  }, [task, taskDetails, isOpen]);

  const createTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return await apiRequest("POST", "/api/tasks", taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
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

  const addCommentMutation = useMutation({
    mutationFn: async (commentData: any) => {
      return await apiRequest(
        "POST",
        `/api/tasks/${task.id}/comments`,
        commentData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/tasks", task?.id, "comments"],
      });
      setCommentText("");
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.commentAdded"),
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
        description: t("tickets:modal.toasts.errorComment", {
          defaultValue: "Failed to add comment",
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

    // Customers must select Department and Team (routing)
    if (user?.role === "customer") {
      if (!formData.departmentId) {
        toast({
          title: "Error",
          description: "Department is required",
          variant: "destructive",
        });
        return;
      }
      if (!formData.teamId) {
        toast({
          title: "Error",
          description: "Team is required",
          variant: "destructive",
        });
        return;
      }
    }

    const taskData = {
      ticketNumber: generateShortId(), // Prevents validation errors in shared/schema line 110
      title: formData.title.trim(),
      description: formData.description.trim(),
      category: formData.category,
      priority: formData.priority,
      status: formData.status,
      notes: formData.notes.trim(),
      assigneeId:
        formData.assigneeType === "user" && formData.assigneeId !== "unassigned"
          ? formData.assigneeId
          : null,
      assigneeType: formData.assigneeType,
      assigneeTeamId:
        formData.assigneeType === "team" &&
        formData.assigneeTeamId !== "unassigned"
          ? parseInt(formData.assigneeTeamId)
          : null,
      dueDate: formData.dueDate
        ? new Date(formData.dueDate).toISOString()
        : null,
      // For customers, include explicit routing fields required by API
      ...(user?.role === "customer"
        ? {
            departmentId: parseInt(formData.departmentId),
            teamId: parseInt(formData.teamId),
            assigneeType: "team" as const,
          }
        : {}),
    } as any;

    // If editing, prune disallowed fields client-side for UX; server still enforces
    if (task && Array.isArray(permissions?.allowedFields)) {
      const allowedSet = new Set<string>(permissions.allowedFields);
      Object.keys(taskData).forEach((key) => {
        if (!allowedSet.has(key)) {
          delete (taskData as any)[key];
        }
      });
    }

    if (task) {
      updateTaskMutation.mutate(taskData);
    } else {
      createTaskMutation.mutate(taskData);
    }
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;

    addCommentMutation.mutate({
      content: commentText.trim(),
    });
  };

  // File attachment mutations
  const addAttachmentMutation = useMutation({
    mutationFn: async (attachmentData: any) => {
      return await apiRequest(
        "POST",
        `/api/tasks/${task?.id}/attachments`,
        attachmentData
      );
    },
    onSuccess: () => {
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.fileAttached"),
      });
      refetchAttachments();
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
        description: t("tickets:modal.toasts.errorAttach", {
          defaultValue: "Failed to attach file",
        }),
        variant: "destructive",
      });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      return await apiRequest("DELETE", `/api/attachments/${attachmentId}`);
    },
    onSuccess: () => {
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.attachmentDeleted"),
      });
      refetchAttachments();
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
        description: t("tickets:modal.toasts.errorDelete", {
          defaultValue: "Failed to delete attachment",
        }),
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !task?.id) return;

    // In a real app, you would upload the file to a storage service
    // For now, we'll simulate with a fake URL
    const fakeUrl = `https://storage.example.com/${Date.now()}_${file.name}`;

    await addAttachmentMutation.mutateAsync({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileUrl: fakeUrl,
    });

    // Reset the input
    e.target.value = "";
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
                  {task && (
                    <>
                      <TabsTrigger
                        value="comments"
                        className="data-[state=active]:bg-white data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none px-4 py-2"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {t("tickets:modal.tabs.comments")}{" "}
                        {taskComments?.length ? `(${taskComments.length})` : ""}
                      </TabsTrigger>
                    </>
                  )}
                  <TabsTrigger
                    value="attachments"
                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none px-4 py-2"
                  >
                    <Paperclip className="h-4 w-4 mr-2" />
                    {t("tickets:modal.tabs.attachments")}{" "}
                    {taskAttachments?.length
                      ? `(${taskAttachments.length})`
                      : ""}
                  </TabsTrigger>
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
                            {t("tickets:modal.fields.taskTitle")} *
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

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label
                              htmlFor="category"
                              className="text-sm font-medium text-slate-700 flex items-center gap-2"
                            >
                              <Tag className="h-4 w-4" />
                              {t("tickets:modal.fields.category")} *
                            </Label>
                            <Select
                              value={formData.category}
                              onValueChange={(value) =>
                                handleInputChange("category", value)
                              }
                              disabled={!!task && !canEditField("category")}
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
                          </div>

                          <div>
                            <Label
                              htmlFor="priority"
                              className="text-sm font-medium text-slate-700 flex items-center gap-2"
                            >
                              <Flag className="h-4 w-4" />
                              {t("tickets:modal.fields.priority")}
                            </Label>
                            <Select
                              value={formData.priority}
                              onValueChange={(value) =>
                                handleInputChange("priority", value)
                              }
                              disabled={!!task && !canEditField("priority")}
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
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Status & Priority - only show status when editing */}
                    {task && (
                      <Card className="border-l-4 border-l-yellow-500">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg flex items-center gap-2">
                            <CircleDot className="h-5 w-5 text-yellow-600" />
                            {t("tickets:modal.sections.status")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div>
                            <Label
                              htmlFor="status"
                              className="text-sm font-medium text-slate-700 flex items-center gap-2"
                            >
                              <CircleDot className="h-4 w-4" />
                              {t("tickets:modal.fields.currentStatus")}
                            </Label>
                            <Select
                              value={formData.status}
                              onValueChange={(value) =>
                                handleInputChange("status", value)
                              }
                              disabled={!!task && !canEditField("status")}
                            >
                              <SelectTrigger className="mt-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {statusesMeta?.map((s: string) => (
                                  <SelectItem key={s} value={s}>
                                    <div className="flex items-center gap-2">
                                      {s === "open" && (
                                        <CircleDot className="h-4 w-4 text-blue-500" />
                                      )}
                                      {s === "in_progress" && (
                                        <Clock className="h-4 w-4 text-yellow-500" />
                                      )}
                                      {(s === "resolved" || s === "closed") && (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                      )}
                                      {s === "on_hold" && (
                                        <AlertTriangle className="h-4 w-4 text-orange-500" />
                                      )}
                                      {s.replace("_", " ")}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Assignment & Timeline */}
                    <Card className="border-l-4 border-l-green-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Users className="h-5 w-5 text-green-600" />
                          {t("tickets:modal.sections.assignment")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <User className="h-4 w-4" />
                              {t("tickets:modal.fields.assignmentType")}
                            </Label>
                            <Select
                              value={formData.assigneeType}
                              onValueChange={(value) =>
                                handleInputChange("assigneeType", value)
                              }
                              disabled={!!task && !canEditField("assigneeType")}
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
                          </div>

                          <div>
                            <Label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              {t("tickets:modal.fields.dueDate")}
                            </Label>
                            <Input
                              type="date"
                              value={formData.dueDate}
                              onChange={(e) =>
                                handleInputChange("dueDate", e.target.value)
                              }
                              className="mt-2"
                              disabled={!!task && !canEditField("dueDate")}
                            />
                          </div>
                        </div>

                        {formData.assigneeType === "team" &&
                          (
                            effectivePermissions?.allowedAssigneeTypes || []
                          )?.includes("team") && (
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label className="text-sm font-medium text-slate-700">
                                  {t("tickets:modal.fields.department")} *
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
                                  {t("tickets:modal.fields.teamReq")} *
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

                        {formData.assigneeType !== "team" &&
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
                                disabled={!!task && !canEditField("assigneeId")}
                              >
                                <SelectTrigger className="mt-2">
                                  <SelectValue
                                    placeholder={t(
                                      "tickets:modal.placeholders.searchUser"
                                    )}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unassigned">
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4" />
                                      {t("tickets:modal.fields.unassigned")}
                                    </div>
                                  </SelectItem>
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

                {task && (
                  <TabsContent value="comments" className="mt-0 p-6">
                    <div className="space-y-4">
                      {/* Add Comment */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Send className="h-4 w-4" />
                            {t("tickets:modal.sections.comments")}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <Textarea
                            placeholder={t(
                              "tickets:modal.placeholders.comment"
                            )}
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            rows={3}
                            className="resize-none"
                          />
                          <div className="flex justify-end">
                            <Button
                              onClick={handleAddComment}
                              disabled={
                                !commentText.trim() ||
                                addCommentMutation.isPending
                              }
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Send className="h-4 w-4 mr-2" />
                              {addCommentMutation.isPending
                                ? t("tickets:modal.buttons.adding")
                                : t("tickets:modal.buttons.addComment")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Comments List */}
                      <div className="space-y-3">
                        {taskComments?.length ? (
                          taskComments?.map((comment: any) => (
                            <Card
                              key={comment.id}
                              className="border-l-4 border-l-blue-200"
                            >
                              <CardContent className="pt-4">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 bg-blue-100 rounded-full">
                                    <User className="h-4 w-4 text-blue-600" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-medium text-slate-900">
                                        {comment.userName}
                                      </span>
                                      <span className="text-xs text-slate-500">
                                        {new Date(
                                          comment.createdAt
                                        ).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <p className="text-slate-700">
                                      {comment.content}
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          <div className="text-center py-8 text-slate-500">
                            <Send className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No comments yet. Be the first to add one!</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                )}

                <TabsContent value="attachments" className="mt-0 p-6">
                  <div className="space-y-4">
                    {/* Upload Attachment */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          {t("tickets:modal.sections.attachments")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                          <input
                            type="file"
                            id="file-upload"
                            className="hidden"
                            onChange={handleFileUpload}
                            disabled={addAttachmentMutation.isPending}
                          />
                          <label
                            htmlFor="file-upload"
                            className="cursor-pointer"
                          >
                            <Paperclip className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                            <p className="text-sm text-slate-600">
                              {t("tickets:modal.placeholders.uploadCta")}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                              {t("tickets:modal.placeholders.uploadHelp")}
                            </p>
                          </label>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Attachments List */}
                    <div className="space-y-3">
                      <h3 className="font-medium text-slate-900">
                        {t("tickets:modal.sections.attachmentsList")}
                      </h3>
                      {taskAttachments?.length ? (
                        taskAttachments?.map((attachment: any) => (
                          <Card
                            key={attachment.id}
                            className="border-l-4 border-l-purple-200"
                          >
                            <CardContent className="pt-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-purple-100 rounded-full">
                                    <Paperclip className="h-4 w-4 text-purple-600" />
                                  </div>
                                  <div>
                                    <p className="font-medium text-slate-900">
                                      {attachment.fileName}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {(attachment.fileSize / 1024).toFixed(2)}{" "}
                                      KB •{" "}
                                      {t("tickets:modal.meta.uploadedBy", {
                                        defaultValue: "Uploaded by",
                                      })}{" "}
                                      {attachment.userName}{" "}
                                      {t("tickets:modal.meta.on", {
                                        defaultValue: "on",
                                      })}{" "}
                                      {new Date(
                                        attachment.createdAt
                                      ).toLocaleDateString()}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      window.open(attachment.fileUrl, "_blank")
                                    }
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      deleteAttachmentMutation.mutate(
                                        attachment.id
                                      )
                                    }
                                    disabled={
                                      deleteAttachmentMutation.isPending
                                    }
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      ) : (
                        <div className="text-center py-8 text-slate-500">
                          <Paperclip className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>{t("tickets:modal.empty.noAttachments")}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>

          {/* Footer */}
          <div className="border-t bg-slate-50 px-6 py-4">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("tickets:modal.buttons.cancel")}
              </Button>
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
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
