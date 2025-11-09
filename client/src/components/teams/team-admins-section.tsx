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
import { Crown, Shield, UserPlus, MoreVertical, Calendar } from "lucide-react";
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
import {
  useTeamAdmins,
  useGrantTeamAdmin,
  useRevokeTeamAdmin,
} from "@/hooks/useTeamAdmins";
import { useTeamPermissions } from "@/hooks/useTeamAdmins";
import type { TeamMember } from "@/types/teams";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/hooks/useAuth";
import type { Team } from "@shared/schema";

interface TeamAdminsSectionProps {
  teamId: string | number;
  members: TeamMember[];
  team?: Team | null;
}

export function TeamAdminsSection({
  teamId,
  members,
  team,
}: TeamAdminsSectionProps) {
  const [isGrantDialogOpen, setIsGrantDialogOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const { user } = useAuth();

  const { data: admins, isLoading: adminsLoading } = useTeamAdmins(teamId);
  const { data: permissions } = useTeamPermissions(teamId);
  const grantAdminMutation = useGrantTeamAdmin(teamId);
  const revokeAdminMutation = useRevokeTeamAdmin(teamId);

  // Only system admins or team owners can grant/revoke admin status
  const canManage =
    (user as any)?.role === "admin" || team?.createdBy === (user as any)?.id;

  // Filter members who are not already admins
  const nonAdminMembers = members.filter(
    (member) => !admins?.some((admin) => admin.userId === member.userId)
  );

  const handleGrantAdmin = () => {
    if (!selectedMemberId) return;
    grantAdminMutation.mutate(selectedMemberId, {
      onSuccess: () => {
        setIsGrantDialogOpen(false);
        setSelectedMemberId("");
      },
    });
  };

  const handleRevokeAdmin = (adminId: string) => {
    if (window.confirm("Are you sure you want to revoke admin status?")) {
      revokeAdminMutation.mutate(adminId);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Admins ({admins?.length || 0})</CardTitle>
              <CardDescription>
                Users with administrative privileges for this team
              </CardDescription>
            </div>
            {canManage && nonAdminMembers.length > 0 && (
              <Button
                size="sm"
                onClick={() => setIsGrantDialogOpen(true)}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Grant Admin
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {adminsLoading ? (
            <div className="text-center py-8">
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-slate-500">Loading admins...</p>
            </div>
          ) : admins?.length ? (
            <div className="grid gap-4">
              {admins.map((admin) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <Avatar>
                      <AvatarImage
                        src={admin.user.profileImageUrl || undefined}
                      />
                      <AvatarFallback>
                        {admin.user.firstName?.[0]}
                        {admin.user.lastName?.[0]}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {admin.user.firstName} {admin.user.lastName}
                        </p>
                        <Badge className="bg-purple-100 text-purple-700">
                          <Crown className="h-3 w-3 mr-1" />
                          Admin
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {admin.user.email}
                      </p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Granted{" "}
                          {new Date(admin.grantedAt).toLocaleDateString()}
                        </span>
                        {admin.grantedByUser && (
                          <span>
                            by {admin.grantedByUser.firstName}{" "}
                            {admin.grantedByUser.lastName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {canManage && (
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
                        <DropdownMenuItem
                          onClick={() => handleRevokeAdmin(admin.userId)}
                          className="text-red-600"
                        >
                          <Shield className="mr-2 h-4 w-4" />
                          Revoke Admin
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Crown className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">
                No team admins yet
              </h3>
              <p className="text-slate-500 mb-4">
                Grant admin status to team members to give them administrative
                privileges.
              </p>
              {canManage && nonAdminMembers.length > 0 && (
                <Button
                  onClick={() => setIsGrantDialogOpen(true)}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <UserPlus className="h-4 w-4 mr-2" />
                  Grant First Admin
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Grant Admin Dialog */}
      <Dialog open={isGrantDialogOpen} onOpenChange={setIsGrantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant Team Admin Status</DialogTitle>
            <DialogDescription>
              Select a team member to grant administrative privileges
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="member-select">Select Team Member</Label>
              <Select
                value={selectedMemberId}
                onValueChange={setSelectedMemberId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a member..." />
                </SelectTrigger>
                <SelectContent>
                  {nonAdminMembers.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.user.firstName} {member.user.lastName} (
                      {member.user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsGrantDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGrantAdmin}
              disabled={grantAdminMutation.isPending || !selectedMemberId}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {grantAdminMutation.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Granting...
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4 mr-2" />
                  Grant Admin
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
