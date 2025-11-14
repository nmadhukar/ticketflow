import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
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
import { Switch } from "@/components/ui/switch";
import { UserSelectItem } from "@/components/ui/user-select-item";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, Building, Users } from "lucide-react";
import type { Department, User } from "@shared/schema";
import MainWrapper from "@/components/main-wrapper";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";

const departmentSchema = z.object({
  name: z.string().min(2, "Department name must be at least 2 characters"),
  description: z.string().min(1, "Description is required"),
  managerId: z.string().optional(),
  isActive: z.boolean().default(true),
});

type DepartmentFormData = z.infer<typeof departmentSchema>;

export default function Departments() {
  const [, setLocation] = useLocation();
  const { t } = useTranslation(["common", "departments"]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";

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
      isActive: true,
    },
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

  const handleCreateSubmit = (data: DepartmentFormData) => {
    createMutation.mutate(data);
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
      action={
        isAdmin && departments?.length ? (
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
            <Card
              key={department.id}
              className="relative group cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => {
                setLocation(`/departments/${department.id}`);
              }}
            >
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3 flex-1">
                    <Building className="w-8 h-8 text-primary" />
                    <div className="flex-1">
                      <CardTitle className="text-lg">
                        {department.name}
                      </CardTitle>
                    </div>
                  </div>
                  <div className="ml-2">
                    {department.isActive ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200"
                      >
                        {t("departments:status.active")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="destructive"
                        className="bg-red-100 text-red-700 hover:bg-red-100 border-red-200"
                      >
                        {t("departments:status.inactive")}
                      </Badge>
                    )}
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
          {isAdmin && (
            <Button
              onClick={() => setIsCreateOpen(true)}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              {t("departments:empty.create")}
            </Button>
          )}
        </Card>
      )}

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
                control={createForm.control}
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
