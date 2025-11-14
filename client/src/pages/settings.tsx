import MainWrapper from "@/components/main-wrapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserPreferencesComponent from "@/components/user-preferences";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { User, UserSession } from "@/types/user";
import { getAuthMethod } from "@/utils/auth";
import { formatDate, getDeviceInfo } from "@/utils/session";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Trash2, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Settings() {
  const { user } = useAuth();
  const typedUser = user as User | undefined;
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<
    UserSession[]
  >({
    queryKey: ["/api/user/sessions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/sessions");
      return res.json();
    },
  });

  const revokeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await apiRequest("DELETE", `/api/user/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/sessions"] });
      toast({
        title: t("messages.success"),
        description: t("settings.sessionRevokedSuccess"),
      });
    },
    onError: (error: any) => {
      toast({
        title: t("messages.error"),
        description: error.message || t("settings.failedToRevokeSession"),
        variant: "destructive",
      });
    },
  });

  const handleRevokeSession = (sessionId: string) => {
    if (confirm(t("settings.revokeSessionConfirm"))) {
      revokeSessionMutation.mutate(sessionId);
    }
  };

  return (
    <MainWrapper>
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <UserIcon className="h-4 w-4" />
            {t("settings.profile")}
          </TabsTrigger>
          <TabsTrigger value="preferences" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {t("settings.preferences")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card className="space-y-10 p-5">
            <div className="flex items-center gap-4">
              {typedUser?.profileImageUrl ? (
                <img
                  src={typedUser.profileImageUrl}
                  alt={typedUser.firstName || t("settings.profile")}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                  <UserIcon className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold">
                  {typedUser?.firstName} {typedUser?.lastName}
                </h3>
                <p className="text-muted-foreground">{typedUser?.email}</p>
                <Badge variant="secondary" className="mt-1">
                  {typedUser?.role}
                </Badge>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">{t("settings.firstName")}</p>
                <p className="text-sm text-muted-foreground">
                  {typedUser?.firstName || t("settings.notProvided")}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">{t("settings.lastName")}</p>
                <p className="text-sm text-muted-foreground">
                  {typedUser?.lastName || t("settings.notProvided")}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">{t("settings.email")}</p>
                <p className="text-sm text-muted-foreground">
                  {typedUser?.email || t("settings.notProvided")}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">{t("settings.role")}</p>
                {typedUser?.role ? (
                  <Badge className="uppercase">{typedUser.role}</Badge>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("settings.notProvided")}
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm font-medium">{t("settings.phone")}</p>
                <p className="text-sm text-muted-foreground">
                  {typedUser?.phone || t("settings.notProvided")}
                </p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">
                  {t("settings.authenticatedVia")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {getAuthMethod(typedUser, t)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">
                  {t("settings.accountCreated")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {typedUser?.createdAt
                    ? new Date(typedUser.createdAt).toLocaleDateString()
                    : t("settings.notProvided")}
                </p>
              </div>
            </div>

            <Separator />
            <div className="space-y-2">
              <h4 className="text-base font-medium">
                {t("settings.activeSessions")}
              </h4>
              {sessionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.noActiveSessions")}
                </p>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.sessionId}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            {session.isCurrent
                              ? t("settings.currentSession")
                              : getDeviceInfo(session.userAgent)}
                          </p>
                          {session.isCurrent && (
                            <Badge variant="default">
                              {t("settings.active")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("settings.lastActive")}:{" "}
                          {formatDate(session.lastActive)}
                        </p>
                        {session.ipAddress && (
                          <p className="text-xs text-muted-foreground">
                            {t("settings.ip")}: {session.ipAddress}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t("settings.expires")}:{" "}
                          {formatDate(session.expiresAt)}
                        </p>
                      </div>
                      {!session.isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeSession(session.sessionId)}
                          disabled={revokeSessionMutation.isPending}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-6">
          <UserPreferencesComponent userId={typedUser?.id} />
        </TabsContent>
      </Tabs>
    </MainWrapper>
  );
}
