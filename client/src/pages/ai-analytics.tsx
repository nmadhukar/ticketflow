import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  Zap,
  Target,
  TrendingUp,
  Search,
  Play,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AIAnalyticsPage() {
  const { toast } = useToast();
  const [testTicket, setTestTicket] = useState({
    title: "",
    description: "",
    category: "support",
    priority: "medium",
  });

  // Get AI system status
  const { data: aiStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["/api/ai/status"],
    refetchInterval: 30000, // Check every 30 seconds
  });

  // Test ticket analysis mutation
  const analyzeTicketMutation = useMutation({
    mutationFn: async (ticketData: any) => {
      const response = await apiRequest(
        "POST",
        "/api/ai/analyze-ticket",
        ticketData
      );
      return response.json();
    },
    onSuccess: (analysis) => {
      toast({
        title: "Analysis Complete",
        description: `Ticket analyzed with ${analysis.confidence}% confidence`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Generate response mutation
  const generateResponseMutation = useMutation({
    mutationFn: async ({ ticketData, analysis }: any) => {
      const response = await apiRequest("POST", "/api/ai/generate-response", {
        ...ticketData,
        analysis,
      });
      return response.json();
    },
    onSuccess: (autoResponse) => {
      toast({
        title: "Response Generated",
        description: `Auto-response created with ${autoResponse.confidence}% confidence`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Response Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Knowledge learning mutation
  const runKnowledgeLearningMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/ai/knowledge-learning/run"
      );
      return response.json();
    },
    onSuccess: (results) => {
      toast({
        title: "Knowledge Learning Complete",
        description: `Found ${results.patternsFound} patterns, created ${results.articlesCreated} articles`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Learning Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTestAnalysis = () => {
    if (!testTicket.title || !testTicket.description) {
      toast({
        title: "Missing Information",
        description: "Please provide both title and description",
        variant: "destructive",
      });
      return;
    }
    analyzeTicketMutation.mutate(testTicket);
  };

  const handleGenerateResponse = () => {
    if (!analyzeTicketMutation.data) {
      toast({
        title: "Analysis Required",
        description: "Please run ticket analysis first",
        variant: "destructive",
      });
      return;
    }
    generateResponseMutation.mutate({
      ticketData: testTicket,
      analysis: analyzeTicketMutation.data,
    });
  };

  if (statusLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <Brain className="h-8 w-8 animate-pulse mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Loading AI Analytics...</p>
          </div>
        </div>
      </div>
    );
  }

  const systemStatus = aiStatus?.awsCredentials ? "operational" : "unavailable";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <p className="text-muted-foreground">
            Test and monitor the AI-powered helpdesk features
          </p>

          <Badge
            variant={systemStatus === "operational" ? "default" : "destructive"}
            className="text-sm"
          >
            {systemStatus === "operational" ? (
              <>
                <CheckCircle className="h-4 w-4 mr-1" />
                AI System Online
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 mr-1" />
                AI System Offline
              </>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AWS Bedrock</CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aiStatus?.bedrockAvailable ? "Connected" : "Offline"}
            </div>
            <p className="text-xs text-muted-foreground">
              Claude 3 Sonnet Model
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Auto-Response</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aiStatus?.features?.autoResponse ? "Active" : "Disabled"}
            </div>
            <p className="text-xs text-muted-foreground">
              Intelligent ticket responses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Knowledge Learning
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aiStatus?.features?.knowledgeLearning ? "Running" : "Stopped"}
            </div>
            <p className="text-xs text-muted-foreground">
              Pattern extraction from tickets
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Smart Search</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aiStatus?.features?.intelligentSearch ? "Ready" : "Offline"}
            </div>
            <p className="text-xs text-muted-foreground">
              Semantic knowledge search
            </p>
          </CardContent>
        </Card>
      </CardContent>

      <CardContent>
        <Tabs defaultValue="analysis" className="space-y-4">
          <TabsList>
            <TabsTrigger value="analysis">Ticket Analysis</TabsTrigger>
            <TabsTrigger value="learning">Knowledge Learning</TabsTrigger>
            <TabsTrigger value="search">Smart Search</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Test Ticket Analysis
                </CardTitle>
                <CardDescription>
                  Test the AI analysis system with sample ticket data
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Ticket Title</Label>
                    <Input
                      id="title"
                      placeholder="e.g., Unable to login to account"
                      value={testTicket.title}
                      onChange={(e) =>
                        setTestTicket((prev) => ({
                          ...prev,
                          title: e.target.value,
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select
                      value={testTicket.category}
                      onValueChange={(value) =>
                        setTestTicket((prev) => ({ ...prev, category: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bug">Bug</SelectItem>
                        <SelectItem value="feature">Feature Request</SelectItem>
                        <SelectItem value="support">Support</SelectItem>
                        <SelectItem value="enhancement">Enhancement</SelectItem>
                        <SelectItem value="incident">Incident</SelectItem>
                        <SelectItem value="request">Request</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Describe the issue in detail..."
                    value={testTicket.description}
                    onChange={(e) =>
                      setTestTicket((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    rows={4}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleTestAnalysis}
                    disabled={
                      analyzeTicketMutation.isPending ||
                      !aiStatus?.features?.ticketAnalysis
                    }
                  >
                    <Brain className="h-4 w-4 mr-2" />
                    {analyzeTicketMutation.isPending
                      ? "Analyzing..."
                      : "Analyze Ticket"}
                  </Button>

                  <Button
                    onClick={handleGenerateResponse}
                    disabled={
                      generateResponseMutation.isPending ||
                      !analyzeTicketMutation.data ||
                      !aiStatus?.features?.autoResponse
                    }
                    variant="outline"
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    {generateResponseMutation.isPending
                      ? "Generating..."
                      : "Generate Response"}
                  </Button>
                </div>

                {/* Analysis Results */}
                {analyzeTicketMutation.data && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Analysis Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <strong>Complexity:</strong>
                          <Badge variant="outline" className="ml-2">
                            {analyzeTicketMutation.data.complexity}
                          </Badge>
                        </div>
                        <div>
                          <strong>Category:</strong>
                          <Badge variant="outline" className="ml-2">
                            {analyzeTicketMutation.data.category}
                          </Badge>
                        </div>
                        <div>
                          <strong>Priority:</strong>
                          <Badge variant="outline" className="ml-2">
                            {analyzeTicketMutation.data.priority}
                          </Badge>
                        </div>
                        <div>
                          <strong>Confidence:</strong>
                          <Badge variant="outline" className="ml-2">
                            {analyzeTicketMutation.data.confidence}%
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <strong>Estimated Resolution Time:</strong>{" "}
                        {analyzeTicketMutation.data.estimatedResolutionTime}{" "}
                        hours
                      </div>

                      <div>
                        <strong>Tags:</strong>{" "}
                        {analyzeTicketMutation.data.tags?.join(", ") || "None"}
                      </div>

                      <div>
                        <strong>AI Reasoning:</strong>
                        <p className="mt-1 text-muted-foreground">
                          {analyzeTicketMutation.data.reasoning}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Auto-Response Results */}
                {generateResponseMutation.data && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Generated Response
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-4">
                        <Badge variant="outline">
                          Confidence: {generateResponseMutation.data.confidence}
                          %
                        </Badge>
                        {generateResponseMutation.data.escalationNeeded && (
                          <Badge variant="destructive">Escalation Needed</Badge>
                        )}
                      </div>

                      <div className="bg-muted p-4 rounded-lg">
                        <h4 className="font-medium mb-2">Auto-Response:</h4>
                        <p className="whitespace-pre-wrap">
                          {generateResponseMutation.data.response}
                        </p>
                      </div>

                      {generateResponseMutation.data.followUpActions?.length >
                        0 && (
                        <div>
                          <h4 className="font-medium mb-2">
                            Follow-up Actions:
                          </h4>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {generateResponseMutation.data.followUpActions.map(
                              (action: string, index: number) => (
                                <li key={index}>{action}</li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="learning" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Knowledge Base Learning
                </CardTitle>
                <CardDescription>
                  Manually trigger the AI learning process to extract patterns
                  from resolved tickets
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  The knowledge learning system analyzes resolved tickets to
                  identify common patterns and automatically creates knowledge
                  base articles. This process normally runs every 24 hours but
                  can be triggered manually here.
                </p>

                <Button
                  onClick={() => runKnowledgeLearningMutation.mutate()}
                  disabled={
                    runKnowledgeLearningMutation.isPending ||
                    !aiStatus?.features?.knowledgeLearning
                  }
                  size="lg"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {runKnowledgeLearningMutation.isPending
                    ? "Learning..."
                    : "Run Knowledge Learning"}
                </Button>

                {runKnowledgeLearningMutation.data && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Learning Results
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-blue-600">
                            {runKnowledgeLearningMutation.data.patternsFound}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Patterns Found
                          </p>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-green-600">
                            {runKnowledgeLearningMutation.data.articlesCreated}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Articles Created
                          </p>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-purple-600">
                            {
                              runKnowledgeLearningMutation.data
                                .articlesPublished
                            }
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Articles Published
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="search" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Intelligent Knowledge Search
                </CardTitle>
                <CardDescription>
                  Test the AI-powered semantic search capabilities
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  This feature uses AI to understand the context and meaning of
                  search queries, providing more relevant results than
                  traditional keyword matching.
                </p>

                <div className="text-center py-8 text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>
                    Search functionality will be integrated with the Knowledge
                    Base page
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
