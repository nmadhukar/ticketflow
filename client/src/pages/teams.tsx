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

  const { data: teams, isLoading: teamsLoading } = useQuery<any[]>({
    queryKey: ["/api/teams"],
    retry: false,
    enabled:
      isAuthenticated && ["manager", "admin"].includes((user as any)?.role),
    refetchOnMount: "always",
    initialData: [],
  });

  const {
    data: myTeams,
    isLoading: myTeamsLoading,
    error: myTeamsError,
  } = useQuery<any[]>({
    queryKey: ["/api/teams/my"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/teams/my");
      return res.json();
    },
    retry: false,
    enabled: isAuthenticated,
    initialData: [],
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
      title={t("teams:title")}
      subTitle={t("teams:subtitle")}
      action={
        isUserAdminOrManager &&
        !myTeamsLoading &&
        !!myTeams?.length && (
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("teams:actions.create")}
          </Button>
        )
      }
    >
      {/* My Teams Section */}

      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4">{t("teams:my.title")}</h3>
        {myTeamsLoading ? (
          <div className="text-center py-8">{t("teams:my.loading")}</div>
        ) : myTeams && myTeams.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {myTeams.map((team: any) => (
              <Card
                key={team.id}
                className="hover:shadow-business transition-shadow"
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
                        className="bg-purple-100 text-purple-700 hover:bg-purple-200"
                      >
                        <Crown className="h-3 w-3 mr-1" />
                        {t("teams:my.owner")}
                      </Badge>
                    ) : teamAdminStatus?.[team.id] ? (
                      <Badge
                        variant="secondary"
                        className="bg-blue-100 text-blue-700 hover:bg-blue-200"
                      >
                        <Crown className="h-3 w-3 mr-1" />
                        {t("teams:all.admin")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="bg-slate-50 text-slate-700"
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
                    <div className="text-xs text-slate-500">
                      {t("teams:my.created", {
                        date: new Date(team.createdAt).toLocaleDateString(),
                      })}
                    </div>
                    <Link href={`/teams/${team.id}`}>
                      <Button size="sm" variant="outline" className="h-8">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        {t("teams:actions.open")}
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
                {t("teams:my.emptyTitle")}
              </h3>
              <p className="text-slate-500 mb-4">
                {t("teams:my.emptyDesc", {
                  extra: isUserAdminOrManager ? t("teams:my.extraAdmin") : "",
                })}
              </p>
              {isUserAdminOrManager ? (
                <Button
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="bg-blue-600 hover:bg-blue-700"
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
      </div>

      {/* All Teams Section */}
      {isUserAdminOrManager ? (
        <div>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">
            {t("teams:all.title")}
          </h3>
          {teamsLoading ? (
            <div className="text-center py-8">{t("teams:all.loading")}</div>
          ) : teams && teams.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {teams.map((team: any) => (
                <Card
                  key={team.id}
                  className="hover:shadow-md transition-shadow"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Users className="h-6 w-6 text-emerald-600" />
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
                          className="bg-blue-100 text-blue-700 hover:bg-blue-200"
                        >
                          <Crown className="h-3 w-3 mr-1" />
                          {t("teams:all.admin")}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-slate-50 text-slate-700"
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
                      <div className="text-xs text-slate-500">
                        {t("teams:all.created", {
                          date: new Date(team.createdAt).toLocaleDateString(),
                        })}
                      </div>
                      <Link href={`/teams/${team.id}`}>
                        <Button size="sm" variant="outline" className="h-8">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {t("teams:actions.open")}
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
                  {t("teams:all.emptyTitle")}
                </h3>
                <p className="text-slate-500">{t("teams:all.emptyDesc")}</p>
              </CardContent>
            </Card>
          )}
        </div>
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
    </MainWrapper>
  );
}
