import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: number | string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  icon: React.ReactNode;
  iconBg?: string; // e.g., "bg-primary/10", "bg-blue-500/10"
  iconColor?: string; // e.g., "text-primary", "text-blue-500"
  loading?: boolean;
  error?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function StatsCard({
  title,
  value,
  subtitle,
  icon,
  iconBg = "bg-muted/10",
  iconColor = "text-muted-foreground",
  loading,
  error,
  isActive,
  onClick,
  className,
}: StatsCardProps) {
  return (
    <Card
      className={cn(
        "transition-shadow",
        isActive && "ring-2 ring-primary",
        onClick && "cursor-pointer hover:shadow-business focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? title : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div
          className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center",
            iconBg
          )}
        >
          <div className={iconColor}>{icon}</div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16 mb-1" />
        ) : error ? (
          <div className="text-sm text-muted-foreground" role="status">Unavailable</div>
        ) : (
          <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
