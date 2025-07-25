import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  maxRequestsPerDay: number;
}

export default function AISettings() {
  const { toast } = useToast();
  const [hasChanges, setHasChanges] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  
  // Fetch current settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/admin/ai-settings"],
  });

  // Fetch teams for escalation
  const { data: teams } = useQuery({
    queryKey: ["/api/teams"],
  });

  // Fetch API key status
  const { data: apiKeys } = useQuery({
    queryKey: ["/api/admin/api-keys"],
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
    bedrockModel: "anthropic.claude-3-sonnet-20240229-v1:0",
    temperature: 0.3,
    maxTokens: 2000,
    maxRequestsPerMinute: 20,
    maxRequestsPerDay: 1000,
  });

  // Load settings when data is fetched
  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

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

  // Test Bedrock connection
  const testConnection = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-settings/test");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Connection successful",
        description: "AWS Bedrock is properly configured and accessible.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Connection failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleChange = (key: keyof AISettings, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    await updateSettings.mutateAsync(formData);
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    await testConnection.mutateAsync();
    setTestingConnection(false);
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
      <Layout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <Brain className="h-8 w-8 animate-pulse mx-auto mb-4" />
            <p>Loading AI settings...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const bedrockConfigured = apiKeys?.bedrock?.configured;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Brain className="h-8 w-8" />
              AI Settings
            </h1>
            <p className="text-muted-foreground">
              Configure AI-powered features and thresholds for the helpdesk system
            </p>
          </div>
          <Button 
            onClick={handleSave} 
            disabled={!hasChanges || updateSettings.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            Save Changes
          </Button>
        </div>

        {/* AWS Bedrock Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              AWS Bedrock Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bedrockConfigured ? (
              <Alert className="mb-4">
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>Bedrock Configured</AlertTitle>
                <AlertDescription>
                  AWS Bedrock is properly configured and ready to use.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Bedrock Not Configured</AlertTitle>
                <AlertDescription>
                  Please configure AWS Bedrock credentials in the Admin Panel → API Keys section.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex items-center gap-2">
              <Button
                onClick={handleTestConnection}
                disabled={!bedrockConfigured || testingConnection}
                variant={bedrockConfigured ? "default" : "secondary"}
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", testingConnection && "animate-spin")} />
                Test Connection
              </Button>
              <span className="text-sm text-muted-foreground">
                Test the connection to AWS Bedrock
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Auto-Response Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Auto-Response Configuration
            </CardTitle>
            <CardDescription>
              Configure how AI automatically responds to tickets
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Auto-Response</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically generate responses for new tickets
                </p>
              </div>
              <Switch
                checked={formData.autoResponseEnabled}
                onCheckedChange={(checked) => handleChange("autoResponseEnabled", checked)}
              />
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Confidence Threshold</Label>
                <p className="text-sm text-muted-foreground">
                  Minimum confidence score required to apply auto-response
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[formData.confidenceThreshold]}
                    onValueChange={([value]) => handleChange("confidenceThreshold", value)}
                    min={0}
                    max={1}
                    step={0.1}
                    className="flex-1"
                  />
                  <div className="w-32 text-right">
                    <span className="font-medium">{(formData.confidenceThreshold * 100).toFixed(0)}%</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {getConfidenceLabel(formData.confidenceThreshold)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="maxResponseLength">Max Response Length</Label>
                  <Input
                    id="maxResponseLength"
                    type="number"
                    value={formData.maxResponseLength}
                    onChange={(e) => handleChange("maxResponseLength", parseInt(e.target.value))}
                    min={100}
                    max={5000}
                  />
                  <p className="text-xs text-muted-foreground">Characters</p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="responseTimeout">Response Timeout</Label>
                  <Input
                    id="responseTimeout"
                    type="number"
                    value={formData.responseTimeout}
                    onChange={(e) => handleChange("responseTimeout", parseInt(e.target.value))}
                    min={5}
                    max={120}
                  />
                  <p className="text-xs text-muted-foreground">Seconds</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Base Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Knowledge Base Learning
            </CardTitle>
            <CardDescription>
              Configure how AI learns from resolved tickets
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Auto-Learning</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically create knowledge articles from resolved tickets
                </p>
              </div>
              <Switch
                checked={formData.autoLearnEnabled}
                onCheckedChange={(checked) => handleChange("autoLearnEnabled", checked)}
              />
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Minimum Resolution Score</Label>
                <p className="text-sm text-muted-foreground">
                  Only learn from tickets with high resolution quality
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[formData.minResolutionScore]}
                    onValueChange={([value]) => handleChange("minResolutionScore", value)}
                    min={0}
                    max={1}
                    step={0.1}
                    className="flex-1"
                  />
                  <div className="w-24 text-right">
                    <span className="font-medium">{(formData.minResolutionScore * 100).toFixed(0)}%</span>
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
                  onCheckedChange={(checked) => handleChange("articleApprovalRequired", checked)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Escalation Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Escalation Configuration
            </CardTitle>
            <CardDescription>
              Configure when tickets should be escalated to human agents
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Auto-Escalation</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically escalate complex tickets
                </p>
              </div>
              <Switch
                checked={formData.escalationEnabled}
                onCheckedChange={(checked) => handleChange("escalationEnabled", checked)}
              />
            </div>
            
            <Separator />
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Complexity Threshold</Label>
                <p className="text-sm text-muted-foreground">
                  Tickets above this complexity score will be escalated
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[formData.complexityThreshold]}
                    onValueChange={([value]) => handleChange("complexityThreshold", value)}
                    min={0}
                    max={100}
                    step={10}
                    className="flex-1"
                  />
                  <div className="w-32 text-right">
                    <span className="font-medium">{formData.complexityThreshold}</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      {getComplexityLabel(formData.complexityThreshold)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="escalationTeam">Escalation Team</Label>
                <Select
                  value={formData.escalationTeamId?.toString() || ""}
                  onValueChange={(value) => handleChange("escalationTeamId", value ? parseInt(value) : undefined)}
                >
                  <SelectTrigger id="escalationTeam">
                    <SelectValue placeholder="Select team for escalations" />
                  </SelectTrigger>
                  <SelectContent>
                    {teams?.map((team: any) => (
                      <SelectItem key={team.id} value={team.id.toString()}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Model Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sliders className="h-5 w-5" />
              Model Configuration
            </CardTitle>
            <CardDescription>
              Configure AI model parameters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bedrockModel">Bedrock Model</Label>
              <Select
                value={formData.bedrockModel}
                onValueChange={(value) => handleChange("bedrockModel", value)}
              >
                <SelectTrigger id="bedrockModel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic.claude-3-sonnet-20240229-v1:0">
                    Claude 3 Sonnet
                  </SelectItem>
                  <SelectItem value="anthropic.claude-3-haiku-20240307-v1:0">
                    Claude 3 Haiku (Faster, Lower Cost)
                  </SelectItem>
                  <SelectItem value="anthropic.claude-3-opus-20240229-v1:0">
                    Claude 3 Opus (More Capable, Higher Cost)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Temperature</Label>
                <p className="text-sm text-muted-foreground">
                  Controls randomness (0 = focused, 1 = creative)
                </p>
                <div className="flex items-center gap-2">
                  <Slider
                    value={[formData.temperature]}
                    onValueChange={([value]) => handleChange("temperature", value)}
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
                <Label htmlFor="maxTokens">Max Tokens</Label>
                <Input
                  id="maxTokens"
                  type="number"
                  value={formData.maxTokens}
                  onChange={(e) => handleChange("maxTokens", parseInt(e.target.value))}
                  min={100}
                  max={4000}
                  step={100}
                />
                <p className="text-xs text-muted-foreground">Maximum response length</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rate Limiting */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Rate Limiting
            </CardTitle>
            <CardDescription>
              Prevent excessive API usage and control costs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maxRequestsPerMinute">Max Requests per Minute</Label>
                <Input
                  id="maxRequestsPerMinute"
                  type="number"
                  value={formData.maxRequestsPerMinute}
                  onChange={(e) => handleChange("maxRequestsPerMinute", parseInt(e.target.value))}
                  min={1}
                  max={100}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="maxRequestsPerDay">Max Requests per Day</Label>
                <Input
                  id="maxRequestsPerDay"
                  type="number"
                  value={formData.maxRequestsPerDay}
                  onChange={(e) => handleChange("maxRequestsPerDay", parseInt(e.target.value))}
                  min={10}
                  max={10000}
                  step={10}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}