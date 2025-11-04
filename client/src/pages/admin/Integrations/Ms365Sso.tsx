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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const Ms365Sso = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Microsoft SSO state
  const [ssoConfig, setSsoConfig] = useState({
    clientId: "",
    clientSecret: "",
    tenantId: "",
  });

  const { data: ssoConfigData } = useQuery({
    queryKey: ["/api/sso/config"],
    retry: false,
  });

  useEffect(() => {
    if (ssoConfigData) {
      setSsoConfig({
        clientId: (ssoConfigData as any).clientId || "",
        clientSecret: (ssoConfigData as any).clientSecret || "",
        tenantId: (ssoConfigData as any).tenantId || "",
      });
    }
  }, [ssoConfigData]);

  const saveSsoConfigMutation = useMutation({
    mutationFn: async (config: typeof ssoConfig) => {
      return await apiRequest("POST", "/api/sso/config", config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sso/config"] });
      toast({
        title: "SSO Configuration Saved",
        description:
          "Microsoft 365 SSO settings have been updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save SSO configuration",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Microsoft 365 Single Sign-On Configuration</CardTitle>
        <CardDescription>
          Configure Microsoft 365 SSO to allow users to sign in with their
          Microsoft accounts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client-id">Microsoft Client ID</Label>
            <Input
              id="client-id"
              placeholder="Enter your Microsoft App Client ID"
              value={ssoConfig.clientId}
              onChange={(e) =>
                setSsoConfig({
                  ...ssoConfig,
                  clientId: e.target.value,
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              The Application (client) ID from your Azure AD app registration
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-secret">Microsoft Client Secret</Label>
            <Input
              id="client-secret"
              type="password"
              placeholder="Enter your Microsoft App Client Secret"
              value={ssoConfig.clientSecret}
              onChange={(e) =>
                setSsoConfig({
                  ...ssoConfig,
                  clientSecret: e.target.value,
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              The client secret value from your Azure AD app registration
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenant-id">Microsoft Tenant ID</Label>
            <Input
              id="tenant-id"
              placeholder="Enter your Microsoft Tenant ID"
              value={ssoConfig.tenantId}
              onChange={(e) =>
                setSsoConfig({
                  ...ssoConfig,
                  tenantId: e.target.value,
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              Your Azure AD tenant ID (can be 'common' for multi-tenant)
            </p>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Azure AD Configuration Required</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              Add this redirect URI to your Azure AD app registration:
            </p>
            <code className="block bg-muted p-2 rounded text-xs break-all">
              {window.location.origin}/api/auth/microsoft/callback
            </code>
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <strong>Platform:</strong> Web
              </p>
              <p>
                <strong>Grant type:</strong> Authorization code
              </p>
              <p>
                <strong>Supported account types:</strong> Accounts in any
                organizational directory
              </p>
            </div>
          </AlertDescription>
        </Alert>

        <div className="border-t pt-6">
          <h3 className="text-lg font-semibold mb-4">SSO Status</h3>
          <div className="flex items-center space-x-2">
            <div
              className={`w-3 h-3 rounded-full ${
                ssoConfig.clientId &&
                ssoConfig.clientSecret &&
                ssoConfig.tenantId
                  ? "bg-green-500"
                  : "bg-red-500"
              }`}
            ></div>
            <span className="text-sm">
              {ssoConfig.clientId &&
              ssoConfig.clientSecret &&
              ssoConfig.tenantId
                ? "Microsoft 365 SSO is configured"
                : "Microsoft 365 SSO is not configured"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {ssoConfig.clientId && ssoConfig.clientSecret && ssoConfig.tenantId
              ? "Users can now sign in with their Microsoft 365 accounts"
              : "Configure the settings above to enable Microsoft 365 SSO"}
          </p>
        </div>

        <div className="flex justify-end space-x-4">
          <Button
            variant="outline"
            onClick={async () => {
              if (
                !ssoConfig.clientId ||
                !ssoConfig.clientSecret ||
                !ssoConfig.tenantId
              ) {
                toast({
                  title: "Missing Configuration",
                  description: "Please fill in all fields before testing",
                  variant: "destructive",
                });
                return;
              }

              try {
                toast({
                  title: "Testing SSO Connection",
                  description: "Checking Microsoft 365 configuration...",
                });

                const response: any = await apiRequest(
                  "POST",
                  "/api/sso/test",
                  {}
                );

                if (response.success) {
                  toast({
                    title: "Connection Test Successful",
                    description: response.message,
                  });
                } else {
                  toast({
                    title: "Connection Test Failed",
                    description:
                      response.message || "Unable to verify SSO configuration",
                    variant: "destructive",
                  });
                }
              } catch (error: any) {
                toast({
                  title: "Connection Test Failed",
                  description:
                    error.message || "Unable to verify SSO configuration",
                  variant: "destructive",
                });
              }
            }}
          >
            Test Connection
          </Button>
          <Button
            className="bg-primary hover:bg-primary/90"
            onClick={() => {
              saveSsoConfigMutation.mutate(ssoConfig);
            }}
            disabled={saveSsoConfigMutation.isPending}
          >
            {saveSsoConfigMutation.isPending
              ? "Saving..."
              : "Save Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default Ms365Sso;
