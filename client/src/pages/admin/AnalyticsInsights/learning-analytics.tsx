/**
 * Knowledge Base Learning Queue Management
 *
 * Dedicated page for monitoring and managing the AI knowledge base learning system.
 * This page provides comprehensive analytics and controls for:
 *
 * - Learning Queue Status: Real-time monitoring of pending, processing, and completed tasks
 * - Learning Analytics: Track AI learning effectiveness and knowledge base growth
 * - Historical Processing: Batch process resolved tickets to seed the knowledge base
 * - Performance Metrics: Monitor AI learning progress and system health
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import StatsCard from "@/components/stats-card";
import {
  Database,
  RefreshCw,
  Zap,
  CheckCircle,
  FileText,
  TrendingUp,
  MessageSquare,
  Bot,
} from "lucide-react";
import { format } from "date-fns";

// Queue Status Display Component
function QueueStatusDisplay({
  isLoading,
  queueStatus,
}: {
  isLoading: boolean;
  queueStatus: any;
}) {
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading queue status...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatsCard
        title="Pending"
        value={(queueStatus as any)?.pending || 0}
        subtitle="Awaiting processing"
        icon={<Database className="h-4 w-4" />}
        iconBg="bg-muted/10"
        iconColor="text-muted-foreground"
        loading={isLoading}
      />
      <StatsCard
        title="Processing"
        value={(queueStatus as any)?.processing || 0}
        subtitle="Currently analyzing"
        icon={<RefreshCw className="h-4 w-4" />}
        iconBg="bg-primary/10"
        iconColor="text-primary"
        loading={isLoading}
      />
      <StatsCard
        title="Completed Today"
        value={(queueStatus as any)?.completedToday || 0}
        subtitle="Processed today"
        icon={<CheckCircle className="h-4 w-4" />}
        iconBg="bg-green-500/10"
        iconColor="text-green-500"
        loading={isLoading}
      />
    </div>
  );
}

// Batch Processing Controls Component
function BatchProcessingControls() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState({
    start: format(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      "yyyy-MM-dd"
    ),
    end: format(new Date(), "yyyy-MM-dd"),
  });

  // Get queue status to check if processing is active
  const { data: queueStatus } = useQuery({
    queryKey: ["/api/admin/learning-queue"],
    refetchInterval: (query) => {
      // Auto-refresh every 5 seconds if processing is active
      const data = query.state.data as any;
      const isProcessing = data?.isProcessing || data?.processing > 0;
      return isProcessing ? 5000 : false;
    },
  });

  const isProcessing =
    (queueStatus as any)?.isProcessing || (queueStatus as any)?.processing > 0;
  const pendingCount = (queueStatus as any)?.pending || 0;
  const processingCount = (queueStatus as any)?.processing || 0;
  const completedToday = (queueStatus as any)?.completedToday || 0;

  const processBatch = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/batch-process",
        dateRange
      );

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to start batch processing");
      }

      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Batch processing started",
        description: `Processing ${data.ticketCount} resolved tickets...`,
      });
      // Invalidate queue status to refresh immediately
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/learning-queue"],
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start batch processing",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="start-date">Start Date</Label>
          <Input
            id="start-date"
            type="date"
            value={dateRange.start}
            onChange={(e) =>
              setDateRange((prev) => ({ ...prev, start: e.target.value }))
            }
            disabled={isProcessing}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end-date">End Date</Label>
          <Input
            id="end-date"
            type="date"
            value={dateRange.end}
            onChange={(e) =>
              setDateRange((prev) => ({ ...prev, end: e.target.value }))
            }
            disabled={isProcessing}
          />
        </div>
      </div>

      {/* Processing Status Indicator */}
      {isProcessing && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 animate-spin text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">Processing in progress...</p>
                <p className="text-xs text-muted-foreground">
                  {processingCount} processing • {pendingCount} pending •{" "}
                  {completedToday} completed today
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Button
        onClick={() => processBatch.mutate()}
        disabled={processBatch.isPending || isProcessing}
        className="w-full"
      >
        <Zap className="h-4 w-4 mr-2" />
        {processBatch.isPending
          ? "Starting..."
          : isProcessing
          ? "Processing in progress..."
          : "Start Batch Processing"}
      </Button>
    </div>
  );
}

