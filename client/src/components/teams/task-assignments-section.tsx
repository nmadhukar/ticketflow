import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  UserPlus,
  MoreVertical,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useTaskAssignments,
  useCreateTaskAssignment,
  useUpdateTaskAssignment,
  useDeleteTaskAssignment,
} from "@/hooks/useTeamTasks";
import { useTeamPermissions, useTeamAdmins } from "@/hooks/useTeamAdmins";
import type { TeamMember, TeamTaskAssignment } from "@/types/teams";
import { Spinner } from "@/components/ui/spinner";
import { UserSelectItem } from "@/components/ui/user-select-item";
import type { User as FullUser } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface TaskAssignmentsSectionProps {
  teamId: string | number;
  taskId: string | number;
  members?: TeamMember[]; // Optional - if not provided, will fetch with taskId filter
  variant?: "default" | "nested"; // For nested usage (e.g., inside accordion)
}

export function TaskAssignmentsSection({
  teamId,
  taskId,
  members: membersProp,
  variant = "default",
}: TaskAssignmentsSectionProps) {
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] =
    useState<TeamTaskAssignment | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("active");

  // Fetch members with taskId filter to exclude already assigned members
  const { data: fetchedMembers } = useQuery<TeamMember[]>({
    queryKey: ["/api/teams", teamId, "members", taskId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/teams/${teamId}/members?taskId=${taskId}`
      );
      return res.json();
    },
    enabled: !!teamId && !!taskId && !membersProp,
    retry: false,
  });

  // Use provided members or fetched members
  const members = membersProp || fetchedMembers || [];

  const { data: assignments, isLoading: assignmentsLoading } =
    useTaskAssignments(teamId, taskId);
  const { data: permissions } = useTeamPermissions(teamId);
  const { data: admins } = useTeamAdmins(teamId);
  const createAssignmentMutation = useCreateTaskAssignment(teamId, taskId);
  const updateAssignmentMutation = useUpdateTaskAssignment(
    teamId,
    taskId,
    selectedAssignment?.id
  );
  const deleteAssignmentMutation = useDeleteTaskAssignment(
    teamId,
    taskId,
    selectedAssignment?.id
  );

  const canManage = permissions?.canManageTeam ?? false;
  const hasAdmins = (admins?.length || 0) > 0;
  const canAssignTask = canManage && hasAdmins;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4" />;
      case "cancelled":
        return <XCircle className="h-4 w-4" />;
      case "reassigned":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-blue-100 text-blue-700";
      case "completed":
        return "bg-green-100 text-green-700";
      case "cancelled":
        return "bg-red-100 text-red-700";
      case "reassigned":
        return "bg-orange-100 text-orange-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const handleAssign = () => {
    if (!selectedUserId) return;

    // If editing an existing assignment, update it
    if (selectedAssignment?.id) {
      updateAssignmentMutation.mutate(
        {
          status: status || "active",
          notes: notes || undefined,
          priority: priority || undefined,
        },
        {
          onSuccess: () => {
            setIsAssignDialogOpen(false);
            resetForm();
          },
        }
      );
    } else {
      // Otherwise, create a new assignment
      createAssignmentMutation.mutate(
        {
          userId: selectedUserId,
          notes: notes || undefined,
          priority: priority || undefined,
        },
        {
          onSuccess: () => {
            setIsAssignDialogOpen(false);
            resetForm();
          },
        }
      );
    }
  };

  const resetForm = () => {
    setSelectedAssignment(null);
    setSelectedUserId("");
    setNotes("");
    setPriority("");
    setStatus("active");
  };

  const handleUpdate = (assignment: TeamTaskAssignment) => {
    setSelectedAssignment(assignment);
    // Pre-fill form with assignment values
    setSelectedUserId(assignment.assignedUserId || "");
    setNotes(assignment.notes || "");
    setPriority(assignment.priority || "");
    setStatus(assignment.status || "active");
    setIsAssignDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setIsAssignDialogOpen(open);
    if (!open) {
      resetForm();
    }
  };

  const handleDelete = (assignment: TeamTaskAssignment) => {
    if (
      window.confirm(
        "Are you sure you want to remove this assignment? This action cannot be undone."
      )
    ) {
      setSelectedAssignment(assignment);
      deleteAssignmentMutation.mutate(undefined, {
        onSuccess: () => {
          setSelectedAssignment(null);
        },
      });
    }
  };

  const assignmentsContent = (
    <div className={variant === "nested" ? "space-y-4" : ""}>
      {variant === "nested" && canAssignTask && (
        <div className="flex items-center justify-between mb-4 pb-2 border-b">
          <div>
            <h4 className="font-semibold text-sm">Task Assignments</h4>
            <p className="text-xs text-muted-foreground">
              Team members assigned to work on this task
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setIsAssignDialogOpen(true)}
            className="bg-primary hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4 mr-2" />
            Assign Task
          </Button>
        </div>
      )}
      {assignmentsLoading ? (
        <div className="text-center py-8">
          <Spinner size="lg" className="mx-auto mb-4" />
          <p className="text-slate-500">Loading assignments...</p>
        </div>
      ) : assignments?.length ? (
        <div className="grid gap-4">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex items-center space-x-3 flex-1">
                {assignment.assignedUser ? (
                  <Avatar>
                    <AvatarImage
                      src={assignment.assignedUser.profileImageUrl || undefined}
                    />
                    <AvatarFallback>
                      {assignment.assignedUser.firstName?.[0]}
                      {assignment.assignedUser.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                    <AlertCircle className="h-5 w-5 text-slate-400" />
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium">
                      {assignment.assignedUser
                        ? `${assignment.assignedUser.firstName} ${assignment.assignedUser.lastName}`
                        : "Unknown User"}
                    </p>
                    <Badge className={getStatusColor(assignment.status)}>
                      {getStatusIcon(assignment.status)}
                      <span className="ml-1">{assignment.status}</span>
                    </Badge>
                    {assignment.priority && (
                      <Badge variant="outline">{assignment.priority}</Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-500 space-y-1">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Assigned{" "}
                        {new Date(assignment.assignedAt).toLocaleDateString()}
                      </span>
                      {assignment.assignedByUser && (
                        <span>
                          by {assignment.assignedByUser.firstName}{" "}
                          {assignment.assignedByUser.lastName}
                        </span>
                      )}
                    </div>
                    {assignment.notes && (
                      <p className="text-slate-600">{assignment.notes}</p>
                    )}
                    {assignment.completedAt && (
                      <p className="text-green-600">
                        Completed{" "}
                        {new Date(assignment.completedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleUpdate(assignment)}>
                      Edit Assignment
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(assignment)}
                      className="text-red-600"
                    >
                      Remove Assignment
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <UserPlus className="h-12 w-12 text-slate-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            No assignments yet
          </h3>
          <p className="text-slate-500 mb-4">
            Assign this task to team members to track their work.
          </p>
          {canAssignTask && (
            <Button
              onClick={() => setIsAssignDialogOpen(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign Task
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {variant === "default" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  Task Assignments ({assignments?.length || 0})
                </CardTitle>
                <CardDescription>
                  Team members assigned to work on this task
                </CardDescription>
              </div>
              {canAssignTask && (
                <Button
                  size="sm"
                  onClick={() => setIsAssignDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Assign Task
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>{assignmentsContent}</CardContent>
        </Card>
      ) : (
        assignmentsContent
      )}

      {/* Assign/Edit Task Dialog */}
      <Dialog open={isAssignDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedAssignment?.id
                ? "Edit Assignment"
                : "Assign Task to Team Member"}
            </DialogTitle>
            <DialogDescription>
              {selectedAssignment?.id
                ? "Update the assignment details"
                : "Select a team member to assign this task to"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="member-select">Team Member *</Label>
              <Select
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                disabled={!!selectedAssignment?.id}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a member..." />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <UserSelectItem
                      key={member.userId}
                      user={member.user as FullUser}
                      value={member.userId}
                    />
                  ))}
                </SelectContent>
              </Select>
              {selectedAssignment?.id && (
                <p className="text-xs text-muted-foreground mt-1">
                  User cannot be changed when editing an assignment
                </p>
              )}
            </div>
            {selectedAssignment?.id && (
              <div>
                <Label htmlFor="status-select">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="reassigned">Reassigned</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="priority-select">Priority (Optional)</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="Select priority..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any notes about this assignment..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAssignDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={
                createAssignmentMutation.isPending ||
                updateAssignmentMutation.isPending ||
                !selectedUserId
              }
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createAssignmentMutation.isPending ||
              updateAssignmentMutation.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {selectedAssignment?.id ? "Updating..." : "Assigning..."}
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  {selectedAssignment?.id ? "Update" : "Assign"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
