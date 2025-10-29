/**
 * AWS Bedrock Cost Monitoring Component
 *
 * This component provides real-time cost monitoring, usage tracking, and request blocking
 * notifications for AWS Bedrock usage to prevent unexpected charges on free-tier accounts.
 */

import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBedrockCostNotifications } from "@/hooks/useBedrockCostNotifications";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Download,
  RefreshCw,
  Shield,
  Clock,
  Zap,
} from "lucide-react";

interface CostLimits {
  dailyLimitUSD: number;
  monthlyLimitUSD: number;
  maxTokensPerRequest: number;
  maxRequestsPerDay: number;
  maxRequestsPerHour: number;
  isFreeTierAccount: boolean;
}

interface DailyUsage {
  date: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  requestCount: number;
  operations: { [key: string]: number };
}

interface UsageRecord {
  timestamp: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  operation: string;
  userId?: string;
  ticketId?: string;
}

interface CostStatistics {
  dailyUsage: DailyUsage;
  monthlyUsage: DailyUsage;
  limits: CostLimits;
  recentUsage: UsageRecord[];
}

export function BedrockCostMonitoring() {
  const { toast } = useToast();
  const {
    showCostLimitUpdatedNotification,
    showConnectionTestNotification,
    showUsageResetNotification,
    showUsageExportNotification,
  } = useBedrockCostNotifications();

  // Fetch cost statistics
  const {
    data: costStats,
    isLoading,
    refetch,
  } = useQuery<CostStatistics>({
    queryKey: ["bedrock-cost-statistics"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/bedrock/cost-statistics");
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Reset usage data mutation
  const resetUsageMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/bedrock/reset-usage");
      return response.json();
    },
    onSuccess: () => {
      showUsageResetNotification();
      queryClient.invalidateQueries({ queryKey: ["bedrock-cost-statistics"] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reset usage",
        description:
          error.message || "An error occurred while resetting usage data.",
        variant: "destructive",
      });
    },
  });

  // Export usage data mutation
  const exportUsageMutation = useMutation({
    mutationFn: async (params: { startDate?: string; endDate?: string }) => {
      const queryString = new URLSearchParams(params).toString();
      const response = await apiRequest(
        "GET",
        `/api/bedrock/export-usage?${queryString}`
      );
      return response.json();
    },
    onSuccess: (data) => {
      // Create and download CSV file
      const csvContent = convertToCSV(data.data);
      const blob = new Blob([csvContent], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bedrock-usage-${data.dateRange.startDate || "all"}-${
        data.dateRange.endDate || "data"
      }.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showUsageExportNotification();
    },
    onError: (error: any) => {
      toast({
        title: "Failed to export usage",
        description:
          error.message || "An error occurred while exporting usage data.",
        variant: "destructive",
      });
    },
  });

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/bedrock/test-connection");
      return response.json();
    },
    onSuccess: (data) => {
      showConnectionTestNotification(true, data.costEstimate);
    },
    onError: (error: any) => {
      showConnectionTestNotification(false, undefined, error.message);
    },
  });

  const handleResetUsage = () => {
    if (
      window.confirm(
        "Are you sure you want to reset all usage data? This action cannot be undone."
      )
    ) {
      resetUsageMutation.mutate();
    }
  };

  const handleExportUsage = () => {
    const startDate = prompt(
      "Enter start date (YYYY-MM-DD) or leave blank for all data:"
    );
    const endDate = prompt(
      "Enter end date (YYYY-MM-DD) or leave blank for all data:"
    );
    exportUsageMutation.mutate({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
  };

  const convertToCSV = (data: UsageRecord[]) => {
    const headers = [
      "Timestamp",
      "Model",
      "Input Tokens",
      "Output Tokens",
      "Cost",
      "Operation",
      "User ID",
      "Ticket ID",
    ];
    const rows = data.map((record) => [
      record.timestamp,
      record.modelId,
      record.inputTokens,
      record.outputTokens,
      record.estimatedCost.toFixed(6),
      record.operation,
      record.userId || "",
      record.ticketId || "",
    ]);

    return [headers, ...rows].map((row) => row.join(",")).join("\n");
  };

  const getCostPercentage = (current: number, limit: number) => {
    return Math.min((current / limit) * 100, 100);
  };

  const getCostStatus = (current: number, limit: number) => {
    const percentage = getCostPercentage(current, limit);
    if (percentage >= 90) return "critical";
    if (percentage >= 75) return "warning";
    return "normal";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            Loading Cost Statistics...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!costStats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cost Monitoring Unavailable</CardTitle>
          <CardDescription>
            Unable to load cost statistics. Please check your connection and try
            again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refetch()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { dailyUsage, monthlyUsage, limits, recentUsage } = costStats || {
    dailyUsage: {
      date: "",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      requestCount: 0,
      operations: {},
    },
    monthlyUsage: {
      date: "",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      requestCount: 0,
      operations: {},
    },
    limits: {
      dailyLimitUSD: 5,
      monthlyLimitUSD: 50,
      maxTokensPerRequest: 1000,
      maxRequestsPerDay: 50,
      maxRequestsPerHour: 10,
      isFreeTierAccount: true,
    },
    recentUsage: [],
  };
  const dailyStatus = getCostStatus(dailyUsage.totalCost, limits.dailyLimitUSD);
  const monthlyStatus = getCostStatus(
    monthlyUsage.totalCost,
    limits.monthlyLimitUSD
  );

  return (
    <div className="space-y-6">
      {/* Cost Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Daily Usage</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${dailyUsage.totalCost.toFixed(4)}
            </div>
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <Progress
                value={getCostPercentage(
                  dailyUsage.totalCost,
                  limits.dailyLimitUSD
                )}
                className="flex-1"
              />
              <span>of ${limits.dailyLimitUSD}</span>
            </div>
            <Badge
              variant={
                dailyStatus === "critical"
                  ? "destructive"
                  : dailyStatus === "warning"
                  ? "secondary"
                  : "default"
              }
            >
              {dailyUsage.requestCount} requests
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Usage</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${monthlyUsage.totalCost.toFixed(4)}
            </div>
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <Progress
                value={getCostPercentage(
                  monthlyUsage.totalCost,
                  limits.monthlyLimitUSD
                )}
                className="flex-1"
              />
              <span>of ${limits.monthlyLimitUSD}</span>
            </div>
            <Badge
              variant={
                monthlyStatus === "critical"
                  ? "destructive"
                  : monthlyStatus === "warning"
                  ? "secondary"
                  : "default"
              }
            >
              {monthlyUsage.requestCount} requests
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Type</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {limits.isFreeTierAccount ? "Free Tier" : "Paid"}
            </div>
            <p className="text-xs text-muted-foreground">
              {limits.isFreeTierAccount
                ? "Strict cost limits enabled"
                : "Standard cost limits"}
            </p>
            <Badge variant={limits.isFreeTierAccount ? "secondary" : "default"}>
              {limits.maxRequestsPerDay} req/day
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Cost Alerts */}
      {(dailyStatus === "critical" || monthlyStatus === "critical") && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Cost Limit Warning:</strong> You're approaching or have
            exceeded your cost limits. New requests may be blocked to prevent
            unexpected charges.
          </AlertDescription>
        </Alert>
      )}

      {(dailyStatus === "warning" || monthlyStatus === "warning") && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Cost Limit Alert:</strong> You're approaching your cost
            limits. Consider reviewing your usage or increasing limits if
            needed.
          </AlertDescription>
        </Alert>
      )}

      {/* Recent Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Usage
          </CardTitle>
          <CardDescription>
            Last 10 Bedrock API calls with cost information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentUsage.map((record: UsageRecord, index: number) => (
                <TableRow key={index}>
                  <TableCell className="text-sm">
                    {new Date(record.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{record.operation}</Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    {record.modelId.split("-").slice(0, 3).join("-")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.inputTokens + record.outputTokens}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
                    ${record.estimatedCost.toFixed(4)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
