import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Home, 
  List, 
  UserCheck, 
  Users, 
  BarChart3, 
  CheckCircle, 
  MoreVertical,
  LogOut,
  Settings
} from "lucide-react";

export default function Sidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  const navigation = [
    { name: "Dashboard", href: "/", icon: Home },
    { name: "All Tasks", href: "/tasks", icon: List },
    { name: "My Tasks", href: "/my-tasks", icon: UserCheck },
    { name: "Teams", href: "/teams", icon: Users },
    { name: "Reports", href: "/reports", icon: BarChart3 },
  ];

  const isActive = (href: string) => {
    if (href === "/" && location === "/") return true;
    if (href !== "/" && location.startsWith(href)) return true;
    return false;
  };

  return (
    <div className="w-64 bg-white shadow-lg flex flex-col">
      {/* Logo and Brand */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <CheckCircle className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">TaskFlow</h1>
            <p className="text-xs text-slate-500">Community Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          
          return (
            <Link key={item.name} href={item.href}>
              <a
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                  active
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.name}</span>
              </a>
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-slate-200">
        <div className="flex items-center space-x-3">
          <Avatar>
            <AvatarImage src={user?.profileImageUrl || ""} />
            <AvatarFallback>
              {user?.firstName?.charAt(0) || user?.email?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">
              {user?.firstName && user?.lastName 
                ? `${user.firstName} ${user.lastName}`
                : user?.email || "User"
              }
            </p>
            <p className="text-xs text-slate-500">Member</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.location.href = "/api/logout"}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
