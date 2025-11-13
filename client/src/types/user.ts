export interface UserPreferences {
  userId: string;
  theme: "light" | "dark" | "system";
  language: "en" | "es" | "fr" | "de" | "zh";
  timezone: string; // IANA format
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";
  emailNotifications: boolean;
  pushNotifications: boolean;
  taskUpdates: boolean;
  teamUpdates: boolean;
  mentions: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserPreferencesUpdate = Partial<
  Omit<UserPreferences, "userId" | "createdAt" | "updatedAt">
>;
