/**
 * AI Settings Configuration Interface
 *
 * Advanced configuration panel for fine-tuning AI-powered features using AWS Bedrock.
 * This interface allows administrators to:
 *
 * Auto-Response Configuration:
 * - Enable/disable automatic response generation
 * - Set confidence thresholds for when to send auto-responses
 * - Configure response timeouts and length limits
 * - Monitor response effectiveness and accuracy
 *
 * Knowledge Base Learning:
 * - Enable automatic learning from resolved tickets
 * - Set minimum resolution scores for article creation
 * - Configure approval workflows for AI-generated content
 * - Monitor learning queue and processing status
 *
 * Escalation Management:
 * - Set complexity thresholds for automatic escalation
 * - Configure escalation teams and workflows
 * - Define escalation criteria and routing rules
 *
 * Model Configuration:
 * - Select between different Claude 3 Sonnet variants
 * - Adjust temperature for response creativity/consistency
 * - Set token limits for cost and performance optimization
 * - Configure rate limiting for API usage control
 *
 * Analytics and Monitoring:
 * - Real-time usage statistics and metrics
 * - Cost tracking and optimization recommendations
 * - Performance monitoring and optimization
 * - Error tracking and resolution guidance
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useBedrockCostNotifications } from "@/hooks/useBedrockCostNotifications";
import { useDepartmentTeams } from "@/hooks/useDepartments";
import { useAuth } from "@/hooks/useAuth";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  Settings,
  Sliders,
  Save,
  AlertTriangle,
  CheckCircle,
  Zap,
  Shield,
  Database,
  Key,
  Globe,
  RefreshCw,
  Pencil,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface AISettings {
  // AI Response Settings
  autoResponseEnabled: boolean;
  confidenceThreshold: number;
  maxResponseLength: number;
  responseTimeout: number;

  // Knowledge Base Settings
  autoLearnEnabled: boolean;
  minResolutionScore: number;
  articleApprovalRequired: boolean;

  // Escalation Settings
  complexityThreshold: number;
  escalationEnabled: boolean;
  escalationTeamId?: number;

  // Model Settings
  bedrockModel: string;
  temperature: number;
  maxTokens: number;

  // Rate Limiting
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number; // 0 disables hourly cap
  maxRequestsPerDay: number;
}

export default function AISettings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { handleApiError } = useBedrockCostNotifications();
  const [hasChanges, setHasChanges] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Cost limits state
  const [isEditingCostLimits, setIsEditingCostLimits] = useState(false);
  const [costLimits, setCostLimits] = useState({
    dailyLimitUSD: 5.0,
    monthlyLimitUSD: 50.0,
    maxTokensPerRequest: 1000,
    maxRequestsPerDay: 50,
    maxRequestsPerHour: 10,
    isFreeTierAccount: true,
  });

  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/admin/ai-settings"],
  });

  // Fetch departments for escalation team selection
  const { data: departments } = useQuery({
    queryKey: ["/api/teams/departments"],
  });

  // State for escalation department selection
  const [escalationDepartmentId, setEscalationDepartmentId] = useState<
    number | undefined
  >(undefined);

  // Fetch teams for the selected department
  const { data: departmentTeams } = useDepartmentTeams(escalationDepartmentId);

  // Fetch API key status
  const { data: apiKeys } = useQuery({
    queryKey: ["/api/admin/api-keys"],
  });

  // Fetch Bedrock settings
  const { data: bedrockData } = useQuery({
    queryKey: ["/api/bedrock/settings"],
  });

  const [formData, setFormData] = useState<AISettings>({
    autoResponseEnabled: true,
    confidenceThreshold: 0.7,
    maxResponseLength: 1000,
    responseTimeout: 30,
    autoLearnEnabled: true,
    minResolutionScore: 0.8,
    articleApprovalRequired: true,
    complexityThreshold: 70,
    escalationEnabled: true,
    escalationTeamId: undefined,
    bedrockModel: "amazon.titan-text-express-v1",
    temperature: 0.3,
    maxTokens: 2000,
    maxRequestsPerMinute: 20,
    maxRequestsPerHour: 0,
    maxRequestsPerDay: 1000,
  });

  // Bedrock settings state
  const [bedrockSettings, setBedrockSettings] = useState({
    bedrockAccessKeyId: "",
    bedrockSecretAccessKey: "",
    bedrockRegion: "us-east-1",
    bedrockModelId: "amazon.titan-text-express-v1",
    hasBedrockSecret: false,
  });

  // Load settings when data is fetched
  useEffect(() => {
    if (settings) {
      setFormData(settings as AISettings);
    }
  }, [settings]);

  // Derive department from existing escalation team when settings load
  useEffect(() => {
    if (formData.escalationTeamId && !escalationDepartmentId) {
      // Fetch the team to get its department
      const fetchTeamDepartment = async () => {
        try {
          const res = await apiRequest(
            "GET",
            `/api/teams/${formData.escalationTeamId}`
          );
          const team = await res.json();
          if (team?.departmentId) {
            setEscalationDepartmentId(team.departmentId);
          }
        } catch (error) {
          console.error("Failed to fetch team department:", error);
        }
      };
      fetchTeamDepartment();
    }
  }, [formData.escalationTeamId, escalationDepartmentId]);

  // Load Bedrock settings when data is fetched
  useEffect(() => {
    if (bedrockData && typeof bedrockData === "object") {
      setBedrockSettings({
        bedrockAccessKeyId: (bedrockData as any).bedrockAccessKeyId || "",
        bedrockSecretAccessKey:
          (bedrockData as any).bedrockSecretAccessKey || "",
        bedrockRegion: (bedrockData as any).bedrockRegion || "us-east-1",
        bedrockModelId:
          (bedrockData as any).bedrockModelId || "amazon.titan-text-express-v1",
        hasBedrockSecret: (bedrockData as any).hasBedrockSecret || false,
      });
    }
  }, [bedrockData]);

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (data: AISettings) => {
      const res = await apiRequest("PUT", "/api/admin/ai-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-settings"] });
      setHasChanges(false);
      toast({
        title: "Settings saved",
        description: "AI settings have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update Bedrock settings mutation
  const updateBedrockSettings = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/bedrock/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bedrock/settings"] });
      toast({
        title: "Bedrock settings saved",
        description: "AWS Bedrock configuration has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save Bedrock settings",
        description:
          error.message || "An error occurred while saving Bedrock settings.",
        variant: "destructive",
      });
    },
  });

  // Test Bedrock connection
  const testConnection = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-settings/test");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Connection successful",
          description: `AWS Bedrock is properly configured and accessible. Cost: $${
            data.costEstimate?.estimatedCost?.toFixed(4) || "0.0000"
          }`,
        });
      } else {
        toast({
          title: "Connection failed",
          description: data.message || "Failed to connect to Bedrock",
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      handleApiError(error);
    },
  });

  // Update cost limits mutation
  const updateCostLimitsMutation = useMutation({
    mutationFn: async (limits: any) => {
      const res = await apiRequest("PUT", "/api/bedrock/cost-limits", limits);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/bedrock/cost-statistics"],
      });
      setIsEditingCostLimits(false);
      toast({
        title: "Cost limits updated",
        description: "Cost limits have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update cost limits",
        description:
          error.message || "An error occurred while updating cost limits.",
        variant: "destructive",
      });
    },
  });

  // localStorage utility functions
  const getStorageKey = (feature: string) => {
    const userId = (user as any)?.id || "anonymous";
    return `ai-settings-backup-${userId}-${feature}`;
  };

  const saveBackupToLocalStorage = (
    feature: "autoResponse" | "escalation" | "autoLearn",
    values: any
  ) => {
    try {
      const key = getStorageKey(feature);
      localStorage.setItem(key, JSON.stringify(values));
    } catch (error) {
      console.error("Failed to save backup to localStorage:", error);
    }
  };

  const getBackupFromLocalStorage = (
    feature: "autoResponse" | "escalation" | "autoLearn"
  ) => {
    try {
      const key = getStorageKey(feature);
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Failed to get backup from localStorage:", error);
      return null;
    }
  };

  const clearBackupFromLocalStorage = (
    feature: "autoResponse" | "escalation" | "autoLearn"
  ) => {
    try {
      const key = getStorageKey(feature);
      localStorage.removeItem(key);
    } catch (error) {
      console.error("Failed to clear backup from localStorage:", error);
    }
  };

  const handleChange = (key: keyof AISettings, value: any) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (isRateField(key)) setRatePreset("Custom");
    setHasChanges(true);
  };

  // Handle feature toggle with confirmation
  const handleFeatureToggle = (
    feature: "autoResponse" | "escalation" | "autoLearn",
    enabled: boolean
  ) => {
    // If enabling, just toggle (no confirmation needed)
    if (enabled) {
      // Remove from reset list if it was there
      setFeaturesToReset((prev) => {
        const updated = { ...prev };
        delete updated[feature];
        return updated;
      });
      clearBackupFromLocalStorage(feature);

      if (feature === "autoResponse") {
        handleChange("autoResponseEnabled", true);
      } else if (feature === "escalation") {
        handleChange("escalationEnabled", true);
      } else if (feature === "autoLearn") {
        handleChange("autoLearnEnabled", true);
      }
      return;
    }

    // If disabling, show confirmation dialog
    // First, backup current values
    let backupValues: any = {};
    if (feature === "autoResponse") {
      backupValues = {
        confidenceThreshold: formData.confidenceThreshold,
        maxResponseLength: formData.maxResponseLength,
        responseTimeout: formData.responseTimeout,
      };
    } else if (feature === "escalation") {
      backupValues = {
        complexityThreshold: formData.complexityThreshold,
        escalationTeamId: formData.escalationTeamId,
        escalationDepartmentId: escalationDepartmentId,
      };
    } else if (feature === "autoLearn") {
      backupValues = {
        minResolutionScore: formData.minResolutionScore,
        articleApprovalRequired: formData.articleApprovalRequired,
      };
    }

    saveBackupToLocalStorage(feature, backupValues);

    // Disable the feature immediately (user can cancel to restore)
    if (feature === "autoResponse") {
      handleChange("autoResponseEnabled", false);
    } else if (feature === "escalation") {
      handleChange("escalationEnabled", false);
    } else if (feature === "autoLearn") {
      handleChange("autoLearnEnabled", false);
    }

    setConfirmationDialog({
      open: true,
      feature,
      action: null,
    });
  };

  // Handle confirmation dialog actions
  const handleConfirmationAction = (action: "reset" | "keep" | "cancel") => {
    if (!confirmationDialog.feature) return;

    if (action === "cancel") {
      // Restore toggle to enabled state and restore values from backup
      const backup = getBackupFromLocalStorage(confirmationDialog.feature);

      if (confirmationDialog.feature === "autoResponse") {
        handleChange("autoResponseEnabled", true);
        if (backup) {
          setFormData((prev) => ({
            ...prev,
            confidenceThreshold: backup.confidenceThreshold,
            maxResponseLength: backup.maxResponseLength,
            responseTimeout: backup.responseTimeout,
          }));
        }
      } else if (confirmationDialog.feature === "escalation") {
        handleChange("escalationEnabled", true);
        if (backup) {
          setFormData((prev) => ({
            ...prev,
            complexityThreshold: backup.complexityThreshold,
            escalationTeamId: backup.escalationTeamId,
          }));
          if (backup.escalationDepartmentId) {
            setEscalationDepartmentId(backup.escalationDepartmentId);
          }
        }
      } else if (confirmationDialog.feature === "autoLearn") {
        handleChange("autoLearnEnabled", true);
        if (backup) {
          setFormData((prev) => ({
            ...prev,
            minResolutionScore: backup.minResolutionScore,
            articleApprovalRequired: backup.articleApprovalRequired,
          }));
        }
      }
      clearBackupFromLocalStorage(confirmationDialog.feature);
    } else if (action === "reset") {
      // Mark feature for reset on save
      setFeaturesToReset((prev) => ({
        ...prev,
        [confirmationDialog.feature!]: true,
      }));
      // Toggle is already disabled by handleFeatureToggle
    } else if (action === "keep") {
      // Keep current values, don't reset
      setFeaturesToReset((prev) => {
        const updated = { ...prev };
        delete updated[confirmationDialog.feature!];
        return updated;
      });
      // Toggle is already disabled by handleFeatureToggle
    }

    setConfirmationDialog({ open: false, feature: null, action: null });
  };

  const handleSave = async () => {
    // Create a copy of formData to modify
    let dataToSave = { ...formData };

    // Reset values for disabled features that are marked for reset
    if (featuresToReset.autoResponse && !dataToSave.autoResponseEnabled) {
      dataToSave.confidenceThreshold =
        DEFAULT_VALUES.autoResponse.confidenceThreshold;
      dataToSave.maxResponseLength =
        DEFAULT_VALUES.autoResponse.maxResponseLength;
      dataToSave.responseTimeout = DEFAULT_VALUES.autoResponse.responseTimeout;
      clearBackupFromLocalStorage("autoResponse");
    }

    if (featuresToReset.escalation && !dataToSave.escalationEnabled) {
      dataToSave.complexityThreshold =
        DEFAULT_VALUES.escalation.complexityThreshold;
      dataToSave.escalationTeamId = DEFAULT_VALUES.escalation.escalationTeamId;
      setEscalationDepartmentId(undefined);
      clearBackupFromLocalStorage("escalation");
    }

    if (featuresToReset.autoLearn && !dataToSave.autoLearnEnabled) {
      dataToSave.minResolutionScore =
        DEFAULT_VALUES.autoLearn.minResolutionScore;
      dataToSave.articleApprovalRequired =
        DEFAULT_VALUES.autoLearn.articleApprovalRequired;
      clearBackupFromLocalStorage("autoLearn");
    }

    // Clear reset tracking
    setFeaturesToReset({});

    await updateSettings.mutateAsync(dataToSave);
  };

  const handleBedrockChange = (field: string, value: any) => {
    setBedrockSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveBedrockSettings = async () => {
    await updateBedrockSettings.mutateAsync(bedrockSettings);
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    await testConnection.mutateAsync();
    setTestingConnection(false);
  };

  const handleSaveCostLimits = () => {
    updateCostLimitsMutation.mutate(costLimits);
  };

  // Rate limit presets
  type RatePreset = "Strict" | "Balanced" | "Generous" | "Custom";
  const [ratePreset, setRatePreset] = useState<RatePreset>("Balanced");
  const applyPreset = (preset: RatePreset) => {
    setRatePreset(preset);
    if (preset === "Strict") {
      setFormData((p) => ({
        ...p,
        maxRequestsPerMinute: 10,
        maxRequestsPerHour: 100,
        maxRequestsPerDay: 500,
      }));
      // Apply free-tier cost limits alongside rate limits
      setCostLimits((c) => ({
        ...c,
        dailyLimitUSD: 1,
        monthlyLimitUSD: 10,
        maxTokensPerRequest: 1000,
      }));
    } else if (preset === "Balanced") {
      setFormData((p) => ({
        ...p,
        maxRequestsPerMinute: 20,
        maxRequestsPerHour: 0,
        maxRequestsPerDay: 1000,
      }));
      setCostLimits((c) => ({
        ...c,
        dailyLimitUSD: 2,
        monthlyLimitUSD: 15,
        maxTokensPerRequest: 2000,
      }));
    } else if (preset === "Generous") {
      setFormData((p) => ({
        ...p,
        maxRequestsPerMinute: 60,
        maxRequestsPerHour: 600,
        maxRequestsPerDay: 5000,
      }));
      setCostLimits((c) => ({
        ...c,
        dailyLimitUSD: 3,
        monthlyLimitUSD: 25,
        maxTokensPerRequest: 3000,
      }));
    }
  };

  // Inline validation for rate limits
  const [rateErrors, setRateErrors] = useState<{
    minute?: string;
    hour?: string;
    day?: string;
    relation?: string;
  }>({});

  useEffect(() => {
    const errs: typeof rateErrors = {};
    if (
      formData.maxRequestsPerMinute < 1 ||
      formData.maxRequestsPerMinute > 100
    ) {
      errs.minute = "Must be between 1 and 100";
    }
    if (
      formData.maxRequestsPerHour !== 0 &&
      (formData.maxRequestsPerHour < 1 || formData.maxRequestsPerHour > 2000)
    ) {
      errs.hour = "Must be 0 (disabled) or between 1 and 2000";
    }
    if (formData.maxRequestsPerDay < 10 || formData.maxRequestsPerDay > 10000) {
      errs.day = "Must be between 10 and 10000";
    }
    // Relationship hints
    if (formData.maxRequestsPerHour > 0) {
      const minToHour = formData.maxRequestsPerMinute * 60;
      if (formData.maxRequestsPerHour < minToHour) {
        errs.relation =
          "Hourly cap is lower than 60× per-minute; it may never be reached.";
      } else if (formData.maxRequestsPerHour > formData.maxRequestsPerDay) {
        errs.relation =
          "Hourly cap exceeds daily cap; hourly limit may be redundant.";
      }
    } else if (
      formData.maxRequestsPerMinute * 60 >
      formData.maxRequestsPerDay
    ) {
      errs.relation =
        "Per-minute × 60 exceeds daily cap; requests may be throttled before hourly/day windows.";
    }
    setRateErrors(errs);
  }, [
    formData.maxRequestsPerMinute,
    formData.maxRequestsPerHour,
    formData.maxRequestsPerDay,
  ]);

  const isRateField = (k: keyof AISettings) =>
    k === "maxRequestsPerMinute" ||
    k === "maxRequestsPerHour" ||
    k === "maxRequestsPerDay";

  // Workflow (Auto-Response, Escalation, Learning) edit management
  const [isEditingWorkflow, setIsEditingWorkflow] = useState(false);
  const [workflowSnapshot, setWorkflowSnapshot] =
    useState<Partial<AISettings> | null>(null);
  const workflowFields: (keyof AISettings)[] = [
    "autoResponseEnabled",
    "confidenceThreshold",
    "maxResponseLength",
    "responseTimeout",
    "escalationEnabled",
    "complexityThreshold",
    "escalationTeamId",
    "autoLearnEnabled",
    "minResolutionScore",
    "articleApprovalRequired",
  ];
  const isWorkflowDirty = (() => {
    if (!workflowSnapshot) return false;
    return workflowFields.some(
      (k) => (formData as any)[k] !== (workflowSnapshot as any)[k]
    );
  })();

  // Confirmation dialog state for feature disabling
  const [confirmationDialog, setConfirmationDialog] = useState<{
    open: boolean;
    feature: "autoResponse" | "escalation" | "autoLearn" | null;
    action: "reset" | "keep" | null;
  }>({
    open: false,
    feature: null,
    action: null,
  });

  // Track which features should be reset to defaults on save
  const [featuresToReset, setFeaturesToReset] = useState<{
    autoResponse?: boolean;
    escalation?: boolean;
    autoLearn?: boolean;
  }>({});

  // Default values
  const DEFAULT_VALUES = {
    autoResponse: {
      confidenceThreshold: 0.7,
      maxResponseLength: 1000,
      responseTimeout: 30,
    },
    escalation: {
      complexityThreshold: 70,
      escalationTeamId: undefined,
    },
    autoLearn: {
      minResolutionScore: 0.8,
      articleApprovalRequired: true,
    },
  };

  const getConfidenceLabel = (value: number) => {
    if (value >= 0.8) return "High (80%+)";
    if (value >= 0.6) return "Medium (60%+)";
    if (value >= 0.4) return "Low (40%+)";
    return "Very Low";
  };

  const getComplexityLabel = (value: number) => {
    if (value >= 80) return "Very Complex (80+)";
    if (value >= 60) return "Complex (60+)";
    if (value >= 40) return "Moderate (40+)";
    return "Simple";
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <Brain className="h-8 w-8 animate-pulse mx-auto mb-4" />
            <p>Loading AI settings...</p>
          </div>
        </div>
      </div>
    );
  }

  const bedrockConfigured = (bedrockData as any)?.hasBedrockSecret || false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <p className="text-muted-foreground">
            Configure AI-powered features and thresholds for the help-desk
            system
          </p>
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-10">
        {/* AWS Bedrock Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <Label className="text-lg font-medium">
                AWS Bedrock Configuration
              </Label>
            </CardTitle>
            <CardDescription>
              Configure AWS Bedrock credentials and model settings for AI
              features
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!bedrockConfigured && (
              <Alert variant="destructive">
                <AlertTitle>AWS Bedrock not configured</AlertTitle>
                <AlertDescription>
                  Add credentials to enable AI features. Rate limits will not be
                  exercised until configured.
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-2">
                <Label htmlFor="bedrockAccessKeyId">AWS Access Key ID</Label>
                <Input
                  id="bedrockAccessKeyId"
                  type="text"
                  value={bedrockSettings.bedrockAccessKeyId}
                  onChange={(e) =>
                    handleBedrockChange("bedrockAccessKeyId", e.target.value)
                  }
                  placeholder="AKIA..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bedrockSecretAccessKey">
                  AWS Secret Access Key
                </Label>
                <Input
                  id="bedrockSecretAccessKey"
                  type="password"
                  value={bedrockSettings.bedrockSecretAccessKey}
                  onChange={(e) =>
                    handleBedrockChange(
                      "bedrockSecretAccessKey",
                      e.target.value
                    )
                  }
                  placeholder="Enter secret key..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-2">
                <Label htmlFor="bedrockRegion">AWS Region</Label>
                <Select
                  value={bedrockSettings.bedrockRegion}
                  onValueChange={(value) =>
                    handleBedrockChange("bedrockRegion", value)
                  }
                >
                  <SelectTrigger id="bedrockRegion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us-east-1">
                      US East (N. Virginia)
                    </SelectItem>
                    <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                    <SelectItem value="eu-central-1">
                      Europe (Frankfurt)
                    </SelectItem>
                    <SelectItem value="ap-southeast-1">
                      Asia Pacific (Singapore)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bedrockModelId">Bedrock Model</Label>
                <Select
                  value={bedrockSettings.bedrockModelId}
                  onValueChange={(value) =>
                    handleBedrockChange("bedrockModelId", value)
                  }
                >
                  <SelectTrigger id="bedrockModelId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amazon.titan-text-express-v1">
                      Amazon Titan Text Express (Recommended)
                    </SelectItem>
                    <SelectItem value="amazon.titan-text-lite-v1">
                      Amazon Titan Text Lite (Fast & Affordable)
                    </SelectItem>
                    <SelectItem value="ai21.j2-mid-v1">
                      AI21 Jurassic Mid (Balanced)
                    </SelectItem>
                    <SelectItem value="ai21.j2-ultra-v1">
                      AI21 Jurassic Ultra (Advanced)
                    </SelectItem>
                    <SelectItem value="meta.llama2-13b-chat-v1">
                      Meta Llama 2 13B (Open Source)
                    </SelectItem>
                    <SelectItem value="meta.llama2-70b-chat-v1">
                      Meta Llama 2 70B (Large)
                    </SelectItem>
                    <SelectItem value="meta.llama3-8b-instruct-v1:0">
                      Meta Llama 3 8B (Latest)
                    </SelectItem>
                    <SelectItem value="meta.llama3-70b-instruct-v1:0">
                      Meta Llama 3 70B (Latest Large)
                    </SelectItem>
                    <SelectItem value="anthropic.claude-3-sonnet-20240229-v1:0">
                      Claude 3 Sonnet (Limited Regions)
                    </SelectItem>
                    <SelectItem value="anthropic.claude-3-haiku-20240307-v1:0">
                      Claude 3 Haiku (Limited Regions)
                    </SelectItem>
                    <SelectItem value="anthropic.claude-3-opus-20240229-v1:0">
                      Claude 3 Opus (Limited Regions)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-2">
                <Label>Temperature</Label>
                <p className="text-sm text-muted-foreground">
                  Controls randomness (0 = focused, 1 = creative)
                </p>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[formData.temperature]}
                    onValueChange={([value]) =>
                      handleChange("temperature", value)
                    }
                    min={0}
                    max={1}
                    step={0.1}
                    className="flex-1"
                  />
                  <span className="w-12 text-right font-medium">
                    {formData.temperature.toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxTokens">Max Tokens (model output)</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  value={formData.maxTokens}
                  onChange={(e) =>
                    handleChange("maxTokens", parseInt(e.target.value))
                  }
                  min={100}
                  max={4000}
                  step={100}
                />
                <p className="text-xs text-muted-foreground">
                  Upper bound for AI response length.
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center gap-5">
            <Button
              onClick={handleSaveBedrockSettings}
              disabled={updateBedrockSettings.isPending}
            >
              <Save className="h-4 w-4" />
              Save Bedrock Settings
            </Button>
            <Button
              onClick={handleTestConnection}
              disabled={testingConnection}
              variant="outline"
            >
              <RefreshCw
                className={cn("h-4 w-4", testingConnection && "animate-spin")}
              />
              Test Connection
            </Button>
          </CardFooter>
        </Card>

        {/* Cost Limits Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              <Label className="text-lg font-medium">
                Cost Limits Configuration
              </Label>
            </CardTitle>
            <CardDescription>
              Configure cost limits to prevent unexpected AWS Bedrock charges
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-10">
              <div className="space-y-2">
                <Label htmlFor="dailyLimit">Daily Limit (USD)</Label>
                <Input
                  id="dailyLimit"
                  type="number"
                  step="0.01"
                  value={costLimits.dailyLimitUSD || ""}
                  onChange={(e) =>
                    setCostLimits((prev) => ({
                      ...prev,
                      dailyLimitUSD: parseFloat(e.target.value) || 0,
                    }))
                  }
                  disabled={
                    !isEditingCostLimits || costLimits.isFreeTierAccount
                  }
                />
                {costLimits.isFreeTierAccount && (
                  <p className="text-xs text-muted-foreground">
                    Managed by Free Tier policy
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="monthlyLimit">Monthly Limit (USD)</Label>
                <Input
                  id="monthlyLimit"
                  type="number"
                  step="0.01"
                  value={costLimits.monthlyLimitUSD || ""}
                  onChange={(e) =>
                    setCostLimits((prev) => ({
                      ...prev,
                      monthlyLimitUSD: parseFloat(e.target.value) || 0,
                    }))
                  }
                  disabled={
                    !isEditingCostLimits || costLimits.isFreeTierAccount
                  }
                />
                {costLimits.isFreeTierAccount && (
                  <p className="text-xs text-muted-foreground">
                    Managed by Free Tier policy
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxTokens">
                  Max Tokens per Request (budget)
                </Label>
                <Input
                  id="maxTokens"
                  type="number"
                  value={costLimits.maxTokensPerRequest || ""}
                  onChange={(e) =>
                    setCostLimits((prev) => ({
                      ...prev,
                      maxTokensPerRequest: parseInt(e.target.value) || 0,
                    }))
                  }
                  disabled={
                    !isEditingCostLimits || costLimits.isFreeTierAccount
                  }
                />
                {costLimits.isFreeTierAccount && (
                  <p className="text-xs text-muted-foreground">
                    Managed by Free Tier policy
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="freeTier">Free Tier Account</Label>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="freeTier"
                    checked={costLimits.isFreeTierAccount || false}
                    onCheckedChange={(checked) => {
                      setCostLimits((prev) => ({
                        ...prev,
                        isFreeTierAccount: checked,
                      }));
                      if (checked) {
                        // Apply strict preset immediately when enabling strict controls
                        applyPreset("Strict");
                        setIsEditingCostLimits(false);
                      }
                    }}
                    disabled={!isEditingCostLimits}
                  />
                  <span className="text-sm text-muted-foreground">
                    Enable strict cost controls
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-10">
              <div className="space-y-2">
                <Label htmlFor="ratePreset">Policy Preset</Label>
                <Select
                  value={ratePreset}
                  onValueChange={(v) => applyPreset(v as any)}
                >
                  <SelectTrigger id="ratePreset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Strict">Strict</SelectItem>
                    <SelectItem value="Balanced">Balanced</SelectItem>
                    <SelectItem value="Generous">Generous</SelectItem>
                    {!costLimits.isFreeTierAccount && (
                      <SelectItem value="Custom">Custom</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    Presets fill minute/hour/day. Any manual change switches to
                    Custom.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      applyPreset("Balanced");
                      setIsEditingCostLimits(true);
                    }}
                    className="text-xs"
                  >
                    Reset to defaults
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxRequestsPerMinute">
                  Max Requests per Minute
                </Label>
                <Input
                  id="maxRequestsPerMinute"
                  type="number"
                  value={formData.maxRequestsPerMinute}
                  onChange={(e) =>
                    handleChange(
                      "maxRequestsPerMinute",
                      parseInt(e.target.value)
                    )
                  }
                  min={1}
                  max={100}
                  disabled={costLimits.isFreeTierAccount}
                />
                <p className="text-xs text-muted-foreground">
                  Protects against short spikes.
                </p>
                {rateErrors.minute && (
                  <p className="text-xs text-destructive">
                    {rateErrors.minute}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxRequestsPerHour">
                  Max Requests per Hour
                </Label>
                <div className="flex items-center gap-2">
                  <Switch
                    id="enableHourCap"
                    checked={!!formData.maxRequestsPerHour}
                    onCheckedChange={(checked) =>
                      handleChange("maxRequestsPerHour", checked ? 100 : 0)
                    }
                    disabled={costLimits.isFreeTierAccount}
                  />
                  <Input
                    id="maxRequestsPerHour"
                    type="number"
                    value={formData.maxRequestsPerHour || 0}
                    onChange={(e) =>
                      handleChange(
                        "maxRequestsPerHour",
                        parseInt(e.target.value)
                      )
                    }
                    min={0}
                    max={2000}
                    disabled={
                      !formData.maxRequestsPerHour ||
                      costLimits.isFreeTierAccount
                    }
                    className="max-w-[200px]"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Turn off to disable hourly cap
                </p>
                {rateErrors.hour && (
                  <p className="text-xs text-destructive">{rateErrors.hour}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxRequestsPerDay">Max Requests per Day</Label>
                <Input
                  id="maxRequestsPerDay"
                  type="number"
                  value={formData.maxRequestsPerDay}
                  onChange={(e) =>
                    handleChange("maxRequestsPerDay", parseInt(e.target.value))
                  }
                  min={10}
                  max={10000}
                  step={10}
                  disabled={costLimits.isFreeTierAccount}
                />
                <p className="text-xs text-muted-foreground">
                  Budget cap for the entire request (prompt + response).
                </p>
                {rateErrors.day && (
                  <p className="text-xs text-destructive">{rateErrors.day}</p>
                )}
              </div>
            </div>
            {rateErrors.relation && (
              <div className="text-xs text-amber-600 -mt-2">
                {rateErrors.relation}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex items-center gap-5">
            {!isEditingCostLimits ? (
              <Button onClick={() => setIsEditingCostLimits(true)}>
                <Settings className="h-3 w-3" />
                Edit Limits
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleSaveCostLimits}
                  disabled={updateCostLimitsMutation.isPending}
                >
                  <Save className="h-4 w-4" />
                  Save Limits
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsEditingCostLimits(false)}
                >
                  <XIcon className="h-4 w-4" />
                  Cancel
                </Button>
              </>
            )}
          </CardFooter>
        </Card>

        {/* AI Workflow: Auto-Response, Escalation, Learning */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="h-5 w-5" />
              <Label className="text-lg font-medium">
                AI Workflow: Auto-Response, Escalation, Learning
              </Label>
            </CardTitle>
            <CardDescription>
              Configure thresholds and behavior for the AI ticket workflow
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-10">
            {/* Auto-Response */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Auto-Response</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically generate responses for new tickets
                  </p>
                </div>
                <Switch
                  checked={formData.autoResponseEnabled}
                  onCheckedChange={(checked) =>
                    handleFeatureToggle("autoResponse", checked)
                  }
                  disabled={!isEditingWorkflow}
                />
              </div>

              <div className="space-y-2">
                <Label>Confidence Threshold</Label>
                <p className="text-sm text-muted-foreground">
                  Minimum confidence score required to apply auto-response
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[formData.confidenceThreshold]}
                    onValueChange={([value]) =>
                      handleChange("confidenceThreshold", value)
                    }
                    min={0}
                    max={1}
                    step={0.1}
                    className="flex-1"
                    disabled={!isEditingWorkflow}
                  />
                  <div className="w-32 text-right">
                    <span className="font-medium">
                      {(formData.confidenceThreshold * 100).toFixed(0)}%
                    </span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {getConfidenceLabel(formData.confidenceThreshold)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxResponseLength">Max Response Length</Label>
                  <Input
                    id="maxResponseLength"
                    type="number"
                    value={formData.maxResponseLength}
                    onChange={(e) =>
                      handleChange(
                        "maxResponseLength",
                        parseInt(e.target.value)
                      )
                    }
                    min={100}
                    max={5000}
                    disabled={!isEditingWorkflow}
                  />
                  <p className="text-xs text-muted-foreground">Characters</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="responseTimeout">Response Timeout</Label>
                  <Input
                    id="responseTimeout"
                    type="number"
                    value={formData.responseTimeout}
                    onChange={(e) =>
                      handleChange("responseTimeout", parseInt(e.target.value))
                    }
                    min={5}
                    max={120}
                    disabled={!isEditingWorkflow}
                  />
                  <p className="text-xs text-muted-foreground">Seconds</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Escalation */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Auto-Escalation</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically escalate complex tickets
                  </p>
                </div>
                <Switch
                  checked={formData.escalationEnabled}
                  onCheckedChange={(checked) =>
                    handleFeatureToggle("escalation", checked)
                  }
                  disabled={!isEditingWorkflow}
                />
              </div>

              <div className="space-y-2">
                <Label>Complexity Threshold</Label>
                <p className="text-sm text-muted-foreground">
                  Tickets above this complexity score will be escalated
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[formData.complexityThreshold]}
                    onValueChange={([value]) =>
                      handleChange("complexityThreshold", value)
                    }
                    min={0}
                    max={100}
                    step={10}
                    className="flex-1"
                    disabled={!isEditingWorkflow}
                  />
                  <div className="w-32 text-right">
                    <span className="font-medium">
                      {formData.complexityThreshold}
                    </span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {getComplexityLabel(formData.complexityThreshold)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="escalationDepartment">
                  Select team for escalations
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Department Selection */}
                  <Select
                    value={escalationDepartmentId?.toString() || ""}
                    onValueChange={(value) => {
                      const deptId = value ? parseInt(value) : undefined;
                      setEscalationDepartmentId(deptId);
                      // Clear team selection when department changes
                      handleChange("escalationTeamId", undefined);
                    }}
                    disabled={!isEditingWorkflow}
                  >
                    <SelectTrigger id="escalationDepartment">
                      <SelectValue placeholder="Select department for escalations" />
                    </SelectTrigger>
                    <SelectContent>
                      {(departments as any)?.map((dept: any) => (
                        <SelectItem key={dept.id} value={dept.id.toString()}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Team Selection */}
                  <Select
                    value={formData.escalationTeamId?.toString() || ""}
                    onValueChange={(value) =>
                      handleChange(
                        "escalationTeamId",
                        value ? parseInt(value) : undefined
                      )
                    }
                    disabled={!isEditingWorkflow || !escalationDepartmentId}
                  >
                    <SelectTrigger id="escalationTeam">
                      <SelectValue
                        placeholder={
                          !escalationDepartmentId
                            ? "Select department first"
                            : departmentTeams && departmentTeams.length > 0
                            ? "Select team"
                            : "No teams available"
                        }
                      />
                    </SelectTrigger>
                    {departmentTeams && departmentTeams.length > 0 && (
                      <SelectContent>
                        {departmentTeams.map((team: any) => (
                          <SelectItem key={team.id} value={team.id.toString()}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    )}
                  </Select>
                  {escalationDepartmentId && departmentTeams?.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      This department has no teams. Please create a team first.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Knowledge Learning */}
            <div className="space-y-4 col-span-1 md:col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Auto-Learning</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically create knowledge articles from resolved
                    tickets
                  </p>
                </div>
                <Switch
                  checked={formData.autoLearnEnabled}
                  onCheckedChange={(checked) =>
                    handleFeatureToggle("autoLearn", checked)
                  }
                  disabled={!isEditingWorkflow}
                />
              </div>

              <div className="space-y-2">
                <Label>Minimum Resolution Score</Label>
                <p className="text-sm text-muted-foreground">
                  Only learn from tickets with high resolution quality
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[formData.minResolutionScore]}
                    onValueChange={([value]) =>
                      handleChange("minResolutionScore", value)
                    }
                    min={0}
                    max={1}
                    step={0.1}
                    className="flex-1"
                    disabled={!isEditingWorkflow}
                  />
                  <div className="w-24 text-right">
                    <span className="font-medium">
                      {(formData.minResolutionScore * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Require Article Approval</Label>
                  <p className="text-sm text-muted-foreground">
                    Knowledge articles need manual approval before publishing
                  </p>
                </div>
                <Switch
                  checked={formData.articleApprovalRequired}
                  onCheckedChange={(checked) =>
                    handleChange("articleApprovalRequired", checked)
                  }
                  disabled={!isEditingWorkflow}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex items-center gap-10">
            {isWorkflowDirty && (
              <p className="flex items-center gap-2 ext-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                You have unsaved workflow changes
              </p>
            )}

            <div className="flex items-center gap-5">
              {!isEditingWorkflow ? (
                <Button
                  variant="default"
                  onClick={() => {
                    setWorkflowSnapshot(
                      workflowFields.reduce((acc, k) => {
                        (acc as any)[k] = (formData as any)[k];
                        return acc;
                      }, {} as Partial<AISettings>)
                    );
                    setIsEditingWorkflow(true);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit AI Workflow
                </Button>
              ) : (
                <>
                  <Button
                    onClick={async () => {
                      await handleSave();
                      setIsEditingWorkflow(false);
                      setWorkflowSnapshot(null);
                    }}
                    disabled={!isWorkflowDirty || updateSettings.isPending}
                  >
                    <Save className="h-4 w-4" />
                    Save Workflow
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Restore from workflow snapshot
                      if (workflowSnapshot) {
                        const restored: any = { ...formData };
                        workflowFields.forEach((k) => {
                          (restored as any)[k] = (workflowSnapshot as any)[k];
                        });
                        setFormData(restored);
                      }

                      // Restore from localStorage backups if available
                      const autoResponseBackup =
                        getBackupFromLocalStorage("autoResponse");
                      if (autoResponseBackup) {
                        setFormData((prev) => ({
                          ...prev,
                          confidenceThreshold:
                            autoResponseBackup.confidenceThreshold,
                          maxResponseLength:
                            autoResponseBackup.maxResponseLength,
                          responseTimeout: autoResponseBackup.responseTimeout,
                        }));
                        clearBackupFromLocalStorage("autoResponse");
                      }

                      const escalationBackup =
                        getBackupFromLocalStorage("escalation");
                      if (escalationBackup) {
                        setFormData((prev) => ({
                          ...prev,
                          complexityThreshold:
                            escalationBackup.complexityThreshold,
                          escalationTeamId: escalationBackup.escalationTeamId,
                        }));
                        if (escalationBackup.escalationDepartmentId) {
                          setEscalationDepartmentId(
                            escalationBackup.escalationDepartmentId
                          );
                        }
                        clearBackupFromLocalStorage("escalation");
                      }

                      const autoLearnBackup =
                        getBackupFromLocalStorage("autoLearn");
                      if (autoLearnBackup) {
                        setFormData((prev) => ({
                          ...prev,
                          minResolutionScore:
                            autoLearnBackup.minResolutionScore,
                          articleApprovalRequired:
                            autoLearnBackup.articleApprovalRequired,
                        }));
                        clearBackupFromLocalStorage("autoLearn");
                      }

                      // Clear reset tracking
                      setFeaturesToReset({});
                      setIsEditingWorkflow(false);
                      setWorkflowSnapshot(null);
                    }}
                  >
                    <XIcon className="h-4 w-4" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </CardFooter>
        </Card>
      </CardContent>

      {/* Confirmation Dialog for Feature Disabling */}
      <AlertDialog
        open={confirmationDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            // If dialog is closed without action, treat as cancel
            handleConfirmationAction("cancel");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disable{" "}
              {confirmationDialog.feature === "autoResponse"
                ? "Auto-Response"
                : confirmationDialog.feature === "escalation"
                ? "Auto-Escalation"
                : "Auto-Learning"}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              {confirmationDialog.feature === "autoResponse" && (
                <>
                  <p>
                    Disabling Auto-Response will reset the following settings to
                    defaults when you save:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Confidence Threshold: 70%</li>
                    <li>Max Response Length: 1000 characters</li>
                    <li>Response Timeout: 30 seconds</li>
                  </ul>
                </>
              )}
              {confirmationDialog.feature === "escalation" && (
                <>
                  <p>
                    Disabling Auto-Escalation will reset the following settings
                    to defaults when you save:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Complexity Threshold: 70</li>
                    <li>Escalation Team: (cleared)</li>
                  </ul>
                </>
              )}
              {confirmationDialog.feature === "autoLearn" && (
                <>
                  <p>
                    Disabling Auto-Learning will reset the following settings to
                    defaults when you save:
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Minimum Resolution Score: 80%</li>
                    <li>Article Approval Required: Yes</li>
                  </ul>
                </>
              )}
              <Separator className="my-3" />
              <p>
                Your current values will be saved locally and can be restored if
                you cancel.
              </p>
              <p className="font-medium">What would you like to do?</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => handleConfirmationAction("cancel")}
            >
              Cancel
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => handleConfirmationAction("keep")}
            >
              Keep Current Values
            </Button>
            <AlertDialogAction
              onClick={() => handleConfirmationAction("reset")}
            >
              Reset to Defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
