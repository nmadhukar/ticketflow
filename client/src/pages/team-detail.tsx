import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { useParams, useLocation } from "wouter";
import Header from "@/components/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Users,
  Plus,
  UserPlus,
  Settings,
  Crown,
  Calendar,
  Shield,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MainWrapper from "@/components/main-wrapper";

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("member");

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ["/api/teams", id],
    retry: false,
    enabled: isAuthenticated && !!id,
  });

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ["/api/teams", id, "members"],
    retry: false,
    enabled: isAuthenticated && !!id,
  });

  const { data: allUsers } = useQuery({
    queryKey: ["/api/users"],
    retry: false,
    enabled: isAuthenticated,
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/assign-team`,
        {
          teamId: parseInt(id!),
          role,
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", id, "members"],
      });
      setIsAddMemberOpen(false);
      setSelectedUserId("");
      setSelectedRole("member");
      toast({
        title: "Success",
        description: "Member added to team",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to add member to team",
        variant: "destructive",
      });
    },
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest("PATCH", `/api/teams/${id}/members/${userId}`, {
        role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", id, "members"],
      });
      toast({
        title: "Success",
        description: "Member role updated",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update member role",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!team && !teamLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Team not found
          </h2>
          <p className="text-slate-600 mb-4">
            The team you're looking for doesn't exist.
          </p>
          <Button onClick={() => setLocation("/teams")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Teams
          </Button>
        </div>
      </div>
    );
  }

  const handleAddMember = () => {
    if (!selectedUserId) {
      toast({
        title: "Error",
        description: "Please select a user",
        variant: "destructive",
      });
      return;
    }

    addMemberMutation.mutate({
      userId: selectedUserId,
      role: selectedRole,
    });
  };

  // Filter out users who are already members
  const availableUsers =
    allUsers?.filter(
      (user: any) => !members?.some((member: any) => member.userId === user.id)
    ) || [];

  const isUserAdminOrManager = ["manager", "admin"].includes(user?.role);

  return (
    <MainWrapper
      title="Teams"
      subTitle="Manage your teams and collaborate effectively"
      action={
        <Button
          variant="outline"
          onClick={() => {
            const pathname =
              user?.role === "admin"
                ? "/admin/teams?section=management"
                : "/teams";
            setLocation(pathname);
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Teams
        </Button>
      }
    >
      {teamLoading ? (
        <div className="text-center py-8">Loading team details...</div>
      ) : (
        <div className="space-y-6">
          {/* Team Info */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Users className="h-8 w-8 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{team?.name}</CardTitle>
                    <CardDescription className="text-base mt-1">
                      {team?.description || "No description provided"}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-col gap-4 items-end justify-between">
                  {isUserAdminOrManager &&
                    !membersLoading &&
                    !!members.length && (
                      <Button
                        className="bg-blue-600 hover:bg-blue-700"
                        onClick={() => setIsAddMemberOpen(true)}
                      >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Add Member
                      </Button>
                    )}
                  <Badge variant="outline" className="bg-blue-50 text-blue-700">
                    <Calendar className="h-3 w-3 mr-1" />
                    Created {new Date(team?.createdAt).toLocaleDateString()}
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Team Members */}
          <Card>
            <CardHeader>
              <CardTitle>Team Members ({members?.length || 0})</CardTitle>
              <CardDescription>
                Manage team members and their roles
              </CardDescription>
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="text-center py-8">Loading members...</div>
              ) : members?.length ? (
                <div className="grid gap-4">
                  {members.map((member: any) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <Avatar>
                          <AvatarImage src={member.user.profileImageUrl} />
                          <AvatarFallback>
                            {member.user.firstName?.[0]}
                            {member.user.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">
                            {member.user.firstName} {member.user.lastName}
                          </p>
                          <p className="text-sm text-slate-500">
                            {member.user.email}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge
                          variant={
                            member.role === "admin" ? "default" : "outline"
                          }
                          className={
                            member.role === "admin"
                              ? "bg-purple-100 text-purple-700"
                              : ""
                          }
                        >
                          {member.role === "admin" && (
                            <Crown className="h-3 w-3 mr-1" />
                          )}
                          Team {member.role}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          Joined{" "}
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </span>
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
                            {member.role === "admin" ? (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateMemberRoleMutation.mutate({
                                    userId: member.userId,
                                    role: "member",
                                  })
                                }
                              >
                                <Shield className="mr-2 h-4 w-4" />
                                Remove Admin
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateMemberRoleMutation.mutate({
                                    userId: member.userId,
                                    role: "admin",
                                  })
                                }
                              >
                                <Crown className="mr-2 h-4 w-4" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-slate-900 mb-2">
                    No members yet
                  </h3>
                  <p className="text-slate-500 mb-4">
                    This team doesn't have any members. Add some members to get
                    started.
                  </p>
                  <Button
                    onClick={() => setIsAddMemberOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Add First Member
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog open={isAddMemberOpen} onOpenChange={setIsAddMemberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
            <DialogDescription>
              Add a new member to {team?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="user-select">Select User</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a user to add..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((user: any) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="role-select">Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddMemberOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddMember}
              disabled={addMemberMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {addMemberMutation.isPending ? "Adding..." : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
