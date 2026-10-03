import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color?: string;
  trend?: { value: number; isPositive: boolean };
  onClick?: () => void;
  loading?: boolean;
}

export function StatCard({
  title,
  value,
  icon,
  color = "blue",
  trend,
  onClick,
  loading = false,
}: StatCardProps) {
  const colorClasses = {
    blue: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
    green:
      "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950",
    purple:
      "border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950",
    orange:
      "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950",
    red: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
  };

  if (loading) {
    return (
      <Card
        className={cn(
          "border",
          colorClasses[color as keyof typeof colorClasses] || colorClasses.blue
        )}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "border cursor-pointer transition-all hover:shadow-md min-w-[120px]",
        colorClasses[color as keyof typeof colorClasses] || colorClasses.blue,
        onClick && "hover:scale-[1.02]"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
              {title}
            </p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold">{value}</p>
              {trend && (
                <div
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    trend.isPositive ? "text-green-600" : "text-red-600"
                  )}
                >
                  {trend.isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  <span>{Math.abs(trend.value).toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>
          <div
            className={cn(
              "p-2 rounded",
              colorClasses[color as keyof typeof colorClasses] ||
                colorClasses.blue
            )}
          >
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
