import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Home } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";

export default function NotFound() {
  const { t } = useTranslation(["common"]);
  const [location, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-background">
      <Card className="w-full max-w-xl mx-4">
        <CardContent className="pt-8 pb-8">
          <div className="flex items-start gap-3">
            <div className="mt-1">
              <AlertCircle className="h-8 w-8 text-red-500" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-foreground">
                {t("notFound.title", { defaultValue: "Page not found" })}
              </h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-muted-foreground">
                {t("notFound.message", {
                  defaultValue:
                    "We couldn’t find the page you’re looking for. It may have been moved or the link is incorrect.",
                })}
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-muted-foreground">
                {t("notFound.path", { defaultValue: "Requested path:" })}{" "}
                {location}
              </p>

              <div className="mt-6 flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => window.history.back()}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("actions.back", { defaultValue: "Go Back" })}
                </Button>
                <Button onClick={() => setLocation("/")} className="gap-2">
                  <Home className="h-4 w-4" />
                  {t("actions.home", { defaultValue: "Go Home" })}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
