import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { LogOut } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

const SignOutButton = React.forwardRef<HTMLButtonElement>((props, ref) => {
  const { logout, isLoggingOut } = useAuth();
  const { t } = useTranslation("common");

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
      {isLoggingOut
        ? t("actions.signingOut", { defaultValue: "Signing Out..." })
        : t("actions.signOut", { defaultValue: "Sign Out" })}
    </Button>
  );
});

export default SignOutButton;
