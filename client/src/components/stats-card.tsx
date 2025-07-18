import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  loading?: boolean;
  isActive?: boolean;
}

export default function StatsCard({ title, value, icon, loading, isActive }: StatsCardProps) {
  return (
    <Card className={`shadow-business hover:shadow-business-hover transition-all ${isActive ? 'ring-2 ring-primary' : ''}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-3xl font-bold">{value}</p>
            )}
          </div>
          <div className="w-12 h-12 bg-muted/50 rounded-lg flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
