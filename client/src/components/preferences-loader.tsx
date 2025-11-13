import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

/**
 * Component that loads user preferences and applies them on mount
 * This ensures theme and language are applied when the user logs in
 */
export function PreferencesLoader() {
  const { isAuthenticated } = useAuth();
  const { data: preferences } = useUserPreferences();
  const { setTheme } = useTheme();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (isAuthenticated && preferences) {
      // Only apply preferences on initial load, not on every preference change
      // This prevents overriding user's manual theme changes in settings
      const hasAppliedPreferences =
        typeof window !== "undefined"
          ? sessionStorage.getItem("preferences_applied") === "true"
          : false;

      if (!hasAppliedPreferences) {
        // Apply theme
        if (preferences.theme) {
          setTheme(preferences.theme);
        }

        // Apply language
        if (preferences.language && preferences.language !== i18n.language) {
          i18n.changeLanguage(preferences.language);
        }

        // Mark as applied to prevent re-applying
        if (typeof window !== "undefined") {
          sessionStorage.setItem("preferences_applied", "true");
        }
      }
    }
  }, [isAuthenticated, preferences, setTheme, i18n]);

  return null;
}
