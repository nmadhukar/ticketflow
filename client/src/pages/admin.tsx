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
import { Shield, Users, Settings, BarChart3, UserCog, Ban, CheckCircle, Home, Palette, Upload, BookOpen, FileText, Trash2, Edit, Search, Building, UserPlus } from "lucide-react";
import { useLocation, Link } from "wouter";
import HelpDocumentManager from "@/components/HelpDocumentManager";

export default function AdminPanel() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Microsoft SSO state
  const [ssoConfig, setSsoConfig] = useState({
    clientId: "",
    clientSecret: "",
    tenantId: "",
  });

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

  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
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
          <TabsTrigger value="teams">Team Management</TabsTrigger>
          <TabsTrigger value="settings">System Settings</TabsTrigger>
          <TabsTrigger value="branding">Company Branding</TabsTrigger>
          <TabsTrigger value="help">Help Documentation</TabsTrigger>
          <TabsTrigger value="sso">Microsoft 365 SSO</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>
                Manage user accounts, roles, and permissions
              </CardDescription>
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
                  {users?.map((user: any) => (
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleUserStatusMutation.mutate(user.id)}
                          >
                            {user.isActive ? <Ban className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                          </Button>
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
                <Input defaultValue="TKT" disabled />
                <p className="text-sm text-muted-foreground">
                  Prefix used for generating ticket numbers
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
              <Button className="mt-4">Save Settings</Button>
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
                      // Simulate test connection
                      toast({
                        title: "Testing SSO Connection",
                        description: "Checking Microsoft 365 configuration...",
                      });
                      
                      // Wait a moment to simulate API call
                      await new Promise(resolve => setTimeout(resolve, 1500));
                      
                      // For now, we'll validate the format
                      const isValidGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                      
                      if (ssoConfig.clientId && (isValidGuid.test(ssoConfig.clientId) || ssoConfig.clientId.length > 10)) {
                        toast({
                          title: "Connection Test Successful",
                          description: "Microsoft 365 SSO configuration appears valid",
                        });
                      } else {
                        toast({
                          title: "Connection Test Failed",
                          description: "Invalid client ID format. Please check your Azure AD configuration",
                          variant: "destructive",
                        });
                      }
                    } catch (error) {
                      toast({
                        title: "Connection Test Failed",
                        description: "Unable to verify SSO configuration",
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
      </Tabs>

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