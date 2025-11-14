import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserPreferences } from "@/types/user";
import {
  Theme,
  Language,
  DateFormat,
  THEME_OPTIONS,
  LANGUAGE_OPTIONS,
  DATE_FORMAT_OPTIONS,
} from "@/enum";
import { TIMEZONE_OPTIONS } from "@/constants";
import {
  useUserPreferences,
  useUpdateUserPreferences,
} from "@/hooks/useUserPreferences";

interface UserPreferencesProps {
  userId?: string;
}

export default function UserPreferencesComponent({
  userId,
}: UserPreferencesProps) {
  const { i18n, t } = useTranslation();
  const {
    theme: currentTheme,
    setTheme: setThemeProvider,
    resolvedTheme,
  } = useTheme();
  const { data: preferencesData, isLoading: preferencesLoading } =
    useUserPreferences();
  const updatePreferences = useUpdateUserPreferences();
  const [mounted, setMounted] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [originalPreferences, setOriginalPreferences] =
    useState<UserPreferences | null>(null);

  // Handle theme provider mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize preferences from API or defaults (only once)
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (preferencesData && !hasInitialized.current) {
      // Initial load
      setPreferences(preferencesData);
      setOriginalPreferences(preferencesData);
      // Apply theme if different (only on initial load)
      const actualTheme = resolvedTheme || currentTheme;
      if (preferencesData.theme && preferencesData.theme !== actualTheme) {
        setThemeProvider(preferencesData.theme);
      }
      // Apply language if different (only on initial load)
      if (
        preferencesData.language &&
        preferencesData.language !== i18n.language
      ) {
        i18n.changeLanguage(preferencesData.language);
      }
      hasInitialized.current = true;
    } else if (
      !preferencesLoading &&
      !preferences &&
      !preferencesData &&
      !hasInitialized.current
    ) {
      // Set defaults if no data and not loading
      const defaultLanguage =
        (typeof window !== "undefined" && localStorage.getItem("i18nextLng")) ||
        "en";
      const defaultPrefs: UserPreferences = {
        userId: userId || "",
        theme: (currentTheme || "light") as Theme,
        language: defaultLanguage as Language,
        timezone: "UTC",
        dateFormat: "MM/DD/YYYY" as DateFormat,
        emailNotifications: true,
        pushNotifications: false,
        taskUpdates: true,
        teamUpdates: true,
        mentions: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setPreferences(defaultPrefs);
      setOriginalPreferences(defaultPrefs);
      hasInitialized.current = true;
    }
  }, [
    preferencesData,
    preferencesLoading,
    i18n,
    userId,
    setThemeProvider,
    currentTheme,
    resolvedTheme,
    preferences,
  ]);

  const handleSavePreferences = () => {
    if (!preferences) return;

    updatePreferences.mutate(
      {
        theme: preferences.theme,
        language: preferences.language,
        timezone: preferences.timezone,
        dateFormat: preferences.dateFormat,
        emailNotifications: preferences.emailNotifications,
        pushNotifications: preferences.pushNotifications,
        taskUpdates: preferences.taskUpdates,
        teamUpdates: preferences.teamUpdates,
        mentions: preferences.mentions,
      },
      {
        onSuccess: (data) => {
          // Update original preferences after successful save
          if (data) {
            setOriginalPreferences(data);
            setPreferences(data);
          }
        },
      }
    );
  };

  // Check if preferences have changed
  const hasChanges = useMemo(() => {
    if (!preferences || !originalPreferences) return false;

    return (
      preferences.theme !== originalPreferences.theme ||
      preferences.language !== originalPreferences.language ||
      preferences.timezone !== originalPreferences.timezone ||
      preferences.dateFormat !== originalPreferences.dateFormat ||
      preferences.emailNotifications !==
        originalPreferences.emailNotifications ||
      preferences.pushNotifications !== originalPreferences.pushNotifications ||
      preferences.taskUpdates !== originalPreferences.taskUpdates ||
      preferences.teamUpdates !== originalPreferences.teamUpdates ||
      preferences.mentions !== originalPreferences.mentions
    );
  }, [preferences, originalPreferences]);

  const handleThemeChange = (value: string) => {
    if (!preferences) return;
    // Immediately apply theme change first
    setThemeProvider(value);
    // Then update local state
    setPreferences((prev) =>
      prev ? { ...prev, theme: value as Theme } : null
    );
  };

  const handleLanguageChange = (value: string) => {
    if (!preferences) return;
    setPreferences((prev) =>
      prev ? { ...prev, language: value as Language } : null
    );
    i18n.changeLanguage(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.preferencesTitle")}</CardTitle>
        <CardDescription>
          {t("settings.preferencesDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {preferencesLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : preferences ? (
          <>
            {/* Display Preferences Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">
                {t("settings.displayPreferences")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="theme">{t("settings.theme")}</Label>
                  <Select
                    value={preferences.theme || currentTheme || "light"}
                    onValueChange={handleThemeChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {THEME_OPTIONS.map((theme) => (
                        <SelectItem key={theme} value={theme}>
                          {t(`settings.themeOptions.${theme}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="language">{t("settings.language")}</Label>
                  <Select
                    value={preferences.language}
                    onValueChange={handleLanguageChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((lang) => (
                        <SelectItem key={lang} value={lang}>
                          {t(`language.${lang}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">{t("settings.timezone")}</Label>
                  <Select
                    value={preferences.timezone}
                    onValueChange={(value) =>
                      setPreferences((prev) =>
                        prev ? { ...prev, timezone: value } : null
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dateFormat">{t("settings.dateFormat")}</Label>
                  <Select
                    value={preferences.dateFormat}
                    onValueChange={(value) =>
                      setPreferences((prev) =>
                        prev
                          ? {
                              ...prev,
                              dateFormat: value as DateFormat,
                            }
                          : null
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FORMAT_OPTIONS.map((format) => (
                        <SelectItem key={format} value={format}>
                          {format}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Notification Preferences Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">
                {t("settings.notificationPreferences")}
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="email-notifications">
                      {t("settings.emailNotifications")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.emailNotificationsDesc")}
                    </p>
                  </div>
                  <Switch
                    id="email-notifications"
                    checked={preferences.emailNotifications}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) =>
                        prev ? { ...prev, emailNotifications: checked } : null
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="push-notifications">
                      {t("settings.pushNotifications")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.pushNotificationsDesc")}
                    </p>
                  </div>
                  <Switch
                    id="push-notifications"
                    checked={preferences.pushNotifications}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) =>
                        prev ? { ...prev, pushNotifications: checked } : null
                      )
                    }
                  />
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="task-updates">
                      {t("settings.ticketUpdates")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.ticketUpdatesDesc")}
                    </p>
                  </div>
                  <Switch
                    id="task-updates"
                    checked={preferences.taskUpdates}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) =>
                        prev ? { ...prev, taskUpdates: checked } : null
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="team-updates">
                      {t("settings.teamUpdates")}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.teamUpdatesDesc")}
                    </p>
                  </div>
                  <Switch
                    id="team-updates"
                    checked={preferences.teamUpdates}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) =>
                        prev ? { ...prev, teamUpdates: checked } : null
                      )
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="mentions">{t("settings.mentions")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("settings.mentionsDesc")}
                    </p>
                  </div>
                  <Switch
                    id="mentions"
                    checked={preferences.mentions}
                    onCheckedChange={(checked) =>
                      setPreferences((prev) =>
                        prev ? { ...prev, mentions: checked } : null
                      )
                    }
                  />
                </div>
              </div>
            </div>

            {hasChanges && (
              <div className="pt-4">
                <Button
                  onClick={handleSavePreferences}
                  disabled={updatePreferences.isPending}
                >
                  {updatePreferences.isPending
                    ? t("actions.saving")
                    : t("settings.savePreferences")}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
