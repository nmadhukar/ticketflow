import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertCircle, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function SsoSetupGuide() {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const redirectUri = `${window.location.origin}/api/auth/microsoft/callback`;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast({
      title: "Copied!",
      description: `${field} copied to clipboard`,
    });
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <Link href="/admin">
        <Button variant="ghost" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Admin
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Microsoft 365 SSO Setup Guide</CardTitle>
          <CardDescription>
            Follow these steps to configure Microsoft 365 Single Sign-On for TicketFlow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Setup Required</AlertTitle>
            <AlertDescription>
              Microsoft authentication is not working because the Azure AD application needs to be properly configured. 
              This guide will help you set it up correctly.
            </AlertDescription>
          </Alert>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-3">Step 1: Register an Application in Azure AD</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Sign in to the <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Azure Portal <ExternalLink className="inline h-3 w-3" /></a></li>
                <li>Navigate to <strong>Azure Active Directory</strong> → <strong>App registrations</strong></li>
                <li>Click <strong>New registration</strong></li>
                <li>Fill in the following:
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                    <li><strong>Name:</strong> TicketFlow SSO</li>
                    <li><strong>Supported account types:</strong> Accounts in this organizational directory only</li>
                    <li><strong>Redirect URI:</strong> Select "Web" and paste this URL:
                      <div className="flex items-center gap-2 mt-2">
                        <code className="bg-muted px-2 py-1 rounded text-xs flex-1">{redirectUri}</code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyToClipboard(redirectUri, "Redirect URI")}
                        >
                          {copiedField === "Redirect URI" ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </li>
                  </ul>
                </li>
                <li>Click <strong>Register</strong></li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Step 2: Copy Application Details</h3>
              <p className="text-sm mb-2">After registration, copy these values from the Overview page:</p>
              <ul className="list-disc list-inside space-y-2 text-sm ml-4">
                <li><strong>Application (client) ID</strong> - This is a GUID like: 31359c7f-bd7e-475c-86db-fdb8c937548e</li>
                <li><strong>Directory (tenant) ID</strong> - Another GUID in the same format</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Step 3: Create a Client Secret</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>In your app registration, go to <strong>Certificates & secrets</strong></li>
                <li>Click <strong>New client secret</strong></li>
                <li>Add a description (e.g., "TicketFlow Secret")</li>
                <li>Choose an expiration period</li>
                <li>Click <strong>Add</strong></li>
                <li><strong>Important:</strong> Copy the secret value immediately - it won't be shown again!</li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Step 4: Configure API Permissions</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Go to <strong>API permissions</strong></li>
                <li>Click <strong>Add a permission</strong></li>
                <li>Select <strong>Microsoft Graph</strong></li>
                <li>Select <strong>Delegated permissions</strong></li>
                <li>Add these permissions:
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                    <li>User.Read</li>
                    <li>email</li>
                    <li>offline_access</li>
                    <li>openid</li>
                    <li>profile</li>
                  </ul>
                </li>
                <li>Click <strong>Add permissions</strong></li>
                <li>Click <strong>Grant admin consent for [Your Organization]</strong></li>
              </ol>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-3">Step 5: Enter Configuration in TicketFlow</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Go back to the <Link href="/admin" className="text-primary hover:underline">Admin Panel</Link></li>
                <li>Find the "Microsoft 365 SSO Configuration" section</li>
                <li>Enter the values you copied:
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                    <li><strong>Client ID:</strong> The Application (client) ID from step 2</li>
                    <li><strong>Client Secret:</strong> The secret value from step 3</li>
                    <li><strong>Tenant ID:</strong> The Directory (tenant) ID from step 2</li>
                  </ul>
                </li>
                <li>Click <strong>Save Configuration</strong></li>
                <li>Restart the application for changes to take effect</li>
              </ol>
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <h4 className="font-semibold mb-2">Common Issues:</h4>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li><strong>AADSTS700016:</strong> Application not found - Check that Client ID and Tenant ID are correct</li>
                <li><strong>Invalid redirect URI:</strong> Ensure the redirect URI matches exactly (including https://)</li>
                <li><strong>Consent required:</strong> Make sure admin consent was granted in step 4</li>
                <li><strong>Wrong account type:</strong> For multi-tenant, select "Accounts in any organizational directory"</li>
              </ul>
            </div>

            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Testing Your Configuration</AlertTitle>
              <AlertDescription className="text-green-700">
                After saving the configuration and restarting, try signing in with Microsoft 365 from the login page. 
                If you encounter issues, check the console logs and refer to the common issues above.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}