// Learning Analytics Component
function LearningAnalytics() {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["/api/admin/ai-analytics"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Articles Created"
          value={0}
          icon={<FileText className="h-4 w-4" />}
          loading={true}
        />
        <StatsCard
          title="Avg. Effectiveness"
          value="0%"
          icon={<TrendingUp className="h-4 w-4" />}
          loading={true}
        />
        <StatsCard
          title="Auto-Responses Sent"
          value={0}
          icon={<MessageSquare className="h-4 w-4" />}
          loading={true}
        />
        <StatsCard
          title="Tickets Resolved by AI"
          value={0}
          icon={<Bot className="h-4 w-4" />}
          loading={true}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Articles Created"
          value={(analytics as any)?.articlesCreated || 0}
          subtitle="Knowledge articles generated"
          icon={<FileText className="h-4 w-4" />}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-500"
          loading={isLoading}
        />
        <StatsCard
          title="Avg. Effectiveness"
          value={`${(((analytics as any)?.avgEffectiveness || 0) * 100).toFixed(
            1
          )}%`}
          subtitle="Success rate of AI articles"
          icon={<TrendingUp className="h-4 w-4" />}
          iconBg="bg-green-500/10"
          iconColor="text-green-500"
          loading={isLoading}
        />
        <StatsCard
          title="Auto-Responses Sent"
          value={(analytics as any)?.autoResponsesSent || 0}
          subtitle="AI-generated responses"
          icon={<MessageSquare className="h-4 w-4" />}
          iconBg="bg-purple-500/10"
          iconColor="text-purple-500"
          loading={isLoading}
        />
        <StatsCard
          title="Tickets Resolved by AI"
          value={(analytics as any)?.ticketsResolvedByAI || 0}
          subtitle="Auto-resolved tickets"
          icon={<Bot className="h-4 w-4" />}
          iconBg="bg-orange-500/10"
          iconColor="text-orange-500"
          loading={isLoading}
        />
      </div>

      {(analytics as any)?.topCategories &&
        (analytics as any).topCategories.length > 0 && (
          <div className="space-y-2 px-10">
            <p className="text-sm font-medium">Top Knowledge Categories</p>
            <div className="space-y-1">
              {(analytics as any).topCategories.map(
                (cat: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {cat.category}
                    </span>
                    <span>{cat.count} articles</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}
    </div>
  );
}

export default function KnowledgeLearningQueue() {
  // Get query state to track fetching status for animation
  const {
    isFetching,
    data: queueStatus,
    isLoading,
  } = useQuery({
    queryKey: ["/api/admin/learning-queue"],
  });

  return (
    <Card className="flex flex-col gap-6">
      {/* Learning Queue Status */}
      <Card className="border-none">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Learning Queue Status</CardTitle>
              <CardDescription>
                Real-time monitoring of tickets being processed for knowledge
                base learning
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: ["/api/admin/learning-queue"],
                })
              }
              disabled={isFetching}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${
                  isFetching || isLoading ? "animate-spin" : ""
                }`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <QueueStatusDisplay isLoading={isLoading} queueStatus={queueStatus} />
        </CardContent>
      </Card>
      <Separator />
      {/* Learning Analytics */}
      <Card className="border-none">
        <CardHeader>
          <CardTitle>Learning Analytics</CardTitle>
          <CardDescription>
            Track AI learning effectiveness and knowledge base growth
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LearningAnalytics />
        </CardContent>
      </Card>
      <Separator />
      {/* Historical Ticket Processing */}
      <Card className="border-none">
        <CardHeader>
          <CardTitle>Historical Ticket Processing</CardTitle>
          <CardDescription>
            Process resolved tickets from a specific date range to seed the
            knowledge base with historical data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BatchProcessingControls />
        </CardContent>
      </Card>
    </Card>
  );
}
