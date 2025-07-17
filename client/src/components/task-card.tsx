import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoreVertical } from "lucide-react";

interface TaskCardProps {
  task: {
    id: number;
    title: string;
    description?: string;
    category: string;
    status: string;
    priority: string;
    assigneeId?: string;
    dueDate?: string;
    createdAt: string;
    createdBy: string;
  };
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export default function TaskCard({ task, onClick, onEdit, onDelete }: TaskCardProps) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "bg-red-500";
      case "medium": return "bg-yellow-500";
      case "low": return "bg-green-500";
      default: return "bg-slate-300";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "bug": return "bg-red-100 text-red-800";
      case "feature": return "bg-blue-100 text-blue-800";
      case "support": return "bg-purple-100 text-purple-800";
      case "enhancement": return "bg-green-100 text-green-800";
      default: return "bg-slate-100 text-slate-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "bg-blue-100 text-blue-800";
      case "in_progress": return "bg-yellow-100 text-yellow-800";
      case "resolved": return "bg-green-100 text-green-800";
      case "closed": return "bg-slate-100 text-slate-800";
      default: return "bg-slate-100 text-slate-800";
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <CardContent className="p-6">
        <div className="flex items-start space-x-4">
          <div className={`w-3 h-3 rounded-full mt-2 ${getPriorityColor(task.priority)}`} />
          
          <div className="flex-1">
            <h3 className="font-semibold text-slate-800 mb-2">{task.title}</h3>
            {task.description && (
              <p className="text-slate-600 mb-4 line-clamp-2">{task.description}</p>
            )}
            
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <Badge className={getCategoryColor(task.category)}>
                {task.category}
              </Badge>
              <Badge className={getStatusColor(task.status)}>
                {task.status.replace('_', ' ')}
              </Badge>
              <Badge variant="outline">
                {task.priority} priority
              </Badge>
              {task.assigneeId && (
                <span className="text-sm text-slate-500">
                  Assigned to: {task.assigneeId}
                </span>
              )}
              {task.dueDate && (
                <span className="text-sm text-slate-500">
                  Due: {new Date(task.dueDate).toLocaleDateString()}
                </span>
              )}
            </div>
            
            <div className="text-xs text-slate-400">
              Created {new Date(task.createdAt).toLocaleDateString()} by {task.createdBy}
            </div>
          </div>
          
          {(onEdit || onDelete) && (
            <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
