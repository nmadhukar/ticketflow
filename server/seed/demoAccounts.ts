/**
 * The demo accounts the old seeders created, with their published passwords.
 * Used to seed them (SEED_DEMO_DATA=true) and to find, and deactivate, copies
 * that older deployments still carry.
 */
export const DEMO_ADMIN_PASSWORD = "Admin123!";
export const DEMO_PASSWORD = "Password123!";

export const DEMO_ACCOUNTS: ReadonlyArray<{ email: string; password: string }> = [
  { email: "admin@ticketflow.local", password: DEMO_ADMIN_PASSWORD },
  ...["manager", "agent", "customer"].map((r) => ({
    email: `${r}@ticketflow.local`,
    password: DEMO_PASSWORD,
  })),
  ...["admin", "manager", "agent", "customer"].flatMap((r) =>
    [1, 2, 3].map((i) => ({ email: `${r}${i}@ticketflow.local`, password: DEMO_PASSWORD }))
  ),
];
