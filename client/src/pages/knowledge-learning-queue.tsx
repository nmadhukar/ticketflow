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
import { Database, RefreshCw, Zap, CheckCircle } from "lucide-react";
import { format } from "date-fns";

// Queue Status Display Component
function QueueStatusDisplay() {
  const { data: queueStatus, isLoading } = useQuery({
    queryKey: ["/api/admin/learning-queue"],
  });

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading queue status...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold">
                {(queueStatus as any)?.pending || 0}
              </p>
            </div>
            <Database className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Processing</p>
              <p className="text-2xl font-bold">
                {(queueStatus as any)?.processing || 0}
              </p>
            </div>
            <RefreshCw className="h-8 w-8 text-primary animate-spin" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Completed Today</p>
              <p className="text-2xl font-bold">
                {(queueStatus as any)?.completedToday || 0}
              </p>
            </div>
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </CardContent>
      </Card>
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

  const processBatch = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/batch-process",
        dateRange
      );
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Batch processing started",
        description: `Processing ${data.ticketCount} resolved tickets...`,
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
          />
        </div>
      </div>

      <Button
        onClick={() => processBatch.mutate()}
        disabled={processBatch.isPending}
        className="w-full"
      >
        <Zap className="h-4 w-4 mr-2" />
        {processBatch.isPending ? "Processing..." : "Start Batch Processing"}
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
      <div className="text-sm text-muted-foreground">Loading analytics...</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Articles Created
            </span>
            <span className="font-medium">
              {(analytics as any)?.articlesCreated || 0}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Avg. Effectiveness
            </span>
            <span className="font-medium">
              {(((analytics as any)?.avgEffectiveness || 0) * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Auto-Responses Sent
            </span>
            <span className="font-medium">
              {(analytics as any)?.autoResponsesSent || 0}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Tickets Resolved by AI
            </span>
            <span className="font-medium">
              {(analytics as any)?.ticketsResolvedByAI || 0}
            </span>
          </div>
        </div>
      </div>

      {(analytics as any)?.topCategories &&
        (analytics as any).topCategories.length > 0 && (
          <div className="space-y-2">
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
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Knowledge Base Learning Queue
          </CardTitle>
          <CardDescription>
            Monitor and manage the self-learning knowledge base system
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Learning Queue Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Learning Queue Status</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: ["/api/admin/learning-queue"],
                })
              }
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </CardTitle>
          <CardDescription>
            Real-time status of the knowledge base learning queue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueueStatusDisplay />
        </CardContent>
      </Card>

      {/* Learning Analytics */}
      <Card>
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

      {/* Historical Ticket Processing */}
      <Card>
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
    </div>
  );
}
