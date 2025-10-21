import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { LogOut } from "lucide-react";
import React from "react";

const SignOutButton = React.forwardRef<HTMLButtonElement>((props, ref) => {
  const { logout, isLoggingOut } = useAuth();

  return (
    <Button
      ref={ref}
      variant="ghost"
      className="w-full justify-start"
      onClick={logout}
      disabled={isLoggingOut}
      {...props}
    >
      <LogOut className="h-4 w-4" />
      {isLoggingOut ? "Signing Out..." : "Sign Out"}
    </Button>
  );
});

export default SignOutButton;
