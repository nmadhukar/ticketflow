import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  loading?: boolean;
}

export default function StatsCard({ title, value, icon, loading }: StatsCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-600">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-3xl font-bold text-slate-800">{value}</p>
            )}
          </div>
          <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
