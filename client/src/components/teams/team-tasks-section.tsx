import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ClipboardList, Eye } from "lucide-react";
import { useTeamTasks } from "@/hooks/useTeamTasks";
import type { Task } from "@/types/teams";
import { Spinner } from "@/components/ui/spinner";
import { TaskAssignmentsSection } from "./task-assignments-section";
import TicketDetail from "@/components/ticket-detail";

interface TeamTasksSectionProps {
  teamId: string | number;
}

export function TeamTasksSection({ teamId }: TeamTasksSectionProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [accordionValue, setAccordionValue] = useState<string | undefined>(
    undefined
  );
  const { data: tasks, isLoading: tasksLoading } = useTeamTasks(teamId);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-blue-100 text-blue-700";
      case "in_progress":
        return "bg-yellow-100 text-yellow-700";
      case "resolved":
        return "bg-green-100 text-green-700";
      case "closed":
        return "bg-slate-100 text-slate-700";
      case "on_hold":
        return "bg-orange-100 text-orange-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 text-red-700";
      case "high":
        return "bg-orange-100 text-orange-700";
      case "medium":
        return "bg-yellow-100 text-yellow-700";
      case "low":
        return "bg-green-100 text-green-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Tasks ({tasks?.length || 0})</CardTitle>
        <CardDescription>Tasks assigned to this team</CardDescription>
      </CardHeader>
      <CardContent>
        {tasksLoading ? (
          <div className="text-center py-8">
            <Spinner size="lg" className="mx-auto mb-4" />
            <p className="text-slate-500">Loading tasks...</p>
          </div>
        ) : tasks?.length ? (
          <Accordion
            type="single"
            collapsible
            className="w-full"
            value={accordionValue}
            onValueChange={(value) => {
              setAccordionValue(value);
              // If accordion is collapsed, also close ticket details
              if (!value) {
                setExpandedTaskId(null);
              }
            }}
          >
            {tasks.map((task: Task) => (
              <AccordionItem key={task.id} value={`task-${task.id}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-medium">{task.title}</h4>
                        <Badge variant="outline" className="text-xs">
                          {task.ticketNumber}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getStatusColor(task.status)}>
                          {task.status.replace("_", " ")}
                        </Badge>
                        <Badge className={getPriorityColor(task.priority)}>
                          {task.priority}
                        </Badge>
                        <Badge variant="outline">{task.category}</Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        const taskValue = `task-${task.id}`;
                        // If clicking eye icon, expand accordion if not already expanded
                        if (accordionValue !== taskValue) {
                          setAccordionValue(taskValue);
                        }
                        // Toggle ticket details
                        setExpandedTaskId((prev) =>
                          prev === task.id ? null : task.id
                        );
                      }}
                      className="ml-2"
                      aria-expanded={expandedTaskId === task.id}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="pt-4 border-t space-y-4">
                    {expandedTaskId === task.id && (
                      <div className="mb-4 pb-4 border-b">
                        <TicketDetail
                          ticketId={task.id}
                          onClose={() => setExpandedTaskId(null)}
                        />
                      </div>
                    )}
                    <TaskAssignmentsSection
                      teamId={teamId}
                      taskId={task.id}
                      variant="nested"
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <div className="text-center py-8">
            <ClipboardList className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              No tasks assigned
            </h3>
            <p className="text-slate-500">
              This team doesn't have any assigned tasks yet.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
