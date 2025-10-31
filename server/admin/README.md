# Admin Routes Module

This directory contains all administrative route handlers, organized by domain for better maintainability.

## Structure

```
server/admin/
├── index.ts           # Main router registration
├── middleware.ts     # Admin authentication utilities
├── settings.ts        # Company settings, branding, SMTP, SSO, email templates
├── aiSettings.ts      # AI settings (already exists)
├── users.ts           # User management (TODO)
├── knowledge.ts       # Knowledge base management (TODO)
├── help.ts            # Help docs & guides (TODO)
├── invitations.ts    # User invitations (TODO)
├── departments.ts     # Department management (TODO)
├── escalation.ts      # Escalation rules (TODO)
├── learningQueue.ts   # Learning queue management (TODO)
└── apiKeys.ts         # API key management (TODO)
```

## Usage

All admin routes are registered via `registerAdminRoutes()` in `routes.ts`:

```typescript
import { registerAdminRoutes } from "./admin";

// In registerRoutes function:
registerAdminRoutes(app);
```

## Middleware

The `middleware.ts` file provides:

- `getUserId(req)` - Extract user ID from request
- `isAdmin` - Middleware to check admin role
- `requireAdmin(req, res)` - Helper function to check admin in route handlers

## Route Modules

Each route module exports a `register*Routes(app: Express): void` function that registers all routes for that domain.

### Example: settings.ts

```typescript
export function registerSettingsRoutes(app: Express): void {
  app.get("/api/company-settings", isAuthenticated, async (req, res) => {
    // Route handler
  });
}
```

## Current Status

✅ **Completed:**

- `middleware.ts` - Admin utilities
- `settings.ts` - Company settings, branding, SMTP, SSO, email templates
- `index.ts` - Main router

⏳ **To Be Migrated:**

- User management routes → `users.ts`
- Knowledge base routes → `knowledge.ts`
- Help & guides routes → `help.ts`
- Invitation routes → `invitations.ts`
- Department routes → `departments.ts`
- Escalation routes → `escalation.ts`
- Learning queue routes → `learningQueue.ts`
- API keys routes → `apiKeys.ts`

## Benefits

1. **Better Organization** - Routes grouped by domain
2. **Easier Maintenance** - Find routes quickly by feature
3. **Scalability** - Easy to add new admin features
4. **Code Reuse** - Shared middleware and utilities
5. **Testability** - Each module can be tested independently
