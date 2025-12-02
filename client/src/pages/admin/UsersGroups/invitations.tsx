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
import {
  Loader2,
  Plus,
  Mail,
  Calendar,
  UserPlus,
  Clock,
  Check,
  X,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import type { UserInvitation, Department } from "@shared/schema";

const invitationSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["admin", "manager", "agent", "customer"]),
  departmentId: z.string().optional(),
  expiresAt: z.string().datetime(),
});

type InvitationFormData = z.infer<typeof invitationSchema>;

export default function Invitations() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: invitations, isLoading } = useQuery<UserInvitation[]>({
    queryKey: ["/api/admin/invitations"],
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["/api/departments"],
  });

  const { data: users } = useQuery<Array<{ email: string }>>({
    queryKey: ["/api/users"],
  });

  // Check email service configuration
  const { data: emailStatus } = useQuery<{
    isConfigured: boolean;
    hasEmailProvider: boolean;
    hasEmailTemplate: boolean;
    message: string;
  }>({
    queryKey: ["/api/admin/email-service/status"],
  });

  const isEmailConfigured =
    emailStatus?.hasEmailProvider && emailStatus?.hasEmailTemplate;

  const form = useForm<InvitationFormData>({
    resolver: zodResolver(invitationSchema),
    defaultValues: {
      email: "",
      role: "agent",
      departmentId: "none",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
    },
  });

  // Check for pending invitations and existing users when email changes
  const emailValue = form.watch("email");
  const hasPendingInvitation = invitations?.some(
    (inv) =>
      inv.email.toLowerCase() === emailValue?.toLowerCase() &&
      inv.status === "pending" &&
      new Date(inv.expiresAt) > new Date()
  );
  const userExists = users?.some(
    (user) => user.email.toLowerCase() === emailValue?.toLowerCase()
  );

  const createMutation = useMutation({
    mutationFn: async (data: InvitationFormData) => {
      await apiRequest("POST", "/api/admin/invitations", {
        ...data,
        departmentId:
          data.departmentId && data.departmentId !== "none"
            ? parseInt(data.departmentId)
            : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({
        title: "Success",
        description: "Invitation sent successfully",
      });
      setIsCreateOpen(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send invitation",
        variant: "destructive",
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/invitations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invitations"] });
      toast({
        title: "Success",
        description: "Invitation cancelled successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel invitation",
        variant: "destructive",
      });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/admin/invitations/${id}/resend`);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Invitation resent successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resend invitation",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (data: InvitationFormData) => {
    createMutation.mutate(data);
  };

  const getStatusBadge = (invitation: UserInvitation) => {
    if (invitation.status === "accepted") {
      return (
        <Badge variant="secondary" className="gap-1">
          <Check className="w-3 h-3" /> Accepted
        </Badge>
      );
    }

    if (invitation.status === "cancelled") {
      return (
        <Badge variant="destructive" className="gap-1">
          <X className="w-3 h-3" /> Cancelled
        </Badge>
      );
    }

    const isExpired = new Date(invitation.expiresAt) < new Date();
    if (isExpired) {
      return (
        <Badge variant="destructive" className="gap-1">
          <X className="w-3 h-3" /> Expired
        </Badge>
      );
    }

    return (
      <Badge className="gap-1">
        <Clock className="w-3 h-3" /> Pending
      </Badge>
    );
  };

  const getRoleBadge = (role: string) => {
    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      admin: "destructive",
      manager: "secondary",
      user: "default",
      customer: "outline",
    };

    return <Badge variant={variants[role] || "default"}>{role}</Badge>;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <div className="flex items-center justify-between">
          <CardHeader>
            <CardTitle>User Invitations</CardTitle>
            <CardDescription>
              Invite new users to join your organization
            </CardDescription>
          </CardHeader>
          <CardHeader>
            <Button
              className="gap-2"
              onClick={() => setIsCreateOpen(true)}
              disabled={!isEmailConfigured}
              title={
                !isEmailConfigured
                  ? "Email service is not configured. Please configure AWS SES credentials and email templates."
                  : ""
              }
            >
              <UserPlus className="w-4 h-4" />
              Send Invitation
            </Button>
          </CardHeader>
        </div>
        <CardContent className="space-y-4">
          {!isEmailConfigured && (
            <Card className="border-yellow-500/20 bg-yellow-500/5">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-yellow-900 dark:text-yellow-100">
                      Email service not configured
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      {emailStatus?.message ||
                        "Please configure AWS SES credentials and email templates to send invitations."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {invitations?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mail className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-lg text-muted-foreground">
                  No invitations sent yet
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Send your first invitation to get started
                </p>
              </CardContent>
            </Card>
          ) : (
            invitations?.map((invitation: UserInvitation) => {
              const department = departments?.find(
                (d: Department) => d.id === invitation.departmentId
              );
              return (
                <Card key={invitation.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Mail className="w-5 h-5" />
                          {invitation.email}
                        </CardTitle>
                        <CardDescription className="mt-2 flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            Sent{" "}
                            {invitation.createdAt
                              ? format(new Date(invitation.createdAt), "PPP")
                              : "Unknown"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            Expires{" "}
                            {format(new Date(invitation.expiresAt), "PPP")}
                          </span>
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        {getRoleBadge(invitation.role)}
                        {getStatusBadge(invitation)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between items-center">
                      <div className="text-sm text-muted-foreground">
                        {department && (
                          <span>Department: {department.name}</span>
                        )}
                      </div>
                      {invitation.status === "pending" &&
                        new Date(invitation.expiresAt) > new Date() && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                resendMutation.mutate(invitation.id)
                              }
                              disabled={
                                resendMutation.isPending || !isEmailConfigured
                              }
                              title={
                                !isEmailConfigured
                                  ? "Email service is not configured"
                                  : ""
                              }
                            >
                              {resendMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Mail className="w-4 h-4" />
                              )}
                              <span className="ml-2">Resend</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                cancelMutation.mutate(invitation.id)
                              }
                              disabled={cancelMutation.isPending}
                            >
                              {cancelMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <X className="w-4 h-4" />
                              )}
                              <span className="ml-2">Cancel</span>
                            </Button>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send User Invitation</DialogTitle>
            <DialogDescription>
              Invite a new user to join TicketFlow
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      An invitation email will be sent to this address
                    </FormDescription>
                    {userExists && emailValue && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        <span>
                          A user with this email address already exists in the
                          system. You cannot send an invitation to an existing
                          user.
                        </span>
                      </div>
                    )}
                    {hasPendingInvitation && emailValue && !userExists && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4" />
                        <span>
                          A pending invitation already exists for this email
                          address. Please wait for it to expire or be accepted
                          before sending a new invitation.
                        </span>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>User Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="agent">{`Agent (Tech Support)`}</SelectItem>
                        <SelectItem value="customer">Customer</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Choose the role for the invited user
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="departmentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a department" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No Department</SelectItem>
                        {departments?.map((dept: Department) => (
                          <SelectItem key={dept.id} value={dept.id.toString()}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expiresAt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expiration Date</FormLabel>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        {...field}
                        value={
                          field.value
                            ? new Date(field.value).toISOString().slice(0, 16)
                            : ""
                        }
                        onChange={(e) =>
                          field.onChange(new Date(e.target.value).toISOString())
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      The invitation will expire after this date
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {!isEmailConfigured && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                  <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">
                    Email service is not configured. Invitations cannot be sent
                    until AWS SES credentials and email templates are
                    configured.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={
                    createMutation.isPending ||
                    !isEmailConfigured ||
                    hasPendingInvitation ||
                    userExists
                  }
                >
                  {createMutation.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Send Invitation
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
