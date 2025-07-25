import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Search,
  Filter,
  MoreVertical,
  Brain,
  MessageSquare,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  Tag,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface Ticket {
  id: number;
  ticketNumber: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  assignedTo: string;
  assignedToName?: string;
  teamId?: number;
  teamName?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName?: string;
  aiConfidence?: number;
  hasAutoResponse?: boolean;
  tags?: string[];
}

interface TicketListProps {
  onTicketSelect?: (ticket: Ticket) => void;
  showAIInfo?: boolean;
  allowDragDrop?: boolean;
}

export default function TicketList({ 
  onTicketSelect, 
  showAIInfo = true,
  allowDragDrop = true 
}: TicketListProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [draggedTicket, setDraggedTicket] = useState<Ticket | null>(null);

  // Fetch tickets
  const { data: tickets, isLoading } = useQuery({
    queryKey: ["/api/tasks"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch users for assignment
  const { data: users } = useQuery({
    queryKey: ["/api/users"],
  });

  // Fetch teams for assignment
  const { data: teams } = useQuery({
    queryKey: ["/api/teams"],
  });

  // Update ticket mutation
  const updateTicket = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Ticket updated",
        description: "The ticket has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter tickets based on search and filters
  const filteredTickets = tickets?.filter((ticket: Ticket) => {
    const matchesSearch = 
      ticket.ticketNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ticket.description?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || ticket.priority === priorityFilter;
    const matchesCategory = categoryFilter === "all" || ticket.category === categoryFilter;

    return matchesSearch && matchesStatus && matchesPriority && matchesCategory;
  });

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, ticket: Ticket) => {
    if (!allowDragDrop) return;
    setDraggedTicket(ticket);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!allowDragDrop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetUserId: string | null, targetTeamId: number | null) => {
    if (!allowDragDrop || !draggedTicket) return;
    e.preventDefault();

    const updates: any = {};
    if (targetUserId !== null) {
      updates.assignedTo = targetUserId;
      updates.teamId = null;
    } else if (targetTeamId !== null) {
      updates.teamId = targetTeamId;
      updates.assignedTo = null;
    }

    updateTicket.mutate({ id: draggedTicket.id, updates });
    setDraggedTicket(null);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "open":
        return <AlertCircle className="h-4 w-4" />;
      case "in_progress":
        return <Clock className="h-4 w-4" />;
      case "resolved":
        return <CheckCircle className="h-4 w-4" />;
      case "closed":
        return <XCircle className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "status-badge-open";
      case "in_progress":
        return "status-badge-in-progress";
      case "resolved":
        return "status-badge-resolved";
      case "closed":
        return "status-badge-closed";
      case "on_hold":
        return "status-badge-on-hold";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-destructive text-destructive-foreground";
      case "high":
        return "bg-orange-500 text-white";
      case "medium":
        return "bg-yellow-500 text-white";
      case "low":
        return "bg-green-500 text-white";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "bug":
        return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400";
      case "feature":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
      case "support":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400";
      case "enhancement":
        return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
      case "incident":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400";
      case "request":
        return "bg-teal-100 text-teal-800 dark:bg-teal-900/20 dark:text-teal-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getAIConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-green-600 dark:text-green-400";
    if (confidence >= 0.6) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-8">Loading tickets...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Tickets</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search tickets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-64"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
                <SelectItem value="feature">Feature</SelectItem>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="enhancement">Enhancement</SelectItem>
                <SelectItem value="incident">Incident</SelectItem>
                <SelectItem value="request">Request</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Ticket #</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-24">Priority</TableHead>
                <TableHead className="w-28">Category</TableHead>
                <TableHead className="w-32">Assigned To</TableHead>
                {showAIInfo && <TableHead className="w-28">AI Info</TableHead>}
                <TableHead className="w-32">Created</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTickets?.map((ticket: Ticket) => (
                <TableRow
                  key={ticket.id}
                  className={cn(
                    "cursor-pointer hover:bg-muted/50",
                    allowDragDrop && "draggable"
                  )}
                  draggable={allowDragDrop}
                  onDragStart={(e) => handleDragStart(e, ticket)}
                  onClick={() => onTicketSelect ? onTicketSelect(ticket) : setLocation(`/tickets/${ticket.id}`)}
                >
                  <TableCell className="font-medium">{ticket.ticketNumber}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{ticket.title}</div>
                      {ticket.tags && ticket.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Tag className="h-3 w-3 text-muted-foreground" />
                          {ticket.tags.map((tag, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("gap-1", getStatusColor(ticket.status))}>
                      {getStatusIcon(ticket.status)}
                      {ticket.status.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={getPriorityColor(ticket.priority)}>
                      {ticket.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={getCategoryColor(ticket.category)}>
                      {ticket.category}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex items-center gap-1"
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, ticket.assignedTo, ticket.teamId || null)}
                    >
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm">
                        {ticket.assignedToName || ticket.teamName || "Unassigned"}
                      </span>
                    </div>
                  </TableCell>
                  {showAIInfo && (
                    <TableCell>
                      {ticket.hasAutoResponse && (
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-primary" />
                          {ticket.aiConfidence && (
                            <span className={cn("text-sm font-medium", getAIConfidenceColor(ticket.aiConfidence))}>
                              {(ticket.aiConfidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(ticket.createdAt), "MMM d")}
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/tickets/${ticket.id}`);
                        }}>
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          // Quick assign functionality
                        }}>
                          Quick Assign
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          // Quick status update
                        }}>
                          Update Status
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {filteredTickets?.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No tickets found matching your filters.
          </div>
        )}
      </CardContent>
    </Card>
  );
}