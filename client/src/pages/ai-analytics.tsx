import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Brain, BookOpen, TrendingUp, Zap } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface AiAnalyticsData {
  autoResponse: {
    total: number;
    applied: number;
    helpful: number;
    avgConfidence: number;
  };
  complexity: Array<{
    range: string;
    count: number;
  }>;
  knowledgeBase: {
    totalArticles: number;
    publishedArticles: number;
    avgEffectiveness: string;
    totalUsage: number;
  };
}

const COMPLEXITY_COLORS: { [key: string]: string } = {
  'Very Low': '#10b981',
  'Low': '#3b82f6',
  'Medium': '#f59e0b',
  'High': '#ef4444',
  'Very High': '#7c3aed',
};

export default function AiAnalytics() {
  const { data: analytics, isLoading, error } = useQuery<AiAnalyticsData>({
    queryKey: ['/api/analytics/ai-performance'],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-bold mb-6">AI Performance Analytics</h1>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="space-y-0 pb-2">
                <Skeleton className="h-4 w-[100px]" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[60px]" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load AI analytics. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const autoResponseRate = analytics?.autoResponse?.total > 0
    ? (analytics.autoResponse.applied / analytics.autoResponse.total) * 100
    : 0;

  const helpfulnessRate = analytics?.autoResponse?.applied > 0
    ? (analytics.autoResponse.helpful / analytics.autoResponse.applied) * 100
    : 0;

  const avgConfidence = analytics?.autoResponse?.avgConfidence || 0;

  const kbEffectiveness = parseFloat(analytics?.knowledgeBase?.avgEffectiveness || '0') * 100;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Brain className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold">AI Performance Analytics</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Auto-Responses Generated
            </CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics?.autoResponse?.total || 0}</div>
            <p className="text-xs text-muted-foreground">
              {analytics?.autoResponse?.applied || 0} applied to tickets
            </p>
            <Progress value={autoResponseRate} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Response Effectiveness
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{helpfulnessRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              marked as helpful by users
            </p>
            <Progress value={helpfulnessRate} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Average Confidence
            </CardTitle>
            <Brain className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(avgConfidence * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              AI response confidence score
            </p>
            <Progress value={avgConfidence * 100} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Knowledge Articles
            </CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.knowledgeBase?.publishedArticles || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              of {analytics?.knowledgeBase?.totalArticles || 0} published
            </p>
            <Progress 
              value={
                analytics?.knowledgeBase?.totalArticles > 0
                  ? (analytics.knowledgeBase.publishedArticles / analytics.knowledgeBase.totalArticles) * 100
                  : 0
              } 
              className="mt-2" 
            />
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Complexity Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Ticket Complexity Distribution</CardTitle>
            <CardDescription>
              Breakdown of tickets by complexity level
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics?.complexity || []}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" />
                  <YAxis />
                  <Tooltip />
                  <Bar 
                    dataKey="count" 
                    fill="#8884d8"
                    radius={[8, 8, 0, 0]}
                  >
                    {(analytics?.complexity || []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COMPLEXITY_COLORS[entry.range]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Base Effectiveness */}
        <Card>
          <CardHeader>
            <CardTitle>Knowledge Base Performance</CardTitle>
            <CardDescription>
              Article effectiveness and usage statistics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Article Effectiveness</span>
                  <span className="text-sm text-muted-foreground">
                    {kbEffectiveness.toFixed(1)}%
                  </span>
                </div>
                <Progress value={kbEffectiveness} />
              </div>
              
              <div className="pt-4">
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">
                      {analytics?.knowledgeBase?.totalUsage || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Article Views</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {analytics?.knowledgeBase?.totalArticles > 0
                        ? Math.round((analytics?.knowledgeBase?.totalUsage || 0) / analytics.knowledgeBase.totalArticles)
                        : 0}
                    </p>
                    <p className="text-xs text-muted-foreground">Avg. Views per Article</p>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <h4 className="text-sm font-medium mb-2">Quick Stats</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Articles</span>
                    <span className="font-medium">{analytics?.knowledgeBase?.totalArticles || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Published</span>
                    <span className="font-medium">{analytics?.knowledgeBase?.publishedArticles || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Draft</span>
                    <span className="font-medium">
                      {(analytics?.knowledgeBase?.totalArticles || 0) - (analytics?.knowledgeBase?.publishedArticles || 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Response Details */}
      <Card>
        <CardHeader>
          <CardTitle>AI Auto-Response Details</CardTitle>
          <CardDescription>
            Detailed breakdown of AI-generated responses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Response Generation</h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Generated</span>
                  <span className="font-medium">{analytics?.autoResponse?.total || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Applied to Tickets</span>
                  <span className="font-medium">{analytics?.autoResponse?.applied || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Application Rate</span>
                  <span className="font-medium">{autoResponseRate.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">User Feedback</h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Marked Helpful</span>
                  <span className="font-medium">{analytics?.autoResponse?.helpful || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Helpfulness Rate</span>
                  <span className="font-medium">{helpfulnessRate.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Feedback Received</span>
                  <span className="font-medium">
                    {((analytics?.autoResponse?.helpful || 0) / (analytics?.autoResponse?.applied || 1) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-medium">AI Confidence</h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Average Score</span>
                  <span className="font-medium">{(avgConfidence * 100).toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">High Confidence (&gt;70%)</span>
                  <span className="font-medium">
                    {analytics?.autoResponse?.applied || 0} responses
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium text-green-600">
                    {avgConfidence > 0.6 ? 'Good' : 'Needs Improvement'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}