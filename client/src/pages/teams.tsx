import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
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
import { Badge } from "@/components/ui/badge";
import { Plus, Users, Crown, ExternalLink } from "lucide-react";
import { Link } from "wouter";
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
import { Textarea } from "@/components/ui/textarea";
import MainWrapper from "@/components/main-wrapper";

export default function Teams() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");

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

  const { data: teams, isLoading: teamsLoading } = useQuery<any[]>({
    queryKey: ["/api/teams"],
    retry: false,
    enabled:
      isAuthenticated && ["manager", "admin"].includes((user as any)?.role),
    refetchOnMount: "always",
    initialData: [],
  });

  const { data: myTeams, isLoading: myTeamsLoading } = useQuery<any[]>({
    queryKey: ["/api/teams/my"],
    retry: false,
    enabled: isAuthenticated,
    initialData: [],
  });

  const createTeamMutation = useMutation({
    mutationFn: async (teamData: { name: string; description: string }) => {
      return await apiRequest("POST", "/api/teams", teamData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams/my"] });
      setIsCreateDialogOpen(false);
      setTeamName("");
      setTeamDescription("");
      toast({
        title: "Success",
        description: "Team created successfully",
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
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to create team",
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

  const handleCreateTeam = () => {
    if (!teamName.trim()) {
      toast({
        title: "Error",
        description: "Team name is required",
        variant: "destructive",
      });
      return;
    }

    createTeamMutation.mutate({
      name: teamName.trim(),
      description: teamDescription.trim(),
    });
  };

  const isUserAdminOrManager = ["manager", "admin"].includes(
    (user as any)?.role
  );

  return (
    <MainWrapper
      title="Teams"
      subTitle="Manage your teams and collaborate effectively"
      action={
        isUserAdminOrManager &&
        !myTeamsLoading &&
        !!myTeams?.length && (
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Team
          </Button>
        )
      }
    >
      {/* My Teams Section */}

      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4">My Teams</h3>
        {myTeamsLoading ? (
          <div className="text-center py-8">Loading your teams...</div>
        ) : myTeams && myTeams.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {myTeams.map((team: any) => (
              <Card
                key={team.id}
                className="hover:shadow-business transition-shadow"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Users className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{team.name}</CardTitle>
                      </div>
                    </div>
                    <Badge variant="secondary">
                      <Crown className="h-3 w-3 mr-1" />
                      Member
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="mb-4">
                    {team.description || "No description provided"}
                  </CardDescription>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500">
                      Created {new Date(team.createdAt).toLocaleDateString()}
                    </div>
                    <Link href={`/teams/${team.id}`}>
                      <Button size="sm" variant="outline" className="h-8">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Open Team
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">
                No teams yet
              </h3>
              <p className="text-slate-500 mb-4">
                {` You're not a member of any teams. ${
                  isUserAdminOrManager
                    ? "Create a team or ask to be invited to one."
                    : ""
                }`}
              </p>
              {isUserAdminOrManager ? (
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Team
                </Button>
              ) : (
                <></>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* All Teams Section */}
      {isUserAdminOrManager ? (
        <div>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            All Teams
          </h3>
          {teamsLoading ? (
            <div className="text-center py-8">Loading teams...</div>
          ) : teams && teams.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {teams.map((team: any) => (
                <Card
                  key={team.id}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <Users className="h-6 w-6 text-emerald-600" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{team.name}</CardTitle>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="bg-slate-50 text-slate-700"
                      >
                        Public
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="mb-4">
                      {team.description || "No description provided"}
                    </CardDescription>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-slate-500">
                        Created {new Date(team.createdAt).toLocaleDateString()}
                      </div>
                      <Link href={`/teams/${team.id}`}>
                        <Button size="sm" variant="outline" className="h-8">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Open Team
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-slate-900 mb-2">
                  No teams found
                </h3>
                <p className="text-slate-500">
                  No teams have been created yet. Be the first to create one!
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <></>
      )}

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
            <DialogDescription>
              Create a new team to collaborate with other members on tasks and
              projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                placeholder="Enter team name..."
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                placeholder="Describe your team's purpose..."
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTeam}
              disabled={createTeamMutation.isPending}
            >
              {createTeamMutation.isPending ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
