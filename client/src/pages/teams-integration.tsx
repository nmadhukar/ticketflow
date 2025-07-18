import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, CheckCircle2, Users, Key, TestTube, ExternalLink } from "lucide-react";

const notificationTypes = [
  { id: "ticket_created", label: "New Ticket Created" },
  { id: "ticket_updated", label: "Ticket Updated" },
  { id: "ticket_assigned", label: "Ticket Assigned to Me" },
  { id: "ticket_resolved", label: "Ticket Resolved" },
  { id: "ticket_commented", label: "New Comment Added" },
];

export default function TeamsIntegration() {
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [selectedNotificationTypes, setSelectedNotificationTypes] = useState<string[]>([]);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["/api/teams-integration/settings"],
  });

  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ["/api/teams-integration/teams"],
    enabled: false, // Only fetch when user wants to connect via Microsoft Graph
  });
  
  const { data: ssoStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/sso/status"],
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("/api/teams-integration/settings", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams-integration/settings"] });
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

  const disableIntegrationMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/teams-integration/settings", {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams-integration/settings"] });
      toast({
        title: "Integration Disabled",
        description: "Teams integration has been disabled.",
      });
    },
  });

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/teams-integration/test", {
        method: "POST",
      });
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
        description: "Failed to send test notification. Please check your settings.",
        variant: "destructive",
      });
    },
  });

  const handleWebhookSubmit = () => {
    if (!webhookUrl || selectedNotificationTypes.length === 0) {
      toast({
        title: "Missing Information",
        description: "Please provide a webhook URL and select at least one notification type.",
        variant: "destructive",
      });
      return;
    }

    updateSettingsMutation.mutate({
      enabled: true,
      webhookUrl,
      notificationTypes: selectedNotificationTypes,
    });
  };

  const handleMicrosoftAuthClick = () => {
    window.location.href = "/api/auth/microsoft";
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Microsoft Teams Integration</h1>
        <p className="text-muted-foreground mt-2">
          Connect TicketFlow with Microsoft Teams to receive real-time notifications about tickets.
        </p>
      </div>

      {settings?.enabled ? (
        <Alert className="mb-6">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Teams Integration Active</AlertTitle>
          <AlertDescription>
            Notifications are being sent to your configured Teams channel.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Teams Integration Not Configured</AlertTitle>
          <AlertDescription>
            Set up Teams integration to receive ticket notifications in Microsoft Teams.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="webhook" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="webhook">Webhook Integration</TabsTrigger>
          <TabsTrigger value="microsoft" disabled>Microsoft Graph (Coming Soon)</TabsTrigger>
        </TabsList>

        <TabsContent value="webhook">
          <Card>
            <CardHeader>
              <CardTitle>Webhook Configuration</CardTitle>
              <CardDescription>
                Use an incoming webhook to send notifications to a Teams channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Input
                  id="webhook-url"
                  type="url"
                  placeholder="https://outlook.office.com/webhook/..."
                  value={webhookUrl || settings?.webhookUrl || ""}
                  onChange={(e) => setWebhookUrl(e.target.value)}
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
                    <div key={type.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={type.id}
                        checked={
                          selectedNotificationTypes.includes(type.id) ||
                          settings?.notificationTypes?.includes(type.id)
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedNotificationTypes([...selectedNotificationTypes, type.id]);
                          } else {
                            setSelectedNotificationTypes(
                              selectedNotificationTypes.filter((t) => t !== type.id)
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
                  onClick={handleWebhookSubmit}
                  disabled={updateSettingsMutation.isPending}
                >
                  {updateSettingsMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Settings
                </Button>

                {settings?.enabled && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => testNotificationMutation.mutate()}
                      disabled={testNotificationMutation.isPending}
                    >
                      {testNotificationMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="mr-2 h-4 w-4" />
                      )}
                      Send Test
                    </Button>

                    <Button
                      variant="destructive"
                      onClick={() => disableIntegrationMutation.mutate()}
                      disabled={disableIntegrationMutation.isPending}
                    >
                      {disableIntegrationMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Disable Integration
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="microsoft">
          <Card>
            <CardHeader>
              <CardTitle>Microsoft Graph Integration</CardTitle>
              <CardDescription>
                Connect with Microsoft to access your Teams directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Coming Soon</AlertTitle>
                <AlertDescription>
                  Direct Microsoft Graph integration is under development. Please use webhook integration for now.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Microsoft 365 Single Sign-On</CardTitle>
          <CardDescription>
            Enable users to sign in with their Microsoft 365 accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            {ssoStatus?.configured ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>SSO Configured</AlertTitle>
                <AlertDescription>
                  Microsoft 365 SSO is configured and ready to use. Users can sign in with their Microsoft accounts.
                  <div className="mt-2 space-y-1">
                    <Link to="/api/auth/microsoft" className="inline-flex items-center gap-2 text-sm underline">
                      Sign in with Microsoft 365 <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </AlertDescription>
              </>
            ) : (
              <>
                <Key className="h-4 w-4" />
                <AlertTitle>Configuration Required</AlertTitle>
                <AlertDescription>
                  Microsoft 365 SSO can be configured in the Admin Panel under the SSO tab.
                  <p className="mt-2 text-sm">
                    If you're an administrator, <Link to="/admin?tab=sso" className="underline">configure SSO settings here</Link>.
                  </p>
                </AlertDescription>
              </>
            )}
          </Alert>

          <Button onClick={handleMicrosoftAuthClick} variant="outline" className="w-full">
            <Users className="mr-2 h-4 w-4" />
            Sign in with Microsoft 365
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}