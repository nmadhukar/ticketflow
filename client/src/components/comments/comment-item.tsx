import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Brain } from "lucide-react";
import { format } from "date-fns";
import { RoleBadge } from "@/components/ui/role-badge";

interface CommentItemProps {
  comment: {
    id: number;
    content: string;
    createdAt: string | Date;
    user?: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      profileImageUrl?: string | null;
      role?: string | null;
    } | null;
    userName?: string;
    userEmail?: string;
    userRole?: string;
    isAIGenerated?: boolean;
  };
}

export function CommentItem({ comment }: CommentItemProps) {
  // Determine user name with fallbacks
  const userName = comment.user
    ? `${comment.user.firstName || ""} ${comment.user.lastName || ""}`.trim() ||
      comment.user.email ||
      "Unknown User"
    : comment.userName || comment.userEmail || "Unknown User";

  // Determine user initials for avatar
  const userInitials = comment.user
    ? `${comment.user.firstName?.[0] || ""}${
        comment.user.lastName?.[0] || ""
      }`.trim() ||
      comment.user.email?.[0]?.toUpperCase() ||
      "U"
    : userName?.[0]?.toUpperCase() || "U";

  // Get user role
  const userRole = comment.user?.role || comment.userRole || null;

  return (
    <div className="flex gap-3">
      <Avatar className="h-8 w-8">
        <AvatarImage src={comment.user?.profileImageUrl || undefined} />
        <AvatarFallback>{userInitials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{userName}</span>
          {userRole && <RoleBadge role={userRole} size="sm" />}
          <span className="text-sm text-muted-foreground">
            {format(new Date(comment.createdAt), "MMM d, yyyy h:mm a")}
          </span>
          {comment.isAIGenerated === true && (
            <Badge variant="secondary" className="text-xs">
              <Brain className="h-3 w-3 mr-1" />
              AI
            </Badge>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
      </div>
    </div>
  );
}
