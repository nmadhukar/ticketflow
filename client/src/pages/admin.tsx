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

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { TICKET_PRIORITIES } from "@shared/constants";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
// Removed Tabs components; we render sections conditionally by activeTab
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Ban,
  CheckCircle,
  Palette,
  Upload,
  BookOpen,
  FileText,
  Trash2,
  UserPlus,
  AlertCircle,
  FileEdit,
  Key,
  Eye,
  EyeOff,
  Copy,
  Plus,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useLocation, Link, useRoute } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import HelpDocumentManager from "@/components/HelpDocumentManager";
import { Separator } from "@/components/ui/separator";
import { BedrockUsageStats } from "@/components/bedrock-usage-stats";
import { FaqCacheManager } from "@/components/faq-cache-manager";
import { CompanyPolicyManager } from "@/components/company-policy-manager";
import AISettings from "@/pages/ai-settings";
import Invitations from "@/pages/invitations";
import AiAnalytics from "@/pages/ai-analytics";
import KnowledgeLearningQueue from "@/pages/knowledge-learning-queue";
import MainWrapper from "@/components/main-wrapper";

export default function AdminPanel() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [userStatusFilter, setUserStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("active");
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

  // API Keys state
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showApiKey, setShowApiKey] = useState<string | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<
    Record<number, boolean>
  >({});

  // Company branding state - unified local state for all company settings
  const [companySettingsLocal, setCompanySettingsLocal] = useState<{
    companyName?: string;
    ticketPrefix?: string;
    defaultTicketPriority?: string;
    autoCloseDays?: number | null;
    timezone?: string;
    dateFormat?: string;
    timeFormat?: string;
    maxFileUploadSize?: number;
    maintenanceMode?: boolean;
    logoUrl?: string;
    primaryColor?: string;
  }>({});
  const [selectedLogoFile, setSelectedLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
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

  const { data: companySettings } = useQuery({
    queryKey: ["/api/company-settings"],
    retry: false,
  });

  useEffect(() => {
    if (companySettings) {
      // Initialize local state from server data
      setCompanySettingsLocal({
        companyName: (companySettings as any).companyName || "",
        ticketPrefix: (companySettings as any).ticketPrefix || "TKT",
        defaultTicketPriority:
          (companySettings as any).defaultTicketPriority || "medium",
        autoCloseDays: (companySettings as any).autoCloseDays ?? null,
        timezone: (companySettings as any).timezone || "UTC",
        dateFormat: (companySettings as any).dateFormat || "YYYY-MM-DD",
        timeFormat: (companySettings as any).timeFormat || "24h",
        maxFileUploadSize: (companySettings as any).maxFileUploadSize || 10,
        maintenanceMode: (companySettings as any).maintenanceMode || false,
        logoUrl: (companySettings as any).logoUrl,
        primaryColor: (companySettings as any).primaryColor || "#3b82f6",
      });
      // Clear logo selection when settings are loaded from server
      setSelectedLogoFile(null);
      setLogoPreviewUrl(null);
      // Clear validation errors when settings are loaded
      setValidationErrors({});
    }
  }, [companySettings]);

  const { data: emailTemplates } = useQuery({
    queryKey: ["/api/email-templates"],
    retry: false,
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

  const { data: smtpSettingsData } = useQuery({
    queryKey: ["/api/smtp/settings"],
    retry: false,
  });

  useEffect(() => {
    const data: any = smtpSettingsData;
    if (data) {
      setEmailSettings({
        awsAccessKeyId: data.awsAccessKeyId || "",
        awsSecretAccessKey: data.awsSecretAccessKey || "",
        awsRegion: data.awsRegion || "us-east-1",
        fromEmail: data.fromEmail || "",
        fromName: data.fromName || "TicketFlow",
      });
    }
  }, [smtpSettingsData]);

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

  const updateEmailTemplateMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      subject: string;
      body: string;
    }) => {
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
      const response = await apiRequest(
        "POST",
        "/api/company-settings/logo",
        data
      );
      return await response.json();
    },
    onSuccess: (data: any) => {
      // Update local state with new logo URL
      if (data?.logoUrl) {
        setCompanySettingsLocal((prev) => ({
          ...prev,
          logoUrl: data.logoUrl,
        }));
      }
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
      return await apiRequest("POST", "/api/smtp/test", {
        testEmail: testEmailAddress,
      });
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

  const handleLogoUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
      toast({
        title: "Error",
        description: "Please upload a JPG or PNG image",
        variant: "destructive",
      });
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    // Check file size using maxFileUploadSize from company settings
    const maxSizeMB = companySettingsLocal?.maxFileUploadSize || 10;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      toast({
        title: "Error",
        description: `File size must be less than ${maxSizeMB}MB`,
        variant: "destructive",
      });
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    // Store file for later upload and create preview
    setSelectedLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setLogoPreviewUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

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

  const renderApi = () => (
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

  const renderCompanyConsole = () => (
    <Card>
      <CardHeader>
        <CardTitle>
          <p className="text-muted-foreground">
            Manage company branding, settings, and preferences
          </p>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-2 md:col-span-2">
          <Label>Company Name</Label>
          <Input
            data-field="companyName"
            value={companySettingsLocal.companyName || ""}
            onChange={(e) => {
              const value = e.target.value;
              setCompanySettingsLocal((prev: typeof companySettingsLocal) => ({
                ...prev,
                companyName: value,
              }));
              // Clear error when user types
              if (validationErrors.companyName) {
                setValidationErrors((prev) => {
                  const next = { ...prev };
                  delete next.companyName;
                  return next;
                });
              }
            }}
            placeholder="Enter company name"
            className={validationErrors.companyName ? "border-destructive" : ""}
          />
          {validationErrors.companyName && (
            <p className="text-sm text-destructive">
              {validationErrors.companyName}
            </p>
          )}
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              data-field="timezone"
              value={companySettingsLocal.timezone || "UTC"}
              onValueChange={(value) => {
                setCompanySettingsLocal(
                  (prev: typeof companySettingsLocal) => ({
                    ...prev,
                    timezone: value,
                  })
                );
                // Clear error when user selects
                if (validationErrors.timezone) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.timezone;
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTC">
                  UTC (Coordinated Universal Time)
                </SelectItem>
                <SelectItem value="America/New_York">
                  America/New_York (EST/EDT)
                </SelectItem>
                <SelectItem value="America/Chicago">
                  America/Chicago (CST/CDT)
                </SelectItem>
                <SelectItem value="America/Denver">
                  America/Denver (MST/MDT)
                </SelectItem>
                <SelectItem value="America/Los_Angeles">
                  America/Los_Angeles (PST/PDT)
                </SelectItem>
                <SelectItem value="Europe/London">
                  Europe/London (GMT/BST)
                </SelectItem>
                <SelectItem value="Europe/Paris">
                  Europe/Paris (CET/CEST)
                </SelectItem>
                <SelectItem value="Asia/Tokyo">Asia/Tokyo (JST)</SelectItem>
                <SelectItem value="Asia/Shanghai">
                  Asia/Shanghai (CST)
                </SelectItem>
                <SelectItem value="Australia/Sydney">
                  Australia/Sydney (AEST/AEDT)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              System timezone for date and time display
            </p>
            {validationErrors.timezone && (
              <p className="text-sm text-destructive">
                {validationErrors.timezone}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Date Format</Label>
            <Select
              data-field="dateFormat"
              value={companySettingsLocal.dateFormat || "YYYY-MM-DD"}
              onValueChange={(value) => {
                setCompanySettingsLocal(
                  (prev: typeof companySettingsLocal) => ({
                    ...prev,
                    dateFormat: value,
                  })
                );
                // Clear error when user selects
                if (validationErrors.dateFormat) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.dateFormat;
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select date format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="YYYY-MM-DD">
                  YYYY-MM-DD (2024-01-15)
                </SelectItem>
                <SelectItem value="MM/DD/YYYY">
                  MM/DD/YYYY (01/15/2024)
                </SelectItem>
                <SelectItem value="DD/MM/YYYY">
                  DD/MM/YYYY (15/01/2024)
                </SelectItem>
                <SelectItem value="DD-MM-YYYY">
                  DD-MM-YYYY (15-01-2024)
                </SelectItem>
                <SelectItem value="MMM DD, YYYY">
                  MMM DD, YYYY (Jan 15, 2024)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Format for displaying dates throughout the application
            </p>
            {validationErrors.dateFormat && (
              <p className="text-sm text-destructive">
                {validationErrors.dateFormat}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Time Format</Label>
            <Select
              data-field="timeFormat"
              value={companySettingsLocal.timeFormat || "24h"}
              onValueChange={(value) => {
                setCompanySettingsLocal(
                  (prev: typeof companySettingsLocal) => ({
                    ...prev,
                    timeFormat: value,
                  })
                );
                // Clear error when user selects
                if (validationErrors.timeFormat) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.timeFormat;
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select time format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24-hour (14:30)</SelectItem>
                <SelectItem value="12h">12-hour (2:30 PM)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Format for displaying times throughout the application
            </p>
            {validationErrors.timeFormat && (
              <p className="text-sm text-destructive">
                {validationErrors.timeFormat}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Max File Upload Size (MB)</Label>
            <Input
              data-field="maxFileUploadSize"
              type="number"
              min="1"
              max="100"
              value={companySettingsLocal.maxFileUploadSize || 10}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value) && value >= 1 && value <= 100) {
                  setCompanySettingsLocal(
                    (prev: typeof companySettingsLocal) => ({
                      ...prev,
                      maxFileUploadSize: value,
                    })
                  );
                  // Clear error when user types valid value
                  if (validationErrors.maxFileUploadSize) {
                    setValidationErrors((prev) => {
                      const next = { ...prev };
                      delete next.maxFileUploadSize;
                      return next;
                    });
                  }
                }
              }}
              placeholder="10"
              className={
                validationErrors.maxFileUploadSize ? "border-destructive" : ""
              }
            />
            <p className="text-sm text-muted-foreground">
              Maximum file upload size in megabytes (1-100 MB)
            </p>
            {validationErrors.maxFileUploadSize && (
              <p className="text-sm text-destructive">
                {validationErrors.maxFileUploadSize}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>Ticket Number Prefix</Label>
            <Input
              data-field="ticketPrefix"
              value={companySettingsLocal.ticketPrefix || "TKT"}
              onChange={(e) => {
                const value = e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9]/g, "")
                  .slice(0, 10);
                setCompanySettingsLocal(
                  (prev: typeof companySettingsLocal) => ({
                    ...prev,
                    ticketPrefix: value,
                  })
                );
                // Clear error when user types
                if (validationErrors.ticketPrefix) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.ticketPrefix;
                    return next;
                  });
                }
              }}
              placeholder="TKT"
              maxLength={10}
              className={
                validationErrors.ticketPrefix ? "border-destructive" : ""
              }
            />
            <p className="text-sm text-muted-foreground">
              Prefix used for generating ticket numbers (max 10 characters,
              letters and numbers only)
            </p>
            {validationErrors.ticketPrefix && (
              <p className="text-sm text-destructive">
                {validationErrors.ticketPrefix}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Default Ticket Priority</Label>
            <Select
              data-field="defaultTicketPriority"
              value={companySettingsLocal.defaultTicketPriority}
              onValueChange={(value) => {
                setCompanySettingsLocal(
                  (prev: typeof companySettingsLocal) => ({
                    ...prev,
                    defaultTicketPriority: value,
                  })
                );
                // Clear error when user selects
                if (validationErrors.defaultTicketPriority) {
                  setValidationErrors((prev) => {
                    const next = { ...prev };
                    delete next.defaultTicketPriority;
                    return next;
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select default priority" />
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITIES.map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Default priority assigned to new tickets when not specified
            </p>
            {validationErrors.defaultTicketPriority && (
              <p className="text-sm text-destructive">
                {validationErrors.defaultTicketPriority}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Auto-close Resolved Tickets After</Label>
            <Input
              type="number"
              min="1"
              max="365"
              value={companySettingsLocal.autoCloseDays ?? ""}
              onChange={(e) => {
                const value =
                  e.target.value === "" ? null : parseInt(e.target.value, 10);
                setCompanySettingsLocal(
                  (prev: typeof companySettingsLocal) => ({
                    ...prev,
                    autoCloseDays: value || null,
                  })
                );
              }}
              placeholder="Enter days or leave empty to disable"
            />
            <p className="text-sm text-muted-foreground">
              Days after which resolved tickets are automatically closed
              (1-365). Leave empty to disable auto-close.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Maintenance Mode</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, the system will be in maintenance mode and users
                  will see a maintenance message
                </p>
              </div>
              <Switch
                checked={companySettingsLocal.maintenanceMode || false}
                onCheckedChange={(checked) => {
                  setCompanySettingsLocal(
                    (prev: typeof companySettingsLocal) => ({
                      ...prev,
                      maintenanceMode: checked,
                    })
                  );
                }}
              />
            </div>
            {companySettingsLocal.maintenanceMode && (
              <Alert className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Maintenance Mode Active</AlertTitle>
                <AlertDescription>
                  Users will see a maintenance message when this mode is
                  enabled.
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Company Logo</Label>
          <div className="flex items-center gap-4">
            {logoPreviewUrl || companySettingsLocal.logoUrl ? (
              <div className="relative w-48 h-24 border rounded-lg overflow-hidden bg-gray-50">
                <img
                  src={logoPreviewUrl || companySettingsLocal.logoUrl}
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
                className="flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {selectedLogoFile ? "Change Logo" : "Select Logo"}
              </Button>
              {selectedLogoFile && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedLogoFile(null);
                    setLogoPreviewUrl(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = "";
                    }
                  }}
                  className="text-xs text-destructive"
                >
                  Clear
                </Button>
              )}
              <p className="text-sm text-muted-foreground">
                JPG or PNG, max {companySettingsLocal.maxFileUploadSize || 10}MB
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

          <p className="text-sm text-muted-foreground">
            Your logo will appear in the navigation bar and on customer-facing
            documents.
          </p>
        </div>
      </CardContent>

      <CardFooter className="pt-4 border-t flex flex-col gap-4">
        {/* Validation Errors Display */}
        {Object.keys(validationErrors).length > 0 && (
          <div className="w-full rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-destructive mb-2">
                  Please fix the following errors before saving:
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-destructive">
                  {Object.entries(validationErrors).map(([field, message]) => (
                    <li key={field}>{message}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <Button
          type="button"
          disabled={
            Object.keys(validationErrors).length > 0 ||
            updateCompanySettingsMutation.isPending ||
            uploadLogoMutation.isPending
          }
          onClick={async (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Validate required fields (excluding logo)
            const errors: Record<string, string> = {};

            // Company Name - use the local state value
            const finalCompanyName = (
              companySettingsLocal.companyName || ""
            ).trim();
            if (!finalCompanyName || finalCompanyName.length === 0) {
              errors.companyName = "Company name is required";
            }

            // Ticket Prefix - must not be empty
            const ticketPrefix = (
              companySettingsLocal.ticketPrefix || ""
            ).trim();
            if (!ticketPrefix || ticketPrefix.length === 0) {
              errors.ticketPrefix = "Ticket prefix is required";
            }

            // Timezone - check actual value (not the default shown in UI)
            const timezone = String(companySettingsLocal.timezone || "").trim();
            if (!timezone || timezone.length === 0) {
              errors.timezone = "Timezone is required";
            }

            // Date Format - check actual value
            const dateFormat = String(
              companySettingsLocal.dateFormat || ""
            ).trim();
            if (!dateFormat || dateFormat.length === 0) {
              errors.dateFormat = "Date format is required";
            }

            // Time Format - check actual value
            const timeFormat = String(
              companySettingsLocal.timeFormat || ""
            ).trim();
            if (!timeFormat || timeFormat.length === 0) {
              errors.timeFormat = "Time format is required";
            }

            // Default Ticket Priority - check actual value
            const defaultTicketPriority = String(
              companySettingsLocal.defaultTicketPriority || ""
            ).trim();
            if (!defaultTicketPriority || defaultTicketPriority.length === 0) {
              errors.defaultTicketPriority =
                "Default ticket priority is required";
            }

            // Max File Upload Size - must be valid number between 1-100
            const maxFileUploadSize = companySettingsLocal.maxFileUploadSize;
            if (
              maxFileUploadSize === undefined ||
              maxFileUploadSize === null ||
              isNaN(Number(maxFileUploadSize)) ||
              Number(maxFileUploadSize) < 1 ||
              Number(maxFileUploadSize) > 100
            ) {
              errors.maxFileUploadSize =
                "Max file upload size must be between 1 and 100 MB";
            }

            // Check if there are any errors
            const hasErrors = Object.keys(errors).length > 0;

            if (hasErrors) {
              // Set validation errors immediately
              setValidationErrors(errors);

              // Scroll to first error field after a brief delay
              requestAnimationFrame(() => {
                const firstErrorField = Object.keys(errors)[0];
                const errorElement = document.querySelector(
                  `[data-field="${firstErrorField}"]`
                );
                if (errorElement) {
                  errorElement.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                  setTimeout(() => {
                    (errorElement as HTMLElement)?.focus();
                  }, 300);
                }
              });

              // CRITICAL: Return early to prevent save
              // This MUST stop execution here
              return;
            }

            // Clear any previous errors
            setValidationErrors({});

            // Upload logo first if a new file was selected
            if (selectedLogoFile) {
              const reader = new FileReader();
              const base64Promise = new Promise<string>((resolve, reject) => {
                reader.onloadend = () => {
                  const base64String = reader.result?.toString().split(",")[1];
                  if (base64String) {
                    resolve(base64String);
                  } else {
                    reject(new Error("Failed to read file"));
                  }
                };
                reader.onerror = reject;
              });
              reader.readAsDataURL(selectedLogoFile);

              try {
                const base64String = await base64Promise;
                await uploadLogoMutation.mutateAsync({
                  fileName: selectedLogoFile.name,
                  fileType: selectedLogoFile.type,
                  fileData: base64String,
                });
                // Clear selection after successful upload
                setSelectedLogoFile(null);
                setLogoPreviewUrl(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              } catch (error) {
                // Error toast is handled by mutation
                return;
              }
            }

            // Then save settings - use the unified local state
            const settingsToSave = {
              companyName: companySettingsLocal.companyName || "",
              ticketPrefix: companySettingsLocal.ticketPrefix || "TKT",
              defaultTicketPriority:
                companySettingsLocal.defaultTicketPriority || "medium",
              autoCloseDays: companySettingsLocal.autoCloseDays ?? 7,
              timezone: companySettingsLocal.timezone || "UTC",
              dateFormat: companySettingsLocal.dateFormat || "YYYY-MM-DD",
              timeFormat: companySettingsLocal.timeFormat || "24h",
              maxFileUploadSize: companySettingsLocal.maxFileUploadSize || 10,
              maintenanceMode: companySettingsLocal.maintenanceMode || false,
              // Keep existing logo URL if no new file is being uploaded
              logoUrl: companySettingsLocal.logoUrl,
              primaryColor: companySettingsLocal.primaryColor || "#3b82f6",
            };
            updateCompanySettingsMutation.mutate(settingsToSave);
          }}
        >
          {updateCompanySettingsMutation.isPending ||
          uploadLogoMutation.isPending
            ? "Saving..."
            : "Save All Settings"}
        </Button>
      </CardFooter>
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

  const renderEmail = () => (
    <Card>
      <CardHeader>
        <CardTitle>AWS Configuration</CardTitle>
        <CardDescription>
          Configure AWS credentials for email delivery (SES) and AI chat
          assistant (Bedrock)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert className="border-blue-200 bg-blue-50">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertTitle className="text-blue-800">
            AWS Services Configuration
          </AlertTitle>
          <AlertDescription className="text-blue-700">
            <p className="mb-2">
              TicketFlow uses AWS SES for email delivery functionality:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                <strong>AWS SES (Simple Email Service):</strong> For sending
                system emails
              </li>
            </ul>
            <p className="mt-2 text-xs text-orange-700">
              Configure AWS credentials for email functionality.
            </p>
          </AlertDescription>
        </Alert>

        {/* AWS SES Configuration */}
        <div id="email-integrations" className="space-y-4">
          <h3 className="text-lg font-semibold border-b pb-2">
            AWS SES Configuration (Email)
          </h3>

          <div className="space-y-2">
            <Label htmlFor="aws-access-key">AWS Access Key ID (SES)</Label>
            <Input
              id="aws-access-key"
              placeholder="Enter your AWS Access Key ID for SES"
              value={emailSettings?.awsAccessKeyId || ""}
              onChange={(e) =>
                setEmailSettings({
                  ...emailSettings,
                  awsAccessKeyId: e.target.value,
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              IAM user access key with ses:SendEmail and ses:SendRawEmail
              permissions
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aws-secret-key">AWS Secret Access Key (SES)</Label>
            <Input
              id="aws-secret-key"
              type="password"
              placeholder="Enter your AWS Secret Access Key for SES"
              value={emailSettings?.awsSecretAccessKey || ""}
              onChange={(e) =>
                setEmailSettings({
                  ...emailSettings,
                  awsSecretAccessKey: e.target.value,
                })
              }
            />
            <p className="text-sm text-muted-foreground">
              Your AWS IAM user secret key for SES
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aws-region">AWS Region (SES)</Label>
            <Select
              value={emailSettings?.awsRegion || "us-east-1"}
              onValueChange={(value) =>
                setEmailSettings({
                  ...emailSettings,
                  awsRegion: value,
                })
              }
            >
              <SelectTrigger id="aws-region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                <SelectItem value="eu-west-1">EU (Ireland)</SelectItem>
                <SelectItem value="eu-central-1">EU (Frankfurt)</SelectItem>
                <SelectItem value="ap-southeast-1">
                  Asia Pacific (Singapore)
                </SelectItem>
                <SelectItem value="ap-southeast-2">
                  Asia Pacific (Sydney)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              The AWS region where SES is configured
            </p>
          </div>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-lg font-semibold mb-4">Service Status</h3>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  emailSettings?.awsAccessKeyId &&
                  emailSettings?.awsSecretAccessKey &&
                  emailSettings?.awsRegion
                    ? "bg-green-500"
                    : "bg-yellow-500"
                }`}
              ></div>
              <span className="text-sm">
                {emailSettings?.awsAccessKeyId &&
                emailSettings?.awsSecretAccessKey &&
                emailSettings?.awsRegion
                  ? "AWS SES configured - Email features enabled"
                  : "AWS SES not configured - Email features disabled"}
              </span>
            </div>
          </div>
        </div>

        <div id="email-sender" className="border-t pt-4">
          <h3 className="text-lg font-semibold mb-4">Sender Configuration</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="from-email">From Email Address</Label>
              <Input
                id="from-email"
                type="email"
                placeholder="noreply@yourcompany.com"
                value={emailSettings?.fromEmail || ""}
                onChange={(e) =>
                  setEmailSettings({
                    ...emailSettings,
                    fromEmail: e.target.value,
                  })
                }
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
                onChange={(e) =>
                  setEmailSettings({
                    ...emailSettings,
                    fromName: e.target.value,
                  })
                }
              />
              <p className="text-sm text-muted-foreground">
                The display name for system emails
              </p>
            </div>
          </div>
        </div>

        <div id="email-test" className="border-t pt-4">
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

        <div id="email-templates" className="border-t pt-4">
          <h3 className="text-lg font-semibold mb-4">Email Templates</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Customize email templates for different system notifications
          </p>
          <div className="space-y-4">
            <Select
              value={selectedTemplate?.name || ""}
              onValueChange={(value) => {
                const list: any[] = (emailTemplates as any) || [];
                const template = list.find((t: any) => t.name === value);
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

        <div className="flex justify-end space-x-4 pt-4">
          <Button
            className="bg-primary hover:bg-primary/90"
            onClick={() => saveEmailSettingsMutation.mutate()}
            disabled={saveEmailSettingsMutation.isPending}
          >
            {saveEmailSettingsMutation.isPending
              ? "Saving..."
              : "Save Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const sections: Record<string, JSX.Element> = {
    users: renderUsers(),
    invitations: <Invitations />,
    teams: renderTeams(),
    api: renderApi(),
    "company-console": renderCompanyConsole(),
    help: renderHelp(),
    policies: renderPolicies(),
    sso: renderSso(),
    email: renderEmail(),
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
                  onChange={(e) =>
                    setSelectedTemplate({
                      ...selectedTemplate,
                      subject: e.target.value,
                    })
                  }
                  placeholder="Email subject line"
                />
              </div>

              <div className="space-y-2">
                <Label>Template Body (HTML)</Label>
                <Textarea
                  value={selectedTemplate.body || ""}
                  onChange={(e) =>
                    setSelectedTemplate({
                      ...selectedTemplate,
                      body: e.target.value,
                    })
                  }
                  placeholder="Email template HTML content"
                  className="font-mono text-sm h-96"
                />
              </div>

              <div className="space-y-2">
                <Label>Available Variables</Label>
                <div className="bg-muted p-3 rounded-md">
                  <p className="text-sm font-medium mb-2">
                    You can use these variables in your template:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplate.variables?.map((variable: string) => (
                      <code
                        key={variable}
                        className="bg-background px-2 py-1 rounded text-xs"
                      >
                        {`{{${variable}}}`}
                      </code>
                    ))}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsEditTemplateOpen(false)}
                >
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
                  {updateEmailTemplateMutation.isPending
                    ? "Saving..."
                    : "Save Template"}
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
