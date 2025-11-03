/**
 * Admin Panel - Comprehensive System Administration Interface
 *
 * Provides full administrative control over the TicketFlow system with:
 * - User Management: View, edit, approve, ban users with role assignments
 * - System Settings: Company branding, ticket numbering, email configuration
 * - API Key Management: Create, manage, and monitor API keys with proper security
 * - AWS Integration: Separate configuration for SES (email) and Bedrock (AI)
 * - Microsoft 365 SSO: Configure enterprise authentication integration
 * - Help Documentation: Manage help documents and policy files for AI chatbot
 * - Email Templates: Customize system email templates for various events
 * - Audit and Monitoring: Track system usage and user activities
 *
 * Security Features:
 * - Role-based access control (admin-only access)
 * - Secure API key generation and management
 * - Input validation and sanitization
 * - Audit logging for administrative actions
 *
 * The panel uses a tabbed interface for organization and includes:
 * - Real-time data updates and validation
 * - Bulk operations for user management
 * - Configuration testing and validation
 * - Visual indicators for system status
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
// Removed Tabs components; we render sections conditionally by activeTab
import { BedrockUsageStats } from "@/components/bedrock-usage-stats";
import { CompanyPolicyManager } from "@/components/company-policy-manager";
import { FaqCacheManager } from "@/components/faq-cache-manager";
import HelpDocumentManager from "@/components/HelpDocumentManager";
import MainWrapper from "@/components/main-wrapper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import AiAnalytics from "@/pages/ai-analytics";
import AISettings from "@/pages/ai-settings";
import Invitations from "@/pages/invitations";
import KnowledgeLearningQueue from "@/pages/knowledge-learning-queue";
import {
  AlertCircle,
  Ban,
  CheckCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Plus,
  TestTube,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import CompanyConsole from "./admin/CompanyConsole";

export default function AdminPanel() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [userStatusFilter, setUserStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("active");

  const [activeTab, setActiveTab] = useState("users");
  const [matchTabRoute, tabParams] = useRoute("/admin/:tab");

  useEffect(() => {
    const paramTab = (tabParams as any)?.tab as string | undefined;
    setActiveTab(paramTab || "users");
  }, [matchTabRoute, (tabParams as any)?.tab]);

  // Deep-link support for section navigation via ?section=... for any active tab
  // Tries multiple id patterns to be resilient across sections/components
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (!section) return;

    // Candidate element IDs to try
    const candidates = [
      `${activeTab}-${section}`, // e.g., ai-analytics-analytics
      `${section}-${activeTab}`, // fallback
      `${section}`, // generic id
      `${activeTab}__${section}`, // alternate delimiter
    ];

    for (const id of candidates) {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }, [activeTab]);

  // Microsoft SSO state
  const [ssoConfig, setSsoConfig] = useState({
    clientId: "",
    clientSecret: "",
    tenantId: "",
  });

  // Teams Integration state
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [teamsNotificationTypes, setTeamsNotificationTypes] = useState<
    string[]
  >([]);

  // API Keys state
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showApiKey, setShowApiKey] = useState<string | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<
    Record<number, boolean>
  >({});

  // Create Team dialog state
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");

  // Check if user is admin
  if ((user as any)?.role !== "admin") {
    setLocation("/");
    return null;
  }

  const { data: users } = useQuery({
    queryKey: ["/api/admin/users"],
    retry: false,
    refetchOnMount: "always",
  });

  const { data: teams } = useQuery({
    queryKey: ["/api/teams"],
    retry: false,
    refetchOnMount: "always",
  });

  const { data: apiKeys } = useQuery({
    queryKey: ["/api/api-keys"],
    refetchOnMount: "always",
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

  const updateUserMutation = useMutation({
    mutationFn: async (userData: any) => {
      return await apiRequest(
        "PATCH",
        `/api/admin/users/${userData.id}`,
        userData
      );
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
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/toggle-status`
      );
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

  const assignTeamMutation = useMutation({
    mutationFn: async ({
      userId,
      teamId,
      role,
    }: {
      userId: string;
      teamId: number;
      role: string;
    }) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/assign-team`,
        { teamId, role }
      );
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", variables.teamId, "members"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", variables.teamId],
      });
      toast({
        title: "Success",
        description: "User assigned to team",
      });
    },
  });

  // Create Team
  const createTeamMutation = useMutation({
    mutationFn: async (teamData: { name: string; description: string }) => {
      return await apiRequest("POST", "/api/teams", teamData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      setIsCreateTeamOpen(false);
      setTeamName("");
      setTeamDescription("");
      toast({
        title: "Success",
        description: "Team created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create team",
        variant: "destructive",
      });
    },
  });

  const handleCreateTeam = () => {
    if (!teamName.trim()) {
      toast({
        title: "Error",
        description: "Team name is required",
        variant: "destructive",
      });
      return;
    }
    createTeamMutation.mutate({
      name: teamName.trim(),
      description: teamDescription.trim(),
    });
  };

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest(
        "POST",
        `/api/admin/users/${userId}/reset-password`
      );
    },
    onSuccess: (data: any) => {
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

  // API Key mutations
  const createApiKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", "/api/api-keys", { name });
    },
    onSuccess: (data: any) => {
      setShowApiKey(data.plainKey);
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

  const renderUsers = () => (
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
              onValueChange={(value: "all" | "active" | "inactive") =>
                setUserStatusFilter(value)
              }
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
            <Link to="/admin/invitations?section=management">
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
            {(users as any)
              ?.filter((user: any) => {
                if (userStatusFilter === "all") return true;
                if (userStatusFilter === "active") return user.isActive;
                if (userStatusFilter === "inactive") return !user.isActive;
                return true;
              })
              .map((user: any) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.firstName} {user.lastName}
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.role === "admin"
                          ? "destructive"
                          : user.role === "customer"
                          ? "secondary"
                          : "default"
                      }
                    >
                      {user.role === "customer"
                        ? "Customer"
                        : `System ${user.role}`}
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
                      <Badge
                        variant={user.isApproved ? "default" : "secondary"}
                      >
                        {user.isApproved ? "Approved" : "Pending"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString()
                      : "-"}
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
                              role: "member",
                            });
                          }
                        }}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder="Assign Team" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Team</SelectItem>
                          {(teams as any)?.map((team: any) => (
                            <SelectItem
                              key={team.id}
                              value={team.id.toString()}
                            >
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
                              onClick={() =>
                                toggleUserStatusMutation.mutate(user.id)
                              }
                              disabled={toggleUserStatusMutation.isPending}
                            >
                              {user.isActive ? (
                                <Ban className="h-4 w-4" />
                              ) : (
                                <CheckCircle className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {user.isActive
                              ? "Deactivate user"
                              : "Activate user"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {user.role === "customer" && !user.isApproved && (
                        <Button
                          size="sm"
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
  );

  const renderTeams = () => (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Team Management</CardTitle>
            <CardDescription>
              View and manage teams across the organization
            </CardDescription>
          </div>
          <Button onClick={() => setIsCreateTeamOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Team
          </Button>
        </div>
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
            {(teams as any)?.map((team: any) => (
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
  );

  const renderDeveloperResources = () => (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium text-muted-foreground">
          Manage API keys for third-party integrations
        </CardTitle>
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
              onKeyPress={(e) => e.key === "Enter" && handleCreateApiKey()}
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
          {(apiKeys as any) && (apiKeys as any).length > 0 ? (
            <div className="space-y-2">
              {(apiKeys as any).map((apiKey: any) => (
                <div
                  key={apiKey.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-medium">{apiKey.name}</p>
                    <div className="flex items-center gap-4 mt-1">
                      <p className="text-xs text-muted-foreground">
                        Created:{" "}
                        {new Date(apiKey.createdAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last used:{" "}
                        {apiKey.lastUsed
                          ? new Date(apiKey.lastUsed).toLocaleDateString()
                          : "Never"}
                      </p>
                      {apiKey.expiresAt && (
                        <p className="text-xs text-muted-foreground">
                          Expires:{" "}
                          {new Date(apiKey.expiresAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                      {apiKey.key ? apiKey.key.substring(0, 8) + "..." : "N/A"}
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

        <Separator />

        {/* Bedrock Usage Statistics */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">AI Usage Statistics</h4>
          <BedrockUsageStats />
        </div>

        <Separator />

        {/* FAQ Cache Management */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">FAQ Cache Management</h4>
          <FaqCacheManager />
        </div>
      </CardContent>
    </Card>
  );

  const renderHelp = () => (
    <Card>
      <CardContent>
        <div className="space-y-6">
          <HelpDocumentManager />
        </div>
      </CardContent>
    </Card>
  );

  const renderPolicies = () => (
    <Card>
      <CardContent>
        <CompanyPolicyManager />
      </CardContent>
    </Card>
  );

  const renderSso = () => (
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

  const renderTeamsIntegration = () => {
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
                          onClick={() =>
                            disableTeamsIntegrationMutation.mutate()
                          }
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

  const sections: Record<string, JSX.Element> = {
    users: renderUsers(),
    invitations: <Invitations />,
    teams: renderTeams(),
    "developer-resources": renderDeveloperResources(),
    "company-console": <CompanyConsole />,
    help: renderHelp(),
    policies: renderPolicies(),
    sso: renderSso(),
    "ms-teams-integration": renderTeamsIntegration(),
    "ai-settings": <AISettings />,
    "ai-analytics": <AiAnalytics />,
    "learning-queue": <KnowledgeLearningQueue />,
  };

  const sectionToRender = sections[activeTab] ?? sections["users"];

  return (
    <MainWrapper
      title="Admin Panel"
      subTitle="Manage Users, Teams, Invitations, Api, Policies, Configuration, AI Analytics, AI Settings and more"
    >
      {/* System Overview moved to Dashboard (admin-only) */}

      <div className="flex gap-6">
        {/* Main Content Area */}
        <div className="flex-1">{sectionToRender}</div>
      </div>

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
                    onChange={(e) =>
                      setSelectedUser({
                        ...selectedUser,
                        firstName: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input
                    value={selectedUser.lastName || ""}
                    onChange={(e) =>
                      setSelectedUser({
                        ...selectedUser,
                        lastName: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={selectedUser.email || ""}
                  onChange={(e) =>
                    setSelectedUser({ ...selectedUser, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={selectedUser.role}
                  onValueChange={(value) =>
                    setSelectedUser({ ...selectedUser, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="agent">{`Agent (Tech Support)`}</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Department field removed */}
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={selectedUser.phone || ""}
                  onChange={(e) =>
                    setSelectedUser({ ...selectedUser, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={selectedUser.isActive ? "active" : "inactive"}
                  onValueChange={(value) =>
                    setSelectedUser({
                      ...selectedUser,
                      isActive: value === "active",
                    })
                  }
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
              <Button
                variant="outline"
                onClick={() => setIsEditUserOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateUser}
                disabled={updateUserMutation.isPending}
              >
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Team Dialog */}
      <Dialog open={isCreateTeamOpen} onOpenChange={setIsCreateTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Team</DialogTitle>
            <DialogDescription>
              Create a new team to collaborate on tasks and projects.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                placeholder="Enter team name..."
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="team-description">Description</Label>
              <Textarea
                id="team-description"
                placeholder="Describe your team's purpose..."
                value={teamDescription}
                onChange={(e) => setTeamDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateTeamOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTeam}
              disabled={createTeamMutation.isPending}
            >
              {createTeamMutation.isPending ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
