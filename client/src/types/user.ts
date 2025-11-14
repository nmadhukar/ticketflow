import { Theme, Language, DateFormat } from "@/enum";
export interface User {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role: string;
  phone?: string | null;
  password?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  isActive?: boolean;
  isApproved?: boolean;
}

export interface UserPreferences {
  userId: string;
  theme: Theme;
  language: Language;
  timezone: string; // IANA format
  dateFormat: DateFormat;
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

export interface UnreadNotification {
  id: number;
  title: string;
  content: string;
  type: string;
  relatedTaskId?: number | null;
  createdAt?: string;
}

export interface UserSession {
  sessionId: string;
  createdAt: Date;
  lastActive: Date;
  expiresAt: Date;
  isCurrent: boolean;
  userAgent?: string;
  ipAddress?: string;
}
