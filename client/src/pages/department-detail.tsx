import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Building,
  Calendar,
  UserCog,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { UserSelectItem } from "@/components/ui/user-select-item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import MainWrapper from "@/components/main-wrapper";
import { useDepartment, useDepartmentTeams } from "@/hooks/useDepartments";
import { DepartmentTeamsSection } from "@/components/departments/department-teams-section";
import { DepartmentStatsSection } from "@/components/departments/department-stats-section";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import type { User } from "@shared/schema";

const departmentSchema = z.object({
  name: z.string().min(2, "Department name must be at least 2 characters"),
  description: z.string().min(1, "Description is required"),
  managerId: z.string().optional(),
  isActive: z.boolean().default(true),
});

type DepartmentFormData = z.infer<typeof departmentSchema>;

export default function DepartmentDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const { t } = useTranslation(["common", "departments"]);
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const {
    data: department,
    isLoading: departmentLoading,
    error: departmentError,
  } = useDepartment(id);
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
    retry: false,
    enabled: isAuthenticated,
  });

  const editForm = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
  });

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
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
  }, [isAuthenticated, isLoading, toast]);

  // Handle 403 Forbidden errors (unauthorized access to department)
  useEffect(() => {
    if (departmentError) {
      const error = departmentError as any;
      // Check if it's a 403 Forbidden error
      if (
        error?.status === 403 ||
        error?.message?.includes("403") ||
        error?.message?.includes("Forbidden") ||
        error?.message?.includes("don't have access")
      ) {
        toast({
          title: t("departments:errors.accessDenied", {
            defaultValue: "Access Denied",
          }),
          description: t("departments:errors.noAccessToDepartment", {
            defaultValue: "You don't have permission to view this department.",
          }),
          variant: "destructive",
        });
        setTimeout(() => {
          setLocation("/departments");
        }, 1500);
      }
    }
  }, [departmentError, toast, setLocation, t]);

  // Only admins can edit departments
  const canEdit = (user as any)?.role === "admin";

  // Check if user can view this department
  const canView =
    (user as any)?.role === "admin" ||
    ((user as any)?.role === "manager" &&
      department?.managerId === (user as any)?.id);

  const updateMutation = useMutation({
    mutationFn: async (data: DepartmentFormData) => {
      const payload = {
        ...data,
        managerId:
          !data.managerId || data.managerId === "none" ? null : data.managerId,
      };
      await apiRequest("PUT", `/api/admin/departments/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/departments", id] });
      toast({
        title: t("messages.success"),
        description: t("departments:toasts.updated"),
      });
      setIsEditOpen(false);
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
        description:
          error.message ||
          t("departments:errors.updateFailed", {
            defaultValue: "Failed to update department",
          }),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/admin/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({
        title: t("messages.success"),
        description: t("departments:toasts.deleted"),
      });
      setLocation("/departments");
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
        description:
          error.message ||
          t("departments:errors.deleteFailed", {
            defaultValue: "Failed to delete department",
          }),
        variant: "destructive",
      });
    },
  });

  const handleEditOpen = () => {
    if (department) {
      editForm.reset({
        name: department.name,
        description: department.description || "",
        managerId: department.managerId || "none",
        isActive: department.isActive ?? true,
      });
      setIsEditOpen(true);
    }
  };

  const handleEditSubmit = (data: DepartmentFormData) => {
    updateMutation.mutate(data);
  };

  const handleDelete = () => {
    if (
      window.confirm(
        "Are you sure you want to delete this department? This action cannot be undone."
      )
    ) {
      deleteMutation.mutate();
    }
  };

  // Find manager user
  const manager = department?.managerId
    ? users.find((u: User) => u.id === department.managerId)
    : null;

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  // Show error state for 403 or other errors
  if (departmentError && !departmentLoading) {
    const error = departmentError as any;
    const isForbidden =
      error?.status === 403 ||
      error?.message?.includes("403") ||
      error?.message?.includes("Forbidden") ||
      error?.message?.includes("don't have access");

    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {isForbidden
              ? t("departments:errors.accessDenied", {
                  defaultValue: "Access Denied",
                })
              : t("departments:errors.loadFailed", {
                  defaultValue: "Failed to Load Department",
                })}
          </h2>
          <p className="text-slate-600 mb-4">
            {isForbidden
              ? t("departments:errors.noAccessToDepartment", {
                  defaultValue:
                    "You don't have permission to view this department.",
                })
              : t("departments:errors.departmentNotFound", {
                  defaultValue:
                    "The department you're looking for doesn't exist or you don't have access to it.",
                })}
          </p>
          <Button onClick={() => setLocation("/departments")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("departments:actions.backToDepartments", {
              defaultValue: "Back to Departments",
            })}
          </Button>
        </div>
      </div>
    );
  }

  if (!department && !departmentLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {t("departments:errors.departmentNotFound", {
              defaultValue: "Department not found",
            })}
          </h2>
          <p className="text-slate-600 mb-4">
            {t("departments:errors.departmentNotFoundDesc", {
              defaultValue:
                "The department you're looking for doesn't exist or you don't have access to it.",
            })}
          </p>
          <Button onClick={() => setLocation("/departments")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("departments:actions.backToDepartments", {
              defaultValue: "Back to Departments",
            })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <MainWrapper
      title={t("departments:title")}
      subTitle={t("departments:subtitle")}
    >
      {departmentLoading ? (
        <div className="text-center py-8">
          <Spinner size="lg" className="mx-auto mb-4" />
          <p className="text-slate-500">Loading department details...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Back Button */}
          <Button variant="outline" onClick={() => setLocation("/departments")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Departments
          </Button>

          {/* Department Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Building className="h-8 w-8 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">
                      {department?.name}
                    </CardTitle>
                    <CardDescription className="text-base mt-1">
                      {department?.description ||
                        t("departments:labels.noDescription", {
                          defaultValue: "No description provided",
                        })}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-col gap-4 items-end justify-between">
                  <div className="flex gap-2">
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleEditOpen}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                    )}
                    {(user as any)?.role === "admin" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDelete}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {department?.isActive ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-700"
                      >
                        {t("departments:status.active")}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        {t("departments:status.inactive")}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className="bg-blue-50 text-blue-700"
                    >
                      <Calendar className="h-3 w-3 mr-1" />
                      Created{" "}
                      {department?.createdAt
                        ? new Date(department.createdAt).toLocaleDateString()
                        : "N/A"}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {manager && (
                <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                  <Avatar>
                    <AvatarImage src={manager.profileImageUrl || undefined} />
                    <AvatarFallback>
                      {manager.firstName?.[0]}
                      {manager.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="flex items-center gap-2">
                      <UserCog className="h-4 w-4 text-slate-500" />
                      <p className="font-medium">
                        {t("departments:labels.manager")}
                      </p>
                    </div>
                    <p className="text-sm text-slate-600">
                      {manager.firstName} {manager.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{manager.email}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Department Sections with Tabs */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="teams">Teams</TabsTrigger>
              <TabsTrigger value="statistics">Statistics</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Department Information</CardTitle>
                  <CardDescription>
                    Basic information about this department
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-slate-600 mb-1">
                      Name
                    </p>
                    <p className="text-base">{department?.name}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-600 mb-1">
                      Description
                    </p>
                    <p className="text-base text-slate-700">
                      {department?.description ||
                        t("departments:labels.noDescription", {
                          defaultValue: "No description provided",
                        })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-600 mb-1">
                      Status
                    </p>
                    {department?.isActive ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-700"
                      >
                        {t("departments:status.active")}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        {t("departments:status.inactive")}
                      </Badge>
                    )}
                  </div>
                  {department?.createdAt && (
                    <div>
                      <p className="text-sm font-medium text-slate-600 mb-1">
                        Created
                      </p>
                      <p className="text-base">
                        {new Date(department.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  {department?.updatedAt && (
                    <div>
                      <p className="text-sm font-medium text-slate-600 mb-1">
                        Last Updated
                      </p>
                      <p className="text-base">
                        {new Date(department.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="teams" className="space-y-4">
              <DepartmentTeamsSection departmentId={id!} />
            </TabsContent>

            <TabsContent value="statistics" className="space-y-4">
              <DepartmentStatsSection departmentId={id!} />
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("departments:dialogs.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("departments:dialogs.editDesc")}
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit(handleEditSubmit)}
              className="space-y-4"
            >
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("departments:labels.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("departments:labels.description")}</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="managerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("departments:labels.manager")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t("departments:labels.selectManager")}
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">
                          {t("departments:labels.noManager")}
                        </SelectItem>
                        {users
                          ?.filter(
                            (user: User) =>
                              user.role === "admin" || user.role === "manager"
                          )
                          .map((user: User) => (
                            <UserSelectItem
                              key={user.id}
                              user={user}
                              value={user.id}
                            />
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        {t("departments:labels.status")}
                      </FormLabel>
                      <FormDescription>
                        {t("departments:labels.statusDescription", {
                          defaultValue:
                            "Enable or disable this department. Inactive departments cannot be assigned to new tickets.",
                        })}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsEditOpen(false)}
                  type="button"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Updating...
                    </>
                  ) : (
                    t("departments:actions.update")
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
