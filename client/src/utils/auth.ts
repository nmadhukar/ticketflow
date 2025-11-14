import { User } from "@/types/user";

/**
 * Determines the authentication method used by a user
 * Microsoft SSO users have IDs that start with "ms_"
 *
 * @param user - The user object
 * @param t - Optional translation function. If provided, returns translated string, otherwise returns translation key
 * @returns A string describing the authentication method (translated or key)
 */
export function getAuthMethod(
  user: User | undefined,
  t?: (key: string) => string
): string {
  if (!user?.id) {
    const key = "settings.authMethod.emailPassword";
    return t ? t(key) : key;
  }

  const key = user.id.startsWith("ms_")
    ? "settings.authMethod.microsoftSSO"
    : "settings.authMethod.emailPassword";
  return t ? t(key) : key;
}

/**
 * Checks if a user is authenticated via Microsoft SSO
 *
 * @param user - The user object
 * @returns true if the user is authenticated via Microsoft SSO
 */
export function isMicrosoftUser(user: User | undefined): boolean {
  return user?.id?.startsWith("ms_") ?? false;
}
