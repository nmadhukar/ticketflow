import { useEffect, useRef } from "react";
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
  const { setTheme, theme: currentTheme } = useTheme();
  const { i18n } = useTranslation();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (isAuthenticated && preferences && !hasInitialized.current) {
      // Apply theme immediately when preferences are first loaded
      if (preferences.theme && preferences.theme !== currentTheme) {
        setTheme(preferences.theme);
      }

      // Apply language immediately when preferences are first loaded
      if (preferences.language && preferences.language !== i18n.language) {
        i18n.changeLanguage(preferences.language);
      }

      hasInitialized.current = true;
    }
  }, [isAuthenticated, preferences, setTheme, i18n, currentTheme]);

  return null;
}
