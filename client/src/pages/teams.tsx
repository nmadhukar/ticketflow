import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MainWrapper from "@/components/main-wrapper";
import { useTranslation } from "react-i18next";

export default function Teams() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation(["common", "teams"]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [departmentId, setDepartmentId] = useState<string>("");

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
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
  }, [isAuthenticated, isLoading, toast]);

  const { data: teams, isLoading: teamsLoading, isError: teamsError, refetch: refetchTeams } = useQuery<any[]>({
    queryKey: ["/api/teams"],
    retry: false,
    enabled:
      isAuthenticated && ["manager", "admin"].includes((user as any)?.role),
    refetchOnMount: "always",
  });

  const {
    data: myTeams,
    isLoading: myTeamsLoading,
    isError: myTeamsError,
    refetch: refetchMyTeams,
  } = useQuery<any[]>({
    queryKey: ["/api/teams/my"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/teams/my");
      return res.json();
    },
    retry: false,
    enabled: isAuthenticated,
    refetchOnMount: "always",
  });

  // Fetch user's team admin status for all teams
  const { data: teamAdminStatus } = useQuery<Record<number, boolean>>({
    queryKey: ["/api/user/team-admin-status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/team-admin-status");
      return res.json();
    },
    enabled: isAuthenticated,
    retry: false,
  });

  // Fetch departments for team creation (role-based)
  const { data: departments } = useQuery<any[]>({
    queryKey: ["/api/teams/departments"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/teams/departments");
      return res.json();
    },
    enabled: isAuthenticated && isCreateDialogOpen,
    retry: false,
  });

  const createTeamMutation = useMutation({
    mutationFn: async (teamData: {
      name: string;
      description: string;
      departmentId: number;
    }) => {
      return await apiRequest("POST", "/api/teams", teamData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams/my"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/user/team-admin-status"],
      });
      setIsCreateDialogOpen(false);
      setTeamName("");
      setTeamDescription("");
      setDepartmentId("");
      toast({
        title: t("messages.success"),
        description: t("teams:toasts.created"),
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
        description: t("teams:errors.createFailed"),
        variant: "destructive",
      });
    },
  });

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {t("actions.loading")}
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

    if (!departmentId) {
      toast({
        title: "Error",
        description: t("teams:form.departmentRequired"),
        variant: "destructive",
      });
      return;
    }

    createTeamMutation.mutate({
      name: teamName.trim(),
      description: teamDescription.trim(),
      departmentId: parseInt(departmentId),
    });
  };

  const isUserAdminOrManager = ["manager", "admin"].includes(
    (user as any)?.role
  );

  return (
    <MainWrapper
      action={
        isUserAdminOrManager &&
        (
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("teams:actions.create")}
          </Button>
        )
      }
    >
      <div className="mx-auto max-w-7xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("teams:title")}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{t("teams:subtitle")}</p>
      </header>
      {/* My Teams Section */}

      <section aria-labelledby="my-teams-heading" className="space-y-4">
        <h2 id="my-teams-heading" className="text-lg font-semibold">{t("teams:my.title")}</h2>
        {myTeamsLoading ? (
          <div role="status" className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">{t("teams:my.loading")}</div>
        ) : myTeamsError ? (
          <Card><CardContent className="space-y-3 p-8"><h3 className="font-semibold">Could not load your teams</h3><p className="text-sm text-muted-foreground">Please try again.</p><Button variant="outline" onClick={() => refetchMyTeams()}>Try again</Button></CardContent></Card>
        ) : myTeams && myTeams.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {myTeams.map((team: any) => (
              <Card
                key={team.id}
                className="transition-shadow hover:shadow-business"
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Users className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg line-clamp-2 break-words">
                          {team.name}
                        </CardTitle>
                      </div>
                    </div>
                    {team.createdBy === (user as any)?.id ? (
                      <Badge
                        variant="default"
                      >
                        <Crown className="h-3 w-3 mr-1" />
                        {t("teams:my.owner")}
                      </Badge>
                    ) : teamAdminStatus?.[team.id] ? (
                      <Badge
                        variant="secondary"
                      >
                        <Crown className="h-3 w-3 mr-1" />
                        {t("teams:all.admin")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                      >
                        <Crown className="h-3 w-3 mr-1" />
                        {t("teams:my.member")}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="mb-4">
                    {team.description || "No description provided"}
                  </CardDescription>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {t("teams:my.created", {
                        date: new Date(team.createdAt).toLocaleDateString(),
                      })}
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/teams/${team.id}`}>
                        <ExternalLink className="h-3 w-3 mr-1" />
                        {t("teams:actions.open")}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {t("teams:my.emptyTitle")}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">{t("teams:my.emptyDesc")}</p>
              {isUserAdminOrManager ? (
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("teams:my.createFirst")}
                </Button>
              ) : (
                <></>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {/* All Teams Section */}
      {isUserAdminOrManager ? (
        <section aria-labelledby="all-teams-heading" className="space-y-4">
          <h2 id="all-teams-heading" className="text-lg font-semibold">
            {t("teams:all.title")}
          </h2>
          {teamsLoading ? (
            <div role="status" className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">{t("teams:all.loading")}</div>
          ) : teamsError ? (
            <Card><CardContent className="space-y-3 p-8"><h3 className="font-semibold">Could not load teams</h3><p className="text-sm text-muted-foreground">Please try again.</p><Button variant="outline" onClick={() => refetchTeams()}>Try again</Button></CardContent></Card>
          ) : teams && teams.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {teams.map((team: any) => (
                <Card
                  key={team.id}
                  className="transition-shadow hover:shadow-business"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Users className="h-6 w-6 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg line-clamp-2 break-words">
                            {team.name}
                          </CardTitle>
                        </div>
                      </div>
                      {teamAdminStatus?.[team.id] ? (
                        <Badge
                          variant="secondary"
                        >
                          <Crown className="h-3 w-3 mr-1" />
                          {t("teams:all.admin")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                        >
                          <Crown className="h-3 w-3 mr-1" />
                          {t("teams:my.member")}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="mb-4">
                      {team.description || "No description provided"}
                    </CardDescription>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">
                        {t("teams:all.created", {
                          date: new Date(team.createdAt).toLocaleDateString(),
                        })}
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/teams/${team.id}`}>
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {t("teams:actions.open")}
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {t("teams:all.emptyTitle")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("teams:all.emptyDesc")}</p>
              </CardContent>
            </Card>
          )}
        </section>
      ) : (
        <></>
      )}

      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
          if (!open) {
            // Reset form when dialog closes
            setTeamName("");
            setTeamDescription("");
            setDepartmentId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("teams:form.createTitle")}</DialogTitle>
            <DialogDescription>{t("teams:form.createDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="team-name">{t("teams:form.name")}</Label>
              <Input
                id="team-name"
                placeholder={t("teams:form.namePlaceholder")}
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="team-department">
                {t("teams:form.department")}
              </Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger id="team-department">
                  <SelectValue placeholder={t("teams:form.selectDepartment")} />
                </SelectTrigger>
                <SelectContent>
                  {departments?.map((dept: any) => (
                    <SelectItem key={dept.id} value={dept.id.toString()}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="team-description">
                {t("teams:form.description")}
              </Label>
              <Textarea
                id="team-description"
                placeholder={t("teams:form.descriptionPlaceholder")}
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
              {t("teams:form.cancel")}
            </Button>
            <Button
              onClick={handleCreateTeam}
              disabled={createTeamMutation.isPending}
            >
              {createTeamMutation.isPending
                ? t("teams:actions.creating")
                : t("teams:actions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </MainWrapper>
  );
}
