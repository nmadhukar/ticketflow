import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
// Removed Tabs components; we render sections conditionally by activeTab
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  TestTube,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MsTeamIntegration = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Teams Integration state
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [teamsNotificationTypes, setTeamsNotificationTypes] = useState<
    string[]
  >([]);

  const { data: teamsIntegrationSettings } = useQuery({
    queryKey: ["/api/teams-integration/settings"],
    retry: false,
  });

  useEffect(() => {
    const data: any = teamsIntegrationSettings;
    if (data) {
      setTeamsWebhookUrl(data.webhookUrl || "");
      setTeamsNotificationTypes(data.notificationTypes || []);
    }
  }, [teamsIntegrationSettings]);

  const updateTeamsIntegrationMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/teams-integration/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams-integration/settings"],
      });
      toast({
        title: "Settings Updated",
        description: "Your Teams integration settings have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  const disableTeamsIntegrationMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", "/api/teams-integration/settings");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams-integration/settings"],
      });
      setTeamsWebhookUrl("");
      setTeamsNotificationTypes([]);
      toast({
        title: "Integration Disabled",
        description: "Teams integration has been disabled.",
      });
    },
  });

  const testTeamsNotificationMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/teams-integration/test");
    },
    onSuccess: () => {
      toast({
        title: "Test Sent",
        description: "A test notification has been sent to your Teams channel.",
      });
    },
    onError: () => {
      toast({
        title: "Test Failed",
        description:
          "Failed to send test notification. Please check your settings.",
        variant: "destructive",
      });
    },
  });

  const notificationTypes = [
    { id: "ticket_created", label: "New Ticket Created" },
    { id: "ticket_updated", label: "Ticket Updated" },
    { id: "ticket_assigned", label: "Ticket Assigned to Me" },
    { id: "ticket_resolved", label: "Ticket Resolved" },
    { id: "ticket_commented", label: "New Comment Added" },
  ];

  const handleTeamsWebhookSubmit = () => {
    const currentWebhookUrl =
      teamsWebhookUrl || (teamsIntegrationSettings as any)?.webhookUrl || "";
    const currentNotificationTypes =
      teamsNotificationTypes.length > 0
        ? teamsNotificationTypes
        : (teamsIntegrationSettings as any)?.notificationTypes || [];

    if (!currentWebhookUrl || currentNotificationTypes.length === 0) {
      toast({
        title: "Missing Information",
        description:
          "Please provide a webhook URL and select at least one notification type.",
        variant: "destructive",
      });
      return;
    }

    updateTeamsIntegrationMutation.mutate({
      enabled: true,
      webhookUrl: currentWebhookUrl,
      notificationTypes: currentNotificationTypes,
    });
  };

  const settings: any = teamsIntegrationSettings;
  const isEnabled = settings?.enabled || false;
  const currentWebhookUrl = teamsWebhookUrl || settings?.webhookUrl || "";
  const currentNotificationTypes =
    teamsNotificationTypes.length > 0
      ? teamsNotificationTypes
      : settings?.notificationTypes || [];

  return (
    <div className="space-y-6">
      {isEnabled ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Teams Integration Active</AlertTitle>
          <AlertDescription>
            Notifications are being sent to your configured Teams channel.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Teams Integration Not Configured</AlertTitle>
          <AlertDescription>
            Set up Teams integration to receive ticket notifications in
            Microsoft Teams.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Microsoft Teams Integration</CardTitle>
          <CardDescription>
            Connect TicketFlow with Microsoft Teams to receive real-time
            notifications about tickets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="webhook" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="webhook">Webhook Integration</TabsTrigger>
              <TabsTrigger value="microsoft" disabled>
                Microsoft Graph (Coming Soon)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="webhook">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">Webhook URL</Label>
                  <Input
                    id="webhook-url"
                    type="url"
                    placeholder="https://outlook.office.com/webhook/..."
                    value={currentWebhookUrl}
                    onChange={(e) => setTeamsWebhookUrl(e.target.value)}
                  />
                  <p className="text-sm text-muted-foreground">
                    <a
                      href="https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Learn how to create an incoming webhook
                      <ExternalLink className="inline-block ml-1 h-3 w-3" />
                    </a>
                  </p>
                </div>

                <div className="space-y-3">
                  <Label>Notification Types</Label>
                  <div className="space-y-2">
                    {notificationTypes.map((type) => (
                      <div
                        key={type.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={type.id}
                          checked={currentNotificationTypes.includes(type.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setTeamsNotificationTypes([
                                ...currentNotificationTypes,
                                type.id,
                              ]);
                            } else {
                              setTeamsNotificationTypes(
                                currentNotificationTypes.filter(
                                  (t: string) => t !== type.id
                                )
                              );
                            }
                          }}
                        />
                        <Label
                          htmlFor={type.id}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {type.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleTeamsWebhookSubmit}
                    disabled={updateTeamsIntegrationMutation.isPending}
                  >
                    {updateTeamsIntegrationMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save Settings
                  </Button>

                  {isEnabled && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => testTeamsNotificationMutation.mutate()}
                        disabled={testTeamsNotificationMutation.isPending}
                      >
                        {testTeamsNotificationMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <TestTube className="mr-2 h-4 w-4" />
                        )}
                        Send Test
                      </Button>

                      <Button
                        variant="destructive"
                        onClick={() => disableTeamsIntegrationMutation.mutate()}
                        disabled={disableTeamsIntegrationMutation.isPending}
                      >
                        {disableTeamsIntegrationMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Disable Integration
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="microsoft">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Coming Soon</AlertTitle>
                <AlertDescription>
                  Direct Microsoft Graph integration is under development.
                  Please use webhook integration for now.
                </AlertDescription>
              </Alert>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default MsTeamIntegration;
