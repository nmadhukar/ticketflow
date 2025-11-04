import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Pencil, Trash2, Building, Users } from "lucide-react";
import type { Department, User } from "@shared/schema";
import MainWrapper from "@/components/main-wrapper";
import { useTranslation } from "react-i18next";

const departmentSchema = z.object({
  name: z.string().min(2, "Department name must be at least 2 characters"),
  description: z.string().optional(),
  managerId: z.string().optional(),
});

type DepartmentFormData = z.infer<typeof departmentSchema>;

export default function Departments() {
  const { t } = useTranslation(["common", "departments"]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(
    null
  );
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
    refetchInterval: 30000, //
    refetchOnMount: "always",
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const createForm = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      name: "",
      description: "",
      managerId: "none",
    },
  });

  const editForm = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema),
  });

  const createMutation = useMutation({
    mutationFn: async (data: DepartmentFormData) => {
      const payload = {
        ...data,
        managerId:
          !data.managerId || data.managerId === "none" ? null : data.managerId,
      };
      await apiRequest("POST", "/api/admin/departments", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({
        title: t("messages.success"),
        description: t("departments:toasts.created"),
      });
      setIsCreateOpen(false);
      createForm.reset();
    },
    onError: (error) => {
      toast({
        title: t("messages.error"),
        description:
          error.message ||
          t("departments:errors.createFailed", {
            defaultValue: "Failed to create department",
          }),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: DepartmentFormData;
    }) => {
      const payload = {
        ...data,
        managerId:
          !data.managerId || data.managerId === "none" ? null : data.managerId,
      };
      await apiRequest("PUT", `/api/admin/departments/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({
        title: t("messages.success"),
        description: t("departments:toasts.updated"),
      });
      setEditingDepartment(null);
    },
    onError: (error) => {
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
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/departments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departments"] });
      toast({
        title: t("messages.success"),
        description: t("departments:toasts.deleted"),
      });
    },
    onError: (error) => {
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

  const handleCreateSubmit = (data: DepartmentFormData) => {
    createMutation.mutate(data);
  };

  const handleEditSubmit = (data: DepartmentFormData) => {
    if (editingDepartment) {
      updateMutation.mutate({ id: editingDepartment.id, data });
    }
  };

  const handleEditOpen = (department: Department) => {
    setEditingDepartment(department);
    editForm.reset({
      name: department.name,
      description: department.description || "",
      managerId: department.managerId || "none",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <MainWrapper
      title={t("departments:title")}
      subTitle={t("departments:subtitle")}
      action={
        departments?.length ? (
          <Button className="gap-2" onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4" />
            {t("departments:actions.add")}
          </Button>
        ) : null
      }
    >
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {departments?.map((department: Department) => {
          const manager = users.find(
            (u: User) => u.id === department.managerId
          );
          return (
            <Card key={department.id} className="relative group">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <Building className="w-8 h-8 text-primary" />
                    <div>
                      <CardTitle className="text-lg">
                        {department.name}
                      </CardTitle>
                      {department.isActive ? (
                        <Badge variant="secondary" className="mt-1">
                          {t("departments:status.active")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="mt-1">
                          {t("departments:status.inactive")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleEditOpen(department)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(department.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription className="mb-4">
                  {department.description ||
                    t("departments:labels.noDescription", {
                      defaultValue: "No description provided",
                    })}
                </CardDescription>
                {manager && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>
                      {t("departments:labels.managerLine", {
                        first: manager.firstName,
                        last: manager.lastName,
                      })}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!departments?.length && (
        <Card className="p-12 text-center bg-white rounded-2xl border">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <Building className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-2xl font-semibold text-slate-900 mb-2">
            {t("departments:empty.title")}
          </h3>
          <p className="text-slate-500 mb-6 max-w-xl mx-auto">
            {t("departments:empty.desc")}
          </p>
          <Button
            onClick={() => setIsCreateOpen(true)}
            className="gap-2 bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            {t("departments:empty.create")}
          </Button>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog
        open={!!editingDepartment}
        onOpenChange={(open) => !open && setEditingDepartment(null)}
      >
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
                            <SelectItem key={user.id} value={user.id}>
                              {user.firstName} {user.lastName} ({user.email})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {t("departments:actions.update")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("departments:dialogs.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("departments:dialogs.createDesc")}
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form
              onSubmit={createForm.handleSubmit(handleCreateSubmit)}
              className="space-y-4"
            >
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("departments:labels.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Engineering" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("departments:labels.description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Department description..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
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
                          .filter(
                            (user: User) =>
                              user.role === "admin" || user.role === "manager"
                          )
                          .map((user: User) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.firstName} {user.lastName} ({user.email})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {t("departments:actions.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
