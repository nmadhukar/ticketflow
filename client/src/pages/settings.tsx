import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { User, Bell, Shield, Palette, Globe, Key, Building, Plus, Copy, Eye, EyeOff, Trash2, Mail, FileText, Send } from "lucide-react";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";

export default function Settings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [notifications, setNotifications] = useState({
    email: true,
    push: false,
    taskUpdates: true,
    teamUpdates: true,
    mentions: true,
  });

  const [preferences, setPreferences] = useState({
    theme: "light",
    language: "en",
    timezone: "UTC",
    dateFormat: "MM/DD/YYYY",
  });

  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#3b82f6");
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showApiKey, setShowApiKey] = useState<string | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<Record<number, boolean>>({});
  
  // SMTP settings state
  const [smtpSettings, setSmtpSettings] = useState({
    host: "",
    port: 587,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "TicketFlow",
    encryption: "tls",
  });
  
  // Email template state
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateData, setTemplateData] = useState<any>(null);
  
  // Test email state
  const [showTestEmailDialog, setShowTestEmailDialog] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");

  // Fetch company settings
  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
    enabled: user?.role === 'admin',
  });

  // Fetch API keys
  const { data: apiKeys } = useQuery({
    queryKey: ["/api/api-keys"],
  });
  
  // Fetch SMTP settings
  const { data: fetchedSmtpSettings } = useQuery({
    queryKey: ["/api/smtp/settings"],
    enabled: user?.role === 'admin',
  });
  
  // Fetch email templates
  const { data: emailTemplates } = useQuery({
    queryKey: ["/api/email/templates"],
    enabled: user?.role === 'admin',
  });

  useEffect(() => {
    if (companySettings) {
      setCompanyName(companySettings.companyName || "TicketFlow");
      setLogoUrl(companySettings.logoUrl || "");
      setPrimaryColor(companySettings.primaryColor || "#3b82f6");
    }
  }, [companySettings]);
  
  useEffect(() => {
    if (fetchedSmtpSettings) {
      setSmtpSettings({
        host: fetchedSmtpSettings.host || "",
        port: fetchedSmtpSettings.port || 587,
        username: fetchedSmtpSettings.username || "",
        password: fetchedSmtpSettings.password || "",
        fromEmail: fetchedSmtpSettings.fromEmail || "",
        fromName: fetchedSmtpSettings.fromName || "TicketFlow",
        encryption: fetchedSmtpSettings.encryption || "tls",
      });
    }
  }, [fetchedSmtpSettings]);

  // Update company settings mutation
  const updateCompanySettingsMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("PATCH", "/api/company-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({
        title: "Success",
        description: "Company settings updated successfully",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update company settings",
        variant: "destructive",
      });
    },
  });

  // Create API key mutation
  const createApiKeyMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/api-keys", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setShowApiKey(data.plainKey);
      setNewApiKeyName("");
      toast({
        title: "Success",
        description: "API key created successfully. Copy it now - it won't be shown again!",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to create API key",
        variant: "destructive",
      });
    },
  });

  // Delete API key mutation
  const deleteApiKeyMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({
        title: "Success",
        description: "API key revoked successfully",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to revoke API key",
        variant: "destructive",
      });
    },
  });

  const handleUpdateCompanySettings = () => {
    updateCompanySettingsMutation.mutate({
      companyName,
      logoUrl: logoUrl || null,
      primaryColor,
    });
  };

  const handleCreateApiKey = () => {
    if (!newApiKeyName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the API key",
        variant: "destructive",
      });
      return;
    }
    createApiKeyMutation.mutate({ name: newApiKeyName.trim() });
  };
  
  // SMTP settings mutation
  const updateSmtpSettingsMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/smtp/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/smtp/settings"] });
      toast({
        title: "Success",
        description: "SMTP settings updated successfully",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update SMTP settings",
        variant: "destructive",
      });
    },
  });
  
  // Email template mutation
  const updateEmailTemplateMutation = useMutation({
    mutationFn: async ({ name, template }: { name: string; template: any }) => {
      return await apiRequest("PUT", `/api/email/templates/${name}`, template);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email/templates"] });
      toast({
        title: "Success",
        description: "Email template updated successfully",
      });
      setSelectedTemplate("");
      setTemplateData(null);
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to update email template",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "API key copied to clipboard",
    });
  };
  
  // Test email mutation
  const testEmailMutation = useMutation({
    mutationFn: async (testEmail: string) => {
      return await apiRequest("POST", "/api/smtp/test", { testEmail });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Test email sent successfully! Check your inbox.",
      });
      setShowTestEmailDialog(false);
      setTestEmailAddress("");
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to send test email. Please check your SMTP settings.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className={`grid w-full ${user?.role === 'admin' ? 'grid-cols-6' : 'grid-cols-5'}`}>
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="preferences" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Preferences
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Security
            </TabsTrigger>
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Key className="h-4 w-4" />
              API Keys
            </TabsTrigger>
            {user?.role === 'admin' && (
              <TabsTrigger value="company" className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                Company
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>
                  Your profile information is managed through your Replit account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  {user?.profileImageUrl ? (
                    <img
                      src={user.profileImageUrl}
                      alt={user.firstName || "User"}
                      className="h-16 w-16 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                      <User className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold">
                      {user?.firstName} {user?.lastName}
                    </h3>
                    <p className="text-muted-foreground">{user?.email}</p>
                    <Badge variant="secondary" className="mt-1">
                      {user?.role}
                    </Badge>
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      value={user?.firstName || ""}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      value={user?.lastName || ""}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      value={user?.email || ""}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Input
                      id="department"
                      value={user?.department || "Not set"}
                      disabled
                      className="bg-muted"
                    />
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  <p>
                    Profile information is managed through your Replit account.
                    To update these details, please contact your system administrator.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>
                  Configure how you want to receive notifications
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="email-notifications">Email Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive notifications via email
                      </p>
                    </div>
                    <Switch
                      id="email-notifications"
                      checked={notifications.email}
                      onCheckedChange={(checked) =>
                        setNotifications(prev => ({ ...prev, email: checked }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="push-notifications">Push Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive push notifications in your browser
                      </p>
                    </div>
                    <Switch
                      id="push-notifications"
                      checked={notifications.push}
                      onCheckedChange={(checked) =>
                        setNotifications(prev => ({ ...prev, push: checked }))
                      }
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="task-updates">Task Updates</Label>
                      <p className="text-sm text-muted-foreground">
                        Notifications when tasks assigned to you are updated
                      </p>
                    </div>
                    <Switch
                      id="task-updates"
                      checked={notifications.taskUpdates}
                      onCheckedChange={(checked) =>
                        setNotifications(prev => ({ ...prev, taskUpdates: checked }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="team-updates">Team Updates</Label>
                      <p className="text-sm text-muted-foreground">
                        Notifications about team activities and updates
                      </p>
                    </div>
                    <Switch
                      id="team-updates"
                      checked={notifications.teamUpdates}
                      onCheckedChange={(checked) =>
                        setNotifications(prev => ({ ...prev, teamUpdates: checked }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="mentions">Mentions</Label>
                      <p className="text-sm text-muted-foreground">
                        Notifications when you're mentioned in comments
                      </p>
                    </div>
                    <Switch
                      id="mentions"
                      checked={notifications.mentions}
                      onCheckedChange={(checked) =>
                        setNotifications(prev => ({ ...prev, mentions: checked }))
                      }
                    />
                  </div>
                </div>

                <Button>Save Notification Settings</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Application Preferences</CardTitle>
                <CardDescription>
                  Customize your application experience
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="theme">Theme</Label>
                    <Select
                      value={preferences.theme}
                      onValueChange={(value) =>
                        setPreferences(prev => ({ ...prev, theme: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                        <SelectItem value="system">System</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="language">Language</Label>
                    <Select
                      value={preferences.language}
                      onValueChange={(value) =>
                        setPreferences(prev => ({ ...prev, language: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Español</SelectItem>
                        <SelectItem value="fr">Français</SelectItem>
                        <SelectItem value="de">Deutsch</SelectItem>
                        <SelectItem value="zh">中文</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timezone">Timezone</Label>
                    <Select
                      value={preferences.timezone}
                      onValueChange={(value) =>
                        setPreferences(prev => ({ ...prev, timezone: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="EST">Eastern Time</SelectItem>
                        <SelectItem value="PST">Pacific Time</SelectItem>
                        <SelectItem value="CET">Central European Time</SelectItem>
                        <SelectItem value="JST">Japan Standard Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="dateFormat">Date Format</Label>
                    <Select
                      value={preferences.dateFormat}
                      onValueChange={(value) =>
                        setPreferences(prev => ({ ...prev, dateFormat: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                        <SelectItem value="DD MMM YYYY">DD MMM YYYY</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button>Save Preferences</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="security" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>
                  Manage your account security and access
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium">Authentication</h4>
                    <p className="text-sm text-muted-foreground">
                      Your account is secured through {user?.password ? 'email/password authentication' : 'Microsoft SSO'}
                    </p>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="text-sm font-medium">Active Sessions</h4>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <p className="text-sm font-medium">Current Session</p>
                          <p className="text-xs text-muted-foreground">
                            Last active: {new Date().toLocaleDateString()}
                          </p>
                        </div>
                        <Badge variant="secondary">Active</Badge>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h4 className="text-sm font-medium">Account Status</h4>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="default">
                        Active
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {user?.createdAt ? 
                          `Account created: ${new Date(user.createdAt).toLocaleDateString()}` :
                          `Authenticated via ${user?.email ? 'Email/Password' : 'Microsoft SSO'}`
                        }
                      </span>
                    </div>
                  </div>
                </div>

                <Button variant="outline" onClick={() => window.location.href = "/api/logout"}>
                  Sign Out of All Sessions
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>API Keys</CardTitle>
                <CardDescription>
                  Manage API keys for third-party integrations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Create New API Key */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Create New API Key</h4>
                  <div className="flex gap-2">
                    <Input
                      placeholder="API Key Name (e.g., Mobile App, CI/CD Pipeline)"
                      value={newApiKeyName}
                      onChange={(e) => setNewApiKeyName(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleCreateApiKey()}
                    />
                    <Button
                      onClick={handleCreateApiKey}
                      disabled={createApiKeyMutation.isPending}
                    >
                      {createApiKeyMutation.isPending ? "Creating..." : "Create Key"}
                    </Button>
                  </div>
                </div>

                {/* Show newly created API key */}
                {showApiKey && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h4 className="text-sm font-medium text-green-900 mb-2">
                      API Key Created Successfully
                    </h4>
                    <p className="text-xs text-green-700 mb-3">
                      Copy this key now. For security reasons, it won't be shown again.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-2 bg-white border rounded text-sm font-mono">
                        {showApiKey}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          copyToClipboard(showApiKey);
                          setShowApiKey(null);
                        }}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Copy & Close
                      </Button>
                    </div>
                  </div>
                )}

                <Separator />

                {/* Existing API Keys */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Active API Keys</h4>
                  {apiKeys && apiKeys.length > 0 ? (
                    <div className="space-y-2">
                      {apiKeys.map((apiKey: any) => (
                        <div
                          key={apiKey.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex-1">
                            <p className="font-medium">{apiKey.name}</p>
                            <div className="flex items-center gap-4 mt-1">
                              <p className="text-xs text-muted-foreground">
                                Created: {new Date(apiKey.createdAt).toLocaleDateString()}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Last used: {apiKey.lastUsed ? new Date(apiKey.lastUsed).toLocaleDateString() : 'Never'}
                              </p>
                              {apiKey.expiresAt && (
                                <p className="text-xs text-muted-foreground">
                                  Expires: {new Date(apiKey.expiresAt).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                              {apiKey.key.substring(0, 8)}...
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const visibility = { ...apiKeyVisibility };
                                visibility[apiKey.id] = !visibility[apiKey.id];
                                setApiKeyVisibility(visibility);
                              }}
                            >
                              {apiKeyVisibility[apiKey.id] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteApiKeyMutation.mutate(apiKey.id)}
                              disabled={deleteApiKeyMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No API keys yet. Create one to get started!</p>
                    </div>
                  )}
                </div>

                <Separator />

                {/* API Documentation Link */}
                <div className="rounded-lg bg-muted p-4">
                  <h4 className="text-sm font-medium mb-2">API Documentation</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Learn how to integrate with TicketFlow using our REST API.
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <a href="/api-docs" target="_blank">
                      View API Documentation
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {user?.role === 'admin' && (
            <TabsContent value="company" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Company Branding</CardTitle>
                  <CardDescription>
                    Customize your company's branding across the platform
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Company Name */}
                    <div className="space-y-2">
                      <Label htmlFor="companyName">Company Name</Label>
                      <Input
                        id="companyName"
                        placeholder="Your Company Name"
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        This will appear in the navigation and emails
                      </p>
                    </div>

                    {/* Logo URL */}
                    <div className="space-y-2">
                      <Label htmlFor="logoUrl">Logo URL</Label>
                      <Input
                        id="logoUrl"
                        placeholder="https://example.com/logo.png"
                        value={logoUrl}
                        onChange={(e) => setLogoUrl(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Provide a URL to your company logo
                      </p>
                    </div>

                    {/* Primary Color */}
                    <div className="space-y-2">
                      <Label htmlFor="primaryColor">Primary Color</Label>
                      <div className="flex gap-2">
                        <Input
                          id="primaryColor"
                          type="color"
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          className="w-20 h-10 p-1 cursor-pointer"
                        />
                        <Input
                          value={primaryColor}
                          onChange={(e) => setPrimaryColor(e.target.value)}
                          placeholder="#3b82f6"
                          className="flex-1"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Used for buttons and accent elements
                      </p>
                    </div>
                  </div>

                  {/* Preview */}
                  <Separator />
                  
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium">Preview</h4>
                    <div className="border rounded-lg p-4 bg-muted/50">
                      <div className="flex items-center gap-3 mb-4">
                        {logoUrl ? (
                          <img 
                            src={logoUrl} 
                            alt={companyName}
                            className="h-8 w-auto object-contain"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div 
                            className="h-8 w-8 rounded flex items-center justify-center text-white font-bold"
                            style={{ backgroundColor: primaryColor }}
                          >
                            {companyName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="font-semibold text-lg">{companyName || "Your Company"}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm"
                          style={{ backgroundColor: primaryColor, borderColor: primaryColor }}
                          className="text-white hover:opacity-90"
                        >
                          Primary Button
                        </Button>
                        <Button 
                          size="sm"
                          variant="outline"
                          style={{ borderColor: primaryColor, color: primaryColor }}
                        >
                          Secondary Button
                        </Button>
                      </div>
                    </div>
                  </div>

                  <Button 
                    onClick={handleUpdateCompanySettings}
                    disabled={updateCompanySettingsMutation.isPending}
                    className="w-full md:w-auto"
                  >
                    {updateCompanySettingsMutation.isPending ? "Saving..." : "Save Branding"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}


        </Tabs>
      
        <Dialog open={showTestEmailDialog} onOpenChange={setShowTestEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Enter an email address to send a test email and verify your SMTP settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="testEmail">Email Address</Label>
              <Input
                id="testEmail"
                type="email"
                placeholder="test@example.com"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowTestEmailDialog(false);
                setTestEmailAddress("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => testEmailMutation.mutate(testEmailAddress)}
              disabled={!testEmailAddress || testEmailMutation.isPending}
            >
              {testEmailMutation.isPending ? "Sending..." : "Send Test Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}