/**
 * Hook for handling AWS Bedrock cost limit notifications
 *
 * This hook provides utilities for displaying toast notifications when
 * Bedrock requests are blocked due to cost limits.
 */

import { useToast } from "@/hooks/use-toast";

interface BlockedRequestError {
  message: string;
  reason: string;
  costEstimate: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    modelId: string;
    operation: string;
  };
  isBlocked: boolean;
}

export function useBedrockCostNotifications() {
  const { toast } = useToast();

  const showBlockedRequestNotification = (error: BlockedRequestError) => {
    const { reason, costEstimate } = error;

    toast({
      title: "🚫 Request Blocked - Cost Limit Exceeded",
      description: `${reason}\n\nOperation: ${costEstimate.operation}\nModel: ${
        costEstimate.modelId
      }\nEstimated Cost: $${costEstimate.estimatedCost.toFixed(4)}\nTokens: ${
        costEstimate.inputTokens + costEstimate.outputTokens
      }`,
      variant: "destructive",
      duration: 10000, // Show for 10 seconds
    });
  };

  const showCostWarningNotification = (
    currentCost: number,
    limit: number,
    period: string
  ) => {
    const percentage = (currentCost / limit) * 100;

    toast({
      title: `⚠️ ${period} Cost Limit Warning`,
      description: `You've used $${currentCost.toFixed(
        4
      )} of your $${limit} ${period.toLowerCase()} limit (${percentage.toFixed(
        1
      )}%).\n\nConsider reviewing your usage or increasing limits to avoid request blocking.`,
      variant: percentage >= 90 ? "destructive" : "default",
      duration: 8000,
    });
  };

  const showCostLimitUpdatedNotification = (limits: any) => {
    const policyLabel = limits.isFreeTierAccount
      ? "Safe Mode"
      : "Standard Mode";
    toast({
      title: "✅ Cost Limits Updated",
      description: `Your AWS Bedrock cost limits have been updated:\n\nDaily Limit: $${limits.dailyLimitUSD}\nMonthly Limit: $${limits.monthlyLimitUSD}\nMax Requests/Day: ${limits.maxRequestsPerDay}\nUsage Policy: ${policyLabel}`,
      duration: 6000,
    });
  };

  const showConnectionTestNotification = (
    success: boolean,
    costEstimate?: any,
    error?: string
  ) => {
    if (success) {
      toast({
        title: "✅ Bedrock Connection Successful",
        description: `AWS Bedrock connection is working properly.${
          costEstimate
            ? `\n\nTest cost: $${
                costEstimate.estimatedCost?.toFixed(4) || "0.0000"
              }`
            : ""
        }`,
        duration: 5000,
      });
    } else {
      toast({
        title: "❌ Bedrock Connection Failed",
        description: `${error || "Failed to connect to AWS Bedrock"}${
          costEstimate
            ? "\n\nThis may be due to cost limits or configuration issues."
            : ""
        }`,
        variant: "destructive",
        duration: 8000,
      });
    }
  };

  const showUsageResetNotification = () => {
    toast({
      title: "🔄 Usage Data Reset",
      description:
        "All AWS Bedrock usage tracking data has been reset successfully.",
      duration: 4000,
    });
  };

  const showUsageExportNotification = () => {
    toast({
      title: "📊 Usage Data Exported",
      description:
        "Your AWS Bedrock usage data has been exported and downloaded.",
      duration: 4000,
    });
  };

  // Helper function to check if an error is a blocked request
  const isBlockedRequestError = (error: any): error is BlockedRequestError => {
    return error?.isBlocked === true && error?.costEstimate;
  };

  // Helper function to handle API errors and show appropriate notifications
  const handleApiError = (error: any) => {
    if (isBlockedRequestError(error)) {
      showBlockedRequestNotification(error);
    } else {
      toast({
        title: "❌ Request Failed",
        description: error?.message || "An unexpected error occurred",
        variant: "destructive",
        duration: 6000,
      });
    }
  };

  return {
    showBlockedRequestNotification,
    showCostWarningNotification,
    showCostLimitUpdatedNotification,
    showConnectionTestNotification,
    showUsageResetNotification,
    showUsageExportNotification,
    handleApiError,
    isBlockedRequestError,
  };
}

/**
 * Hook for monitoring cost limits and showing warnings
 */
export function useCostLimitMonitoring() {
  const { showCostWarningNotification } = useBedrockCostNotifications();

  const checkCostLimits = (dailyUsage: any, monthlyUsage: any, limits: any) => {
    const dailyPercentage = (dailyUsage.totalCost / limits.dailyLimitUSD) * 100;
    const monthlyPercentage =
      (monthlyUsage.totalCost / limits.monthlyLimitUSD) * 100;

    // Show warning at 75% usage
    if (dailyPercentage >= 75 && dailyPercentage < 90) {
      showCostWarningNotification(
        dailyUsage.totalCost,
        limits.dailyLimitUSD,
        "Daily"
      );
    }

    if (monthlyPercentage >= 75 && monthlyPercentage < 90) {
      showCostWarningNotification(
        monthlyUsage.totalCost,
        limits.monthlyLimitUSD,
        "Monthly"
      );
    }
  };

  return {
    checkCostLimits,
  };
}
