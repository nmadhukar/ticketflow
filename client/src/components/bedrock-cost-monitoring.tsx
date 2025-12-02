/**
 * AWS Bedrock Cost Monitoring Component
 *
 * This component provides real-time cost monitoring, usage tracking, and request blocking
 * notifications for AWS Bedrock usage to prevent unexpected charges on free-tier accounts.
 */

import React from "react";
import { useTranslation } from "react-i18next";
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
  AlertTriangle,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Shield,
  Clock,
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
  config?: {
    currentModelId: string | null;
    isFreeTierAccount: boolean;
  };
}

export function BedrockCostMonitoring() {
  const { toast } = useToast();
  const { t } = useTranslation(["common", "bedrock"]);
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
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
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
        title: t("bedrock:errors.resetTitle", {
          defaultValue: "Failed to reset usage",
        }),
        description:
          error.message ||
          t("bedrock:errors.resetDesc", {
            defaultValue: "An error occurred while resetting usage data.",
          }),
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
        title: t("bedrock:errors.exportTitle", {
          defaultValue: "Failed to export usage",
        }),
        description:
          error.message ||
          t("bedrock:errors.exportDesc", {
            defaultValue: "An error occurred while exporting usage data.",
          }),
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
      // Pull fresh stats/usage immediately after a successful connection test
      queryClient.invalidateQueries({ queryKey: ["bedrock-cost-statistics"] });
    },
    onError: (error: any) => {
      showConnectionTestNotification(false, undefined, error.message);
    },
  });

  const handleResetUsage = () => {
    if (
      window.confirm(
        t("bedrock:confirm.reset", {
          defaultValue:
            "Are you sure you want to reset all usage data? This action cannot be undone.",
        })
      )
    ) {
      resetUsageMutation.mutate();
    }
  };

  const handleExportUsage = () => {
    const startDate = prompt(
      t("bedrock:prompt.startDate", {
        defaultValue:
          "Enter start date (YYYY-MM-DD) or leave blank for all data:",
      })
    );
    const endDate = prompt(
      t("bedrock:prompt.endDate", {
        defaultValue:
          "Enter end date (YYYY-MM-DD) or leave blank for all data:",
      })
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
            {t("bedrock:loading", {
              defaultValue: "Loading Cost Statistics...",
            })}
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!costStats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {t("bedrock:unavailable.title", {
              defaultValue: "Cost Monitoring Unavailable",
            })}
          </CardTitle>
          <CardDescription>
            {t("bedrock:unavailable.desc", {
              defaultValue:
                "Unable to load cost statistics. Please check your connection and try again.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refetch()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("bedrock:actions.retry", { defaultValue: "Retry" })}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { dailyUsage, monthlyUsage, limits, recentUsage, config } =
    costStats || {
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

  const currentModelId = config?.currentModelId;

  return (
    <div className="space-y-6">
      {/* Cost Overview Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bedrock:cards.daily.title", { defaultValue: "Daily Usage" })}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <h5 className="text-2xl font-bold mb-2">
              ${dailyUsage.totalCost.toFixed(4)}
            </h5>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Progress
                value={getCostPercentage(
                  dailyUsage.totalCost,
                  limits.dailyLimitUSD
                )}
                className="flex-1"
              />
              <span>
                {t("bedrock:cards.of", {
                  defaultValue: "of ${{amount}}",
                  amount: limits.dailyLimitUSD,
                })}
              </span>
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
              {t("bedrock:cards.requests", {
                defaultValue: "{{count}} requests",
                count: dailyUsage.requestCount,
              })}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bedrock:cards.monthly.title", {
                defaultValue: "Monthly Usage",
              })}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <h5 className="text-2xl font-bold mb-2">
              ${monthlyUsage.totalCost.toFixed(4)}
            </h5>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Progress
                value={getCostPercentage(
                  monthlyUsage.totalCost,
                  limits.monthlyLimitUSD
                )}
                className="flex-1"
              />
              <span>
                {t("bedrock:cards.of", {
                  defaultValue: "of ${{amount}}",
                  amount: limits.monthlyLimitUSD,
                })}
              </span>
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
              {t("bedrock:cards.requests", {
                defaultValue: "{{count}} requests",
                count: monthlyUsage.requestCount,
              })}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bedrock:cards.accountType.title", {
                defaultValue: "Account Type",
              })}
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <h5 className="text-2xl font-bold mb-2">
              {limits.isFreeTierAccount
                ? t("bedrock:cards.accountType.free", {
                    defaultValue: "Free Tier",
                  })
                : t("bedrock:cards.accountType.paid", { defaultValue: "Paid" })}
            </h5>
            <div className="flex flex-col gap-1">
              <Badge variant="secondary" className="text-xs">
                {t("bedrock:cards.accountType.model", {
                  defaultValue: "Current model: {{model}}",
                  model: currentModelId || "Not configured",
                })}
              </Badge>
              <Badge
                variant={limits.isFreeTierAccount ? "secondary" : "default"}
                className="text-xs w-fit"
              >
                {t("bedrock:cards.accountType.reqPerDay", {
                  defaultValue: "{{count}} req/day",
                  count: limits.maxRequestsPerDay,
                })}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Alerts */}
      {(dailyStatus === "critical" || monthlyStatus === "critical") && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>
              {t("bedrock:alerts.critical.title", {
                defaultValue: "Cost Limit Warning:",
              })}
            </strong>{" "}
            {t("bedrock:alerts.critical.body", {
              defaultValue:
                "You're approaching or have exceeded your cost limits. New requests may be blocked to prevent unexpected charges.",
            })}
          </AlertDescription>
        </Alert>
      )}

      {(dailyStatus === "warning" || monthlyStatus === "warning") && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>
              {t("bedrock:alerts.warning.title", {
                defaultValue: "Cost Limit Alert:",
              })}
            </strong>{" "}
            {t("bedrock:alerts.warning.body", {
              defaultValue:
                "You're approaching your cost limits. Consider reviewing your usage or increasing limits if needed.",
            })}
          </AlertDescription>
        </Alert>
      )}

      {/* Recent Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {t("bedrock:recent.title", { defaultValue: "Recent Usage" })}
          </CardTitle>
          <CardDescription>
            {t("bedrock:recent.desc", {
              defaultValue: "Last 10 Bedrock API calls with cost information.",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="h-[25vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("bedrock:recent.table.time", { defaultValue: "Time" })}
                </TableHead>
                <TableHead>
                  {t("bedrock:recent.table.operation", {
                    defaultValue: "Operation",
                  })}
                </TableHead>
                <TableHead>
                  {t("bedrock:recent.table.model", { defaultValue: "Model" })}
                </TableHead>
                <TableHead>
                  {t("bedrock:recent.table.tokens", { defaultValue: "Tokens" })}
                </TableHead>
                <TableHead>
                  {t("bedrock:recent.table.cost", { defaultValue: "Cost" })}
                </TableHead>
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
