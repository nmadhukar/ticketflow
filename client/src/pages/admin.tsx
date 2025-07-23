import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Shield, Users, Settings, BarChart3, UserCog, Ban, CheckCircle, Home, Palette, Upload, BookOpen, FileText, Trash2, Edit, Search, Building, UserPlus, AlertCircle, Mail, FileEdit, Key, Eye, EyeOff, Copy } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useLocation, Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import HelpDocumentManager from "@/components/HelpDocumentManager";
import { Separator } from "@/components/ui/separator";

export default function AdminPanel() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userStatusFilter, setUserStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [emailSettings, setEmailSettings] = useState<any>({
    awsAccessKeyId: "",
    awsSecretAccessKey: "",
    awsRegion: "us-east-1",
    fromEmail: "",
    fromName: "TicketFlow",
  });
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [isEditTemplateOpen, setIsEditTemplateOpen] = useState(false);
  
  // Microsoft SSO state
  const [ssoConfig, setSsoConfig] = useState({
    clientId: "",
    clientSecret: "",
    tenantId: "",
  });
  
  // API Keys state
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showApiKey, setShowApiKey] = useState<string | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<Record<number, boolean>>({});

  // Check if user is admin
  if (user?.role !== "admin") {
    setLocation("/");
    return null;
  }

  const { data: users } = useQuery({
    queryKey: ["/api/admin/users"],
    retry: false,
  });

  const { data: systemStats } = useQuery({
    queryKey: ["/api/admin/stats"],
    retry: false,
  });

  const { data: teams } = useQuery({
    queryKey: ["/api/teams"],
    retry: false,
  });

  const { data: departments } = useQuery({
    queryKey: ["/api/admin/departments"],
    retry: false,
  });

  const { data: apiKeys } = useQuery({
    queryKey: ["/api/api-keys"],
  });

  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
    retry: false,
  });
  
  const { data: emailTemplates } = useQuery({
    queryKey: ["/api/email-templates"],
    retry: false,
  });

  const { data: ssoConfigData } = useQuery({
    queryKey: ["/api/sso/config"],
    retry: false,
    onSuccess: (data) => {
      if (data) {
        setSsoConfig({
          clientId: data.clientId || "",
          clientSecret: data.clientSecret || "",
          tenantId: data.tenantId || "",
        });
      }
    },
  });
  
  const { data: smtpSettingsData } = useQuery({
    queryKey: ["/api/smtp/settings"],
    retry: false,
    onSuccess: (data) => {
      if (data) {
        setEmailSettings({
          awsAccessKeyId: data.awsAccessKeyId || "",
          awsSecretAccessKey: data.awsSecretAccessKey || "",
          awsRegion: data.awsRegion || "us-east-1",
          fromEmail: data.fromEmail || "",
          fromName: data.fromName || "TicketFlow",
        });
      }
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async (userData: any) => {
      return await apiRequest("PATCH", `/api/admin/users/${userData.id}`, userData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setIsEditUserOpen(false);
      toast({
        title: "Success",
        description: "User updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update user",
        variant: "destructive",
      });
    },
  });

  const toggleUserStatusMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/users/${userId}/toggle-status`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User status updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user status",
        variant: "destructive",
      });
    },
  });

  const approveUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/users/${userId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Success",
        description: "User approved successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve user",
        variant: "destructive",
      });
    },
  });

  const updateEmailTemplateMutation = useMutation({
    mutationFn: async (data: { name: string; subject: string; body: string }) => {
      return await apiRequest("PUT", `/api/email-templates/${data.name}`, {
        subject: data.subject,
        body: data.body,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Success",
        description: "Email template updated successfully",
      });
      setIsEditTemplateOpen(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update email template",
        variant: "destructive",
      });
    },
  });

  const assignTeamMutation = useMutation({
    mutationFn: async ({ userId, teamId, role }: { userId: string; teamId: number; role: string }) => {
      return await apiRequest("POST", `/api/admin/users/${userId}/assign-team`, { teamId, role });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams", variables.teamId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams", variables.teamId] });
      toast({
        title: "Success",
        description: "User assigned to team",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/users/${userId}/reset-password`);
    },
    onSuccess: (data) => {
      toast({
        title: "Password Reset",
        description: `Temporary password: ${data.tempPassword}`,
      });
    },
  });

  const handleEditUser = (user: any) => {
    setSelectedUser(user);
    setIsEditUserOpen(true);
  };

  const handleUpdateUser = () => {
    if (selectedUser) {
      updateUserMutation.mutate(selectedUser);
    }
  };

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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update company settings",
        variant: "destructive",
      });
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/company-settings/logo", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-settings"] });
      toast({
        title: "Success",
        description: "Logo uploaded successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to upload logo",
        variant: "destructive",
      });
    },
  });

  const saveSsoConfigMutation = useMutation({
    mutationFn: async (config: typeof ssoConfig) => {
      return await apiRequest("POST", "/api/sso/config", config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sso/config"] });
      toast({
        title: "SSO Configuration Saved",
        description: "Microsoft 365 SSO settings have been updated successfully",
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
  
  const saveEmailSettingsMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/smtp/settings", emailSettings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/smtp/settings"] });
      toast({
        title: "Success",
        description: "Email configuration saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save email configuration",
        variant: "destructive",
      });
    },
  });
  
  const testEmailMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/smtp/test", { testEmail: testEmailAddress });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Test email sent successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send test email",
        variant: "destructive",
      });
    },
  });

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      toast({
        title: "Error",
        description: "Please upload a JPG or PNG image",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result?.toString().split(',')[1];
      uploadLogoMutation.mutate({
        fileName: file.name,
        fileType: file.type,
        fileData: base64String,
      });
    };
    reader.readAsDataURL(file);
  };
  
  // API Key mutations
  const createApiKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", "/api/api-keys", { name });
    },
    onSuccess: (data) => {
      setShowApiKey(data.key);
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setNewApiKeyName("");
      toast({
        title: "Success",
        description: "API key created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create API key",
        variant: "destructive",
      });
    },
  });

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
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to revoke API key",
        variant: "destructive",
      });
    },
  });

  const handleCreateApiKey = () => {
    if (!newApiKeyName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the API key",
        variant: "destructive",
      });
      return;
    }
    createApiKeyMutation.mutate(newApiKeyName);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Success",
      description: "Copied to clipboard",
    });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Shield className="h-8 w-8 text-primary" />
            Admin Panel
          </h1>
          <p className="text-muted-foreground">Manage users, teams, and system settings</p>
        </div>
        <Link href="/">
          <Button variant="outline" className="flex items-center gap-2">
            <Home className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      {/* System Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card className="hover:shadow-business transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats?.totalUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              {systemStats?.activeUsers || 0} active
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-business transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Teams</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-secondary/10 flex items-center justify-center">
              <UserCog className="h-4 w-4 text-secondary-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats?.totalTeams || 0}</div>
            <p className="text-xs text-muted-foreground">
              Across all departments
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-business transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Tickets</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-accent-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats?.openTickets || 0}</div>
            <p className="text-xs text-muted-foreground">
              {systemStats?.urgentTickets || 0} high priority
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-business transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-muted/10 flex items-center justify-center">
              <Settings className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats?.avgResolutionTime || "N/A"}</div>
            <p className="text-xs text-muted-foreground">
              hours
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users">User Management</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="teams">Team Management</TabsTrigger>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="settings">System Settings</TabsTrigger>
          <TabsTrigger value="branding">Company Branding</TabsTrigger>
          <TabsTrigger value="help">Help Documentation</TabsTrigger>
          <TabsTrigger value="sso">Microsoft 365 SSO</TabsTrigger>
          <TabsTrigger value="email">Email Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <CardTitle>User Management</CardTitle>
                  <CardDescription>
                    Manage user accounts, roles, and permissions
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  <Select
                    value={userStatusFilter}
                    onValueChange={(value: "all" | "active" | "inactive") => setUserStatusFilter(value)}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      <SelectItem value="active">Active Users</SelectItem>
                      <SelectItem value="inactive">Inactive Users</SelectItem>
                    </SelectContent>
                  </Select>
                  <Link to="/admin/invitations">
                    <Button>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Invite User
                    </Button>
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users?.filter((user: any) => {
                    if (userStatusFilter === "all") return true;
                    if (userStatusFilter === "active") return user.isActive;
                    if (userStatusFilter === "inactive") return !user.isActive;
                    return true;
                  }).map((user: any) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        {user.firstName} {user.lastName}
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant={
                          user.role === "admin" ? "destructive" : 
                          user.role === "customer" ? "secondary" : 
                          "default"
                        }>
                          {user.role === "customer" ? "Customer" : `System ${user.role}`}
                        </Badge>
                      </TableCell>
                      <TableCell>{user.department || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? "default" : "secondary"}>
                          {user.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.role === "customer" && (
                          <Badge variant={user.isApproved ? "success" : "warning"}>
                            {user.isApproved ? "Approved" : "Pending"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditUser(user)}
                          >
                            Edit
                          </Button>
                          <Select
                            onValueChange={(teamId) => {
                              if (teamId && teamId !== "none") {
                                assignTeamMutation.mutate({
                                  userId: user.id,
                                  teamId: parseInt(teamId),
                                  role: "member"
                                });
                              }
                            }}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue placeholder="Assign Team" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No Team</SelectItem>
                              {teams?.map((team: any) => (
                                <SelectItem key={team.id} value={team.id.toString()}>
                                  {team.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => toggleUserStatusMutation.mutate(user.id)}
                                  disabled={toggleUserStatusMutation.isPending}
                                >
                                  {user.isActive ? <Ban className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {user.isActive ? "Deactivate user" : "Activate user"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {user.role === "customer" && !user.isApproved && (
                            <Button
                              size="sm"
                              variant="success"
                              onClick={() => approveUserMutation.mutate(user.id)}
                            >
                              Approve
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>User Invitations</CardTitle>
                  <CardDescription>
                    View and manage user invitations
                  </CardDescription>
                </div>
                <Link to="/admin/invitations">
                  <Button>
                    <Mail className="h-4 w-4 mr-2" />
                    Manage Invitations
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Click "Manage Invitations" to view all sent invitations, their status, and send new invitations.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Team Management</CardTitle>
              <CardDescription>
                View and manage teams across the organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teams?.map((team: any) => (
                    <TableRow key={team.id}>
                      <TableCell className="font-medium">{team.name}</TableCell>
                      <TableCell>{team.description}</TableCell>
                      <TableCell>{team.memberCount || 0} members</TableCell>
                      <TableCell>{team.createdBy}</TableCell>
                      <TableCell>
                        <Link href={`/teams/${team.id}`}>
                          <Button size="sm" variant="outline">
                            Manage
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                      <Copy className="h-4 w-4" />
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

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Settings</CardTitle>
              <CardDescription>
                Configure system-wide settings and preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Ticket Number Prefix</Label>
                <Input 
                  value={companySettings?.ticketPrefix || "TKT"} 
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
                    setCompanySettings({ ...companySettings, ticketPrefix: value });
                  }}
                  placeholder="TKT"
                  maxLength={10}
                />
                <p className="text-sm text-muted-foreground">
                  Prefix used for generating ticket numbers (max 10 characters, letters and numbers only)
                </p>
              </div>
              <div className="space-y-2">
                <Label>Default Ticket Priority</Label>
                <Select defaultValue="medium">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Auto-close Resolved Tickets After</Label>
                <Input type="number" defaultValue="7" />
                <p className="text-sm text-muted-foreground">
                  Days after which resolved tickets are automatically closed
                </p>
              </div>
              <Button 
                className="mt-4" 
                onClick={() => updateCompanySettingsMutation.mutate({ 
                  ...companySettings,
                  ticketPrefix: companySettings?.ticketPrefix || "TKT" 
                })}
                disabled={updateCompanySettingsMutation.isPending}
              >
                {updateCompanySettingsMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Company Branding</CardTitle>
              <CardDescription>
                Manage your company logo and branding settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Company Name</Label>
                  <Input 
                    value={companySettings?.companyName || ""}
                    onChange={(e) => updateCompanySettingsMutation.mutate({ companyName: e.target.value })}
                  />
                </div>
                
                <div className="space-y-4">
                  <Label>Company Logo</Label>
                  <div className="flex items-center gap-4">
                    {companySettings?.logoUrl ? (
                      <div className="relative w-48 h-24 border rounded-lg overflow-hidden bg-gray-50">
                        <img 
                          src={companySettings.logoUrl} 
                          alt="Company Logo" 
                          className="w-full h-full object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-48 h-24 border-2 border-dashed rounded-lg flex items-center justify-center bg-gray-50">
                        <Palette className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <Button 
                        variant="outline" 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadLogoMutation.isPending}
                        className="flex items-center gap-2"
                      >
                        <Upload className="h-4 w-4" />
                        Upload Logo
                      </Button>
                      <p className="text-sm text-muted-foreground">
                        JPG or PNG, max 5MB
                      </p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Logo Usage</Label>
                  <p className="text-sm text-muted-foreground">
                    Your logo will appear in the navigation bar and on customer-facing documents.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="help" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Help Documentation
              </CardTitle>
              <CardDescription>
                Upload and manage Word documents that users can reference before creating tickets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <HelpDocumentManager />
                
                <div className="border-t pt-6">
                  <h3 className="text-lg font-semibold mb-4">Admin Tools</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-2">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Building className="h-4 w-4" />
                          Department Management
                        </CardTitle>
                        <CardDescription className="text-sm">
                          Create and manage organizational departments
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Link to="/admin/departments">
                          <Button variant="outline" className="w-full">
                            Manage Departments
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                    
                    <Card className="border-2">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <UserPlus className="h-4 w-4" />
                          User Invitations
                        </CardTitle>
                        <CardDescription className="text-sm">
                          Invite new users to join your organization
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Link to="/admin/invitations">
                          <Button variant="outline" className="w-full">
                            Manage Invitations
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                    
                    <Card className="border-2">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <BookOpen className="h-4 w-4" />
                          User Guide Management
                        </CardTitle>
                        <CardDescription className="text-sm">
                          Create and organize user guides and tutorials
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Link to="/admin/guides">
                          <Button variant="outline" className="w-full">
                            Manage User Guides
                          </Button>
                        </Link>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sso" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Microsoft 365 Single Sign-On Configuration</CardTitle>
              <CardDescription>
                Configure Microsoft 365 SSO to allow users to sign in with their Microsoft accounts
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
                    onChange={(e) => setSsoConfig({ ...ssoConfig, clientId: e.target.value })}
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
                    onChange={(e) => setSsoConfig({ ...ssoConfig, clientSecret: e.target.value })}
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
                    onChange={(e) => setSsoConfig({ ...ssoConfig, tenantId: e.target.value })}
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
                  <p className="mb-2">Add this redirect URI to your Azure AD app registration:</p>
                  <code className="block bg-muted p-2 rounded text-xs break-all">
                    {window.location.origin}/api/auth/microsoft/callback
                  </code>
                  <div className="mt-3 space-y-1 text-sm">
                    <p><strong>Platform:</strong> Web</p>
                    <p><strong>Grant type:</strong> Authorization code</p>
                    <p><strong>Supported account types:</strong> Accounts in any organizational directory</p>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="border-t pt-6">
                <h3 className="text-lg font-semibold mb-4">SSO Status</h3>
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded-full ${
                    ssoConfig.clientId && ssoConfig.clientSecret && ssoConfig.tenantId 
                      ? 'bg-green-500' 
                      : 'bg-red-500'
                  }`}></div>
                  <span className="text-sm">
                    {ssoConfig.clientId && ssoConfig.clientSecret && ssoConfig.tenantId 
                      ? 'Microsoft 365 SSO is configured' 
                      : 'Microsoft 365 SSO is not configured'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {ssoConfig.clientId && ssoConfig.clientSecret && ssoConfig.tenantId 
                    ? 'Users can now sign in with their Microsoft 365 accounts' 
                    : 'Configure the settings above to enable Microsoft 365 SSO'}
                </p>
              </div>

              <div className="flex justify-end space-x-4">
                <Button 
                  variant="outline"
                  onClick={async () => {
                    if (!ssoConfig.clientId || !ssoConfig.clientSecret || !ssoConfig.tenantId) {
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
                      
                      const response = await apiRequest("POST", "/api/sso/test", {});
                      
                      if (response.success) {
                        toast({
                          title: "Connection Test Successful",
                          description: response.message,
                        });
                      } else {
                        toast({
                          title: "Connection Test Failed",
                          description: response.message || "Unable to verify SSO configuration",
                          variant: "destructive",
                        });
                      }
                    } catch (error: any) {
                      toast({
                        title: "Connection Test Failed",
                        description: error.message || "Unable to verify SSO configuration",
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
                  {saveSsoConfigMutation.isPending ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Email Configuration</CardTitle>
              <CardDescription>
                Configure AWS SES for sending system emails (invitations, notifications, etc.)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert className="border-blue-200 bg-blue-50">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertTitle className="text-blue-800">AWS SES Configuration</AlertTitle>
                <AlertDescription className="text-blue-700">
                  <p className="mb-2">TicketFlow uses Amazon Simple Email Service (SES) for reliable email delivery.</p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Create an AWS account and enable SES in your preferred region</li>
                    <li>Verify your sender email address in SES</li>
                    <li>In sandbox mode, verify all recipient email addresses</li>
                    <li>Request production access to send to any email address</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="aws-access-key">AWS Access Key ID</Label>
                  <Input
                    id="aws-access-key"
                    placeholder="Enter your AWS Access Key ID"
                    value={emailSettings?.awsAccessKeyId || ""}
                    onChange={(e) => setEmailSettings({ ...emailSettings, awsAccessKeyId: e.target.value })}
                  />
                  <p className="text-sm text-muted-foreground">
                    Your AWS IAM user access key with SES permissions
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="aws-secret-key">AWS Secret Access Key</Label>
                  <Input
                    id="aws-secret-key"
                    type="password"
                    placeholder="Enter your AWS Secret Access Key"
                    value={emailSettings?.awsSecretAccessKey || ""}
                    onChange={(e) => setEmailSettings({ ...emailSettings, awsSecretAccessKey: e.target.value })}
                  />
                  <p className="text-sm text-muted-foreground">
                    Your AWS IAM user secret key (keep this secure)
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="aws-region">AWS Region</Label>
                  <Select
                    value={emailSettings?.awsRegion || "us-east-1"}
                    onValueChange={(value) => setEmailSettings({ ...emailSettings, awsRegion: value })}
                  >
                    <SelectTrigger id="aws-region">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                      <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                      <SelectItem value="eu-west-1">EU (Ireland)</SelectItem>
                      <SelectItem value="eu-central-1">EU (Frankfurt)</SelectItem>
                      <SelectItem value="ap-southeast-1">Asia Pacific (Singapore)</SelectItem>
                      <SelectItem value="ap-southeast-2">Asia Pacific (Sydney)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    The AWS region where SES is configured
                  </p>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-lg font-semibold mb-4">Sender Configuration</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="from-email">From Email Address</Label>
                      <Input
                        id="from-email"
                        type="email"
                        placeholder="noreply@yourcompany.com"
                        value={emailSettings?.fromEmail || ""}
                        onChange={(e) => setEmailSettings({ ...emailSettings, fromEmail: e.target.value })}
                      />
                      <p className="text-sm text-muted-foreground">
                        This email must be verified in AWS SES
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="from-name">From Name</Label>
                      <Input
                        id="from-name"
                        placeholder="TicketFlow System"
                        value={emailSettings?.fromName || "TicketFlow"}
                        onChange={(e) => setEmailSettings({ ...emailSettings, fromName: e.target.value })}
                      />
                      <p className="text-sm text-muted-foreground">
                        The display name for system emails
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-lg font-semibold mb-4">Email Test</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="test-email">Test Email Address</Label>
                      <Input
                        id="test-email"
                        type="email"
                        placeholder="test@example.com"
                        value={testEmailAddress}
                        onChange={(e) => setTestEmailAddress(e.target.value)}
                      />
                      <p className="text-sm text-muted-foreground">
                        Send a test email to verify configuration
                      </p>
                    </div>
                    
                    <Button
                      variant="outline"
                      onClick={() => testEmailMutation.mutate()}
                      disabled={!testEmailAddress || testEmailMutation.isPending}
                    >
                      {testEmailMutation.isPending ? "Sending..." : "Send Test Email"}
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-lg font-semibold mb-4">Email Templates</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Customize email templates for different system notifications
                  </p>
                  <div className="space-y-4">
                    <Select
                      value={selectedTemplate?.name || ""}
                      onValueChange={(value) => {
                        const template = emailTemplates?.find((t: any) => t.name === value);
                        setSelectedTemplate(template);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a template to edit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user_invitation">User Invitation</SelectItem>
                        <SelectItem value="password_reset">Password Reset</SelectItem>
                        <SelectItem value="ticket_created">Ticket Created</SelectItem>
                        <SelectItem value="ticket_updated">Ticket Updated</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {selectedTemplate && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setIsEditTemplateOpen(true);
                          }}
                        >
                          <FileEdit className="h-4 w-4 mr-2" />
                          Edit Template
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-4 pt-4">
                <Button 
                  className="bg-primary hover:bg-primary/90"
                  onClick={() => saveEmailSettingsMutation.mutate()}
                  disabled={saveEmailSettingsMutation.isPending}
                >
                  {saveEmailSettingsMutation.isPending ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Email Template Dialog */}
      <Dialog open={isEditTemplateOpen} onOpenChange={setIsEditTemplateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Email Template</DialogTitle>
            <DialogDescription>
              Customize the email template that will be sent to users
            </DialogDescription>
          </DialogHeader>
          {selectedTemplate && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input value={selectedTemplate.name} disabled />
              </div>
              
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={selectedTemplate.subject || ""}
                  onChange={(e) => setSelectedTemplate({ ...selectedTemplate, subject: e.target.value })}
                  placeholder="Email subject line"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Template Body (HTML)</Label>
                <Textarea
                  value={selectedTemplate.body || ""}
                  onChange={(e) => setSelectedTemplate({ ...selectedTemplate, body: e.target.value })}
                  placeholder="Email template HTML content"
                  className="font-mono text-sm h-96"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Available Variables</Label>
                <div className="bg-muted p-3 rounded-md">
                  <p className="text-sm font-medium mb-2">You can use these variables in your template:</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplate.variables?.map((variable: string) => (
                      <code key={variable} className="bg-background px-2 py-1 rounded text-xs">
                        {`{{${variable}}}`}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditTemplateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    updateEmailTemplateMutation.mutate({
                      name: selectedTemplate.name,
                      subject: selectedTemplate.subject,
                      body: selectedTemplate.body,
                    });
                  }}
                  disabled={updateEmailTemplateMutation.isPending}
                >
                  {updateEmailTemplateMutation.isPending ? "Saving..." : "Save Template"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update user information and permissions
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name</Label>
                  <Input
                    value={selectedUser.firstName || ""}
                    onChange={(e) => setSelectedUser({ ...selectedUser, firstName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input
                    value={selectedUser.lastName || ""}
                    onChange={(e) => setSelectedUser({ ...selectedUser, lastName: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={selectedUser.email || ""}
                  onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={selectedUser.role}
                  onValueChange={(value) => setSelectedUser({ ...selectedUser, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={selectedUser.department || ""}
                  onValueChange={(value) => setSelectedUser({ ...selectedUser, department: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments?.map((dept: string) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={selectedUser.phone || ""}
                  onChange={(e) => setSelectedUser({ ...selectedUser, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={selectedUser.isActive ? "active" : "inactive"}
                  onValueChange={(value) => setSelectedUser({ ...selectedUser, isActive: value === "active" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="flex justify-between">
            <Button 
              variant="destructive" 
              onClick={() => resetPasswordMutation.mutate(selectedUser.id)}
              disabled={resetPasswordMutation.isPending}
            >
              Reset Password
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditUserOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateUser} disabled={updateUserMutation.isPending}>
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}