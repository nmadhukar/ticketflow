import { useAuth } from "@/hooks/useAuth";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Shield, Palette } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import MainWrapper from "@/components/main-wrapper";
import {
  useUserPreferences,
  useUpdateUserPreferences,
} from "@/hooks/useUserPreferences";
import { UserPreferences } from "@/types/user";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "next-themes";

export default function Settings() {
  const { user } = useAuth();
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

  // Local state for form
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);

  // Handle theme provider mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Initialize preferences from API or defaults (only on mount or when data first loads)
  useEffect(() => {
    if (preferencesData && !preferences) {
      // Only set preferences if we don't have local state yet
      setPreferences(preferencesData);
      // Apply theme if different (only on initial load)
      // Use resolvedTheme to get actual theme (resolves "system" to "light" or "dark")
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
    } else if (!preferencesLoading && !preferences && !preferencesData) {
      // Set defaults if no data and not loading
      const defaultLanguage =
        (typeof window !== "undefined" && localStorage.getItem("i18nextLng")) ||
        "en";
      setPreferences({
        userId: (user as any)?.id || "",
        theme: (currentTheme || "light") as "light" | "dark" | "system",
        language: defaultLanguage as "en" | "es" | "fr" | "de" | "zh",
        timezone: "UTC",
        dateFormat: "MM/DD/YYYY",
        emailNotifications: true,
        pushNotifications: false,
        taskUpdates: true,
        teamUpdates: true,
        mentions: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [
    preferencesData,
    preferencesLoading,
    i18n,
    user?.id,
    setThemeProvider,
    // Removed currentTheme from dependencies to prevent resetting on theme change
  ]);

  const handleSavePreferences = () => {
    if (!preferences) return;

    updatePreferences.mutate({
      theme: preferences.theme,
      language: preferences.language,
      timezone: preferences.timezone,
      dateFormat: preferences.dateFormat,
      emailNotifications: preferences.emailNotifications,
      pushNotifications: preferences.pushNotifications,
      taskUpdates: preferences.taskUpdates,
      teamUpdates: preferences.teamUpdates,
      mentions: preferences.mentions,
    });
  };

  const handleThemeChange = (value: string) => {
    if (!preferences || !mounted) return;
    // Update local state
    setPreferences((prev) =>
      prev ? { ...prev, theme: value as "light" | "dark" | "system" } : null
    );
    // Immediately apply theme change (only if mounted)
    if (mounted) {
      setThemeProvider(value);
    }
  };

  const handleLanguageChange = (value: string) => {
    if (!preferences) return;
    setPreferences((prev) =>
      prev
        ? { ...prev, language: value as "en" | "es" | "fr" | "de" | "zh" }
        : null
    );
    i18n.changeLanguage(value);
  };

  // IANA timezone options (common ones)
  const timezoneOptions = [
    { value: "UTC", label: "UTC (Coordinated Universal Time)" },
    { value: "America/New_York", label: "Eastern Time (US & Canada)" },
    { value: "America/Chicago", label: "Central Time (US & Canada)" },
    { value: "America/Denver", label: "Mountain Time (US & Canada)" },
    { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
    { value: "Europe/London", label: "London" },
    { value: "Europe/Paris", label: "Paris" },
    { value: "Europe/Berlin", label: "Berlin" },
    { value: "Asia/Tokyo", label: "Tokyo" },
    { value: "Asia/Shanghai", label: "Shanghai" },
    { value: "Asia/Dubai", label: "Dubai" },
    { value: "Australia/Sydney", label: "Sydney" },
  ];

  return (
    <MainWrapper title={t("settings.title")} subTitle={t("settings.subtitle")}>
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="preferences" className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                View and manage your profile information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {user?.profileImageUrl ? (
                  <img
                    src={user.profileImageUrl}
                    alt={user.firstName || "User"}
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold">
                    {user?.firstName} {user?.lastName}
                  </h3>
                  <p className="text-muted-foreground">{user?.email}</p>
                  <Badge variant="secondary" className="mt-1">
                    {user?.role}
                  </Badge>
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium">Department</p>
                  <p className="text-sm text-muted-foreground">
                    {user?.department || "Not assigned"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium">Phone</p>
                  <p className="text-sm text-muted-foreground">
                    {user?.phone || "Not provided"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>
                Customize how the application looks and behaves
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
                      Display Preferences
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="theme">Theme</Label>
                        <Select
                          value={preferences.theme}
                          onValueChange={handleThemeChange}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="light">Light</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                            <SelectItem value="system">System</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="language">
                          {t("settings.language")}
                        </Label>
                        <Select
                          value={preferences.language}
                          onValueChange={handleLanguageChange}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">
                              {t("language.en")}
                            </SelectItem>
                            <SelectItem value="es">
                              {t("language.es")}
                            </SelectItem>
                            <SelectItem value="fr">
                              {t("language.fr")}
                            </SelectItem>
                            <SelectItem value="de">
                              {t("language.de")}
                            </SelectItem>
                            <SelectItem value="zh">
                              {t("language.zh")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="timezone">Timezone</Label>
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
                            {timezoneOptions.map((tz) => (
                              <SelectItem key={tz.value} value={tz.value}>
                                {tz.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="dateFormat">Date Format</Label>
                        <Select
                          value={preferences.dateFormat}
                          onValueChange={(value) =>
                            setPreferences((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    dateFormat: value as
                                      | "MM/DD/YYYY"
                                      | "DD/MM/YYYY"
                                      | "YYYY-MM-DD"
                                      | "DD MMM YYYY",
                                  }
                                : null
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MM/DD/YYYY">
                              MM/DD/YYYY
                            </SelectItem>
                            <SelectItem value="DD/MM/YYYY">
                              DD/MM/YYYY
                            </SelectItem>
                            <SelectItem value="YYYY-MM-DD">
                              YYYY-MM-DD
                            </SelectItem>
                            <SelectItem value="DD MMM YYYY">
                              DD MMM YYYY
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Notification Preferences Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold">
                      Notification Preferences
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="email-notifications">
                            Email Notifications
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Receive notifications via email
                          </p>
                        </div>
                        <Switch
                          id="email-notifications"
                          checked={preferences.emailNotifications}
                          onCheckedChange={(checked) =>
                            setPreferences((prev) =>
                              prev
                                ? { ...prev, emailNotifications: checked }
                                : null
                            )
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="push-notifications">
                            Push Notifications
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Receive browser push notifications
                          </p>
                        </div>
                        <Switch
                          id="push-notifications"
                          checked={preferences.pushNotifications}
                          onCheckedChange={(checked) =>
                            setPreferences((prev) =>
                              prev
                                ? { ...prev, pushNotifications: checked }
                                : null
                            )
                          }
                        />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="task-updates">Ticket Updates</Label>
                          <p className="text-sm text-muted-foreground">
                            Notifications for tickets assigned to you
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
                          <Label htmlFor="team-updates">Team Updates</Label>
                          <p className="text-sm text-muted-foreground">
                            Notifications for team activities
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
                          <Label htmlFor="mentions">Mentions</Label>
                          <p className="text-sm text-muted-foreground">
                            Notifications when someone mentions you
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

                  <div className="pt-4">
                    <Button
                      onClick={handleSavePreferences}
                      disabled={updatePreferences.isPending}
                    >
                      {updatePreferences.isPending
                        ? "Saving..."
                        : "Save Preferences"}
                    </Button>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>
                View your account security information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium">Authentication</h4>
                  <p className="text-sm text-muted-foreground">
                    Your account is secured through{" "}
                    {user?.password
                      ? "email/password authentication"
                      : "Microsoft SSO"}
                  </p>
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-medium">Active Sessions</h4>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="text-sm font-medium">Current Session</p>
                        <p className="text-xs text-muted-foreground">
                          Last active: {new Date().toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="secondary">Active</Badge>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-medium">Account Status</h4>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="default">Active</Badge>
                    <span className="text-sm text-muted-foreground">
                      {user?.createdAt
                        ? `Account created: ${new Date(
                            user.createdAt
                          ).toLocaleDateString()}`
                        : `Authenticated via ${
                            user?.email ? "Email/Password" : "Microsoft SSO"
                          }`}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => (window.location.href = "/api/logout")}
              >
                {t("actions.signOut", { defaultValue: "Sign Out" })}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </MainWrapper>
  );
}
