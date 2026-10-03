# TicketFlow Requirements for End-to-End Validation

TicketFlow is an AI-assisted helpdesk and ticketing system for small and medium businesses. A TypeScript Express server (`server/`) and a React client (`client/`) share a Drizzle/Postgres schema (`shared/schema.ts`). Users register or are invited, sign in with email and password (or Microsoft 365 SSO), and raise tickets ("tasks") that carry a ticket number, status, priority, severity, category, assignee, comments, attachments and a history. Roles are customer, user, manager and admin. AWS Bedrock provides ticket analysis, auto-responses, a chat assistant and a knowledge base. S3 stores help documents, policies and guides. SES sends email. Microsoft Teams gets webhook notifications. Admins manage users, teams, departments, invitations, branding, API keys and AI settings.

Conventions for the validator:
- "(external: X)" means the requirement needs a live external service (Bedrock, S3, SES, Microsoft Graph/Entra, Teams webhook, Neon). Mark NOT-RUNNABLE if X is not configured. Do not mark it FAIL.
- "Code check" notes record where a doc claim differs from the code seen when this list was written. The doc claim stays the requirement, so a mismatch is a defect to report. Routes are under `/api`.
- Real route shapes: tickets are updated with `PATCH /api/tasks/:id` (docs say `PUT`), and `GET /api/tasks` returns a bare array (one doc says `{tasks,total,hasMore}`).

## Sources
- README.md (Features, API Documentation, Security)
- API_DOCUMENTATION.md and API_Documentation.md
- API_ENDPOINTS_REFERENCE.md
- DATABASE_SCHEMA_GUIDE.md
- DEVELOPER_DOCUMENTATION.md
- SECURITY.md and SECURITY_IMPLEMENTATION.md
- DEPLOYMENT_GUIDE.md
- docs/ (README.md, TESTING_GUIDE.md, AWS_KNOWLEDGE_BASE_SETUP.md, aws-ses-setup-guide.md, system-architecture.md, technical-requirements-document.md)
- replit.md
- Code confirming the areas: server/routes.ts, server/auth.ts, server/security/*, server/storage.ts, shared/schema.ts, client/src/pages/*

## A. Accounts, login and roles

- **A1** A new visitor can register with email, password, first and last name. The account is created unapproved unless an invitation exists. Acceptance: `POST /api/auth/register` with a fresh email returns 201 (or 200) and a user with `isApproved:false`. Logging in as that user is refused with a pending-approval message. Registering the same email again returns 400 "Email already registered". Source: API_ENDPOINTS_REFERENCE.md "POST /api/register"; server/auth.ts.
- **A2** A user can log in with email and password and gets a session. Acceptance: `POST /api/auth/login` with valid credentials returns 200 with id, email, role and sets an httpOnly cookie. `GET /api/auth/user` with that cookie returns the same user. Source: README.md "Login"; server/auth.ts.
- **A3** Wrong credentials are rejected. Acceptance: login with a wrong password returns 401 with a message and no cookie. `GET /api/auth/user` without a cookie returns 401. Source: server/auth.ts; API_DOCUMENTATION.md auth section.
- **A4** Logout ends the session. Acceptance: after `POST /api/auth/logout` the old cookie gets 401 on `GET /api/auth/user` and on `GET /api/tasks`. Source: README.md "Logout"; server/auth.ts.
- **A5** Deactivated or unapproved users cannot log in. Acceptance: an admin deactivates a user via `POST /api/admin/users/:userId/toggle-status`. That user's login then fails. After re-activation (and approval via `POST /api/admin/users/:userId/approve`) login succeeds. Source: replit.md "User Management"; server/auth.ts.
- **A6** Password reset by token. Acceptance: `POST /api/auth/forgot-password` returns a generic success for known and unknown emails. `POST /api/auth/reset-password` with a valid token sets the new password and the old one stops working. An invalid or expired token returns 400 "Invalid or expired reset token". Sending the reset email is (external: SES). Source: README.md "Data Protection"; server/auth.ts.
- **A7** Four roles exist (customer, user, manager, admin) and the role is returned on login. Acceptance: users created with each role return that `role`. An admin can change it with `PATCH /api/admin/users/:userId`. Self-registered users default to `customer`. Source: README.md "Role-Based Access Control"; shared/schema.ts users.
- **A8** Account lockout after 5 failed logins for 15 minutes. Acceptance: 5 wrong-password attempts for one user, then the correct password, returns a locked-account error until 15 minutes pass. Code check: the lockout fields exist in the schema and in server/security/secureAuth.ts, but the live login path in server/auth.ts shows no lockout logic. Source: SECURITY_IMPLEMENTATION.md "Enhanced Authentication".
- **A9** Microsoft 365 SSO login. Acceptance: `GET /api/auth/microsoft` redirects to the Microsoft login. The callback signs in or creates the user. `GET /api/sso/status` reports whether SSO is configured. (external: Microsoft Graph/Entra). Source: README.md "Microsoft 365 SSO Integration"; server/microsoftAuth.ts.

## T. Tickets

- **T1** Create a ticket. Acceptance: `POST /api/tasks` with title, description, category, priority returns 201 with an id, a `ticketNumber` like `TKT-YYYY-NNNN`, status `open`, and `createdBy` equal to the caller. Source: API_ENDPOINTS_REFERENCE.md "POST /api/tasks"; server/routes.ts.
- **T2** Create validation. Acceptance: `POST /api/tasks` with a missing title or an invalid priority returns 400 with field errors, and no row is created. Source: README.md "Input Validation"; server/routes.ts (zod).
- **T3** Ticket numbers are unique and sequential, with a configurable prefix. Acceptance: two consecutive creates give increasing numbers. After an admin sets the prefix to `HD` via `PATCH /api/company-settings`, the next ticket starts with `HD-`. Source: README.md "custom numbering"; server/storage.ts getNextTicketNumber.
- **T4** View one ticket. Acceptance: `GET /api/tasks/:id` returns the ticket with all fields. A non-numeric id returns 400. A missing id returns 404. Source: API_ENDPOINTS_REFERENCE.md "GET /api/tasks/:id".
- **T5** List tickets. Acceptance: `GET /api/tasks` returns the caller's visible tickets. The Tasks page shows them in a table (not cards). Each row shows number, title, status, priority and assignee. Source: replit.md "User Preferences"; API_ENDPOINTS_REFERENCE.md "GET /api/tasks". Code check: the response is a bare array, not the `{tasks,total,hasMore}` envelope in the docs.
- **T6** Filter the list. Acceptance: `GET /api/tasks?status=open`, `?category=bug` and `?assigneeId=<id>` each return only matching tickets. The UI filters give the same result. Source: API_ENDPOINTS_REFERENCE.md query parameters.
- **T7** Search tickets. Acceptance: `GET /api/tasks?search=<word>` returns only tickets whose title or description contains the word, and an unmatched word returns an empty list. Source: API_ENDPOINTS_REFERENCE.md `search` parameter.
- **T8** Pagination. Acceptance: `limit=2&offset=0` returns at most 2 tickets, and `offset=2` returns the next ones with no overlap. Source: API_ENDPOINTS_REFERENCE.md `limit`/`offset`.
- **T9** "My tasks". Acceptance: `GET /api/tasks/my` returns only tickets assigned to the caller. The My Tasks page shows the same set. Source: server/routes.ts; client/src/pages/my-tasks.tsx.
- **T10** Update fields. Acceptance: `PATCH /api/tasks/:id` with `{priority:"urgent"}` returns 200 and the changed ticket. A re-read shows the new value and a later `updatedAt`. Invalid values return 400. An unknown id returns 404. Source: API_ENDPOINTS_REFERENCE.md "PUT /api/tasks/:id"; server/routes.ts. Code check: the verb is PATCH, not PUT.
- **T11** Assign a ticket to a user or a team. Acceptance: `PATCH` with `assigneeId` (or `assigneeType:"team"` and `assigneeTeamId`) updates the assignee. The ticket appears in that user's My Tasks. Source: shared/schema.ts tasks; README.md "assign tickets".
- **T12** Status workflow open, in_progress, on_hold, resolved, closed. Acceptance: each status can be set through `PATCH`. A value outside the list returns 400. Setting `resolved` or `closed` stamps `resolvedAt` or `closedAt`. Source: API_ENDPOINTS_REFERENCE.md status values; shared/schema.ts.
- **T13** Close and reopen. Acceptance: setting status `closed` and then `open` (or `in_progress`) works. Both changes appear in the history and the ticket is editable again. Source: README.md "Advanced Ticket Management"; client/src/pages/my-tasks.tsx.
- **T14** Comments. Acceptance: `POST /api/tasks/:id/comments` with `{content}` returns 201 with the author id. `GET /api/tasks/:id/comments` lists it in order. An empty content returns 400. Source: API_ENDPOINTS_REFERENCE.md "Task Comments Endpoints".
- **T15** Attachments (up to 10 MB). Acceptance: attach a file to a ticket, then `GET /api/tasks/:id/attachments` lists it with name, size and type. `DELETE /api/attachments/:id` removes it. A file over 10 MB is rejected. Storing the file is (external: S3). Source: API_ENDPOINTS_REFERENCE.md "File Upload Endpoints". Code check: the route accepts attachment metadata as JSON, and the multipart `file`/`downloadUrl` flow in the docs was not seen.
- **T16** Delete a ticket. Acceptance: as an admin, `DELETE /api/tasks/:id` returns 204 and a following `GET` returns 404. A customer gets 403. The docs say admin only, so a plain `user` should also get 403. Source: API_ENDPOINTS_REFERENCE.md "DELETE /api/tasks/:id". Code check: only the customer role is blocked.
- **T17** Audit trail. Acceptance: after creating a ticket, changing its status and reassigning it, the history lists each change with actor, field, old value, new value and time. Source: README.md "Audit Trail"; shared/schema.ts taskHistory. Code check: history is written by storage, but no read endpoint for it was found.
- **T18** Time tracking, due date and tags. Acceptance: `estimatedHours`, `actualHours`, `dueDate` and `tags` are accepted on create and update and returned on read unchanged. Source: replit.md "Comprehensive Ticketing"; API_ENDPOINTS_REFERENCE.md.

## I. AI features

- **I1** Ticket analysis on creation. Acceptance: after `POST /api/tasks`, `GET /api/tasks/:id/auto-response` returns the stored auto-response (or `null` when none), and a complexity score is saved. Ticket creation still succeeds with status 201 when the AI is unavailable. (external: Bedrock). Source: replit.md "AI-Powered Helpdesk"; server/routes.ts.
- **I2** Auto-response applied above the confidence threshold. Acceptance: with a confidence of 0.7 or more, a system comment prefixed "AI Auto-Response" appears on the ticket. Below the threshold no comment is added. (external: Bedrock). Source: server/aiAutoResponse.ts; API_ENDPOINTS_REFERENCE.md AI settings.
- **I3** Agents can analyse a ticket and ask for a suggested reply. Acceptance: `POST /api/ai/analyze-ticket` and `POST /api/ai/generate-response` return a structured result (category, priority, suggested text, confidence) for an existing ticket and 4xx for a missing one. (external: Bedrock). Source: server/routes.ts; server/aiTicketAnalysis.ts.
- **I4** Auto-response feedback. Acceptance: `POST /api/tasks/:id/auto-response/feedback` and `POST /api/ai-feedback` store a helpful or not-helpful rating, and `GET /api/ai-feedback/:type/:referenceId` returns it. Source: server/routes.ts; shared/schema.ts aiFeedback.
- **I5** Chat assistant. Acceptance: `POST /api/chat` with a question returns an answer and a session id. `GET /api/chat/:sessionId` returns the saved history, and `GET /api/chat-sessions` lists the sessions. The chat widget shows the exchange. (external: Bedrock). Source: README.md "AI-Powered Assistant"; client/src/components/AiChatBot.tsx.
- **I6** Admin AI settings and test. Acceptance: an admin can read and update the confidence threshold and auto-response switch, and a non-admin gets 403. The "test connection" action returns connected or a clear error. (external: Bedrock). Source: API_ENDPOINTS_REFERENCE.md "AI Integration Endpoints"; client/src/pages/ai-settings.tsx. Code check: `/api/admin/ai-settings` and `/api/admin/ai-settings/test` were not seen in server/routes.ts (only `/api/ai/status` was found).
- **I7** AI analytics and usage cost tracking. Acceptance: `GET /api/analytics/ai-performance` and `GET /api/bedrock/usage/summary` return counts and costs for an admin, and the AI Analytics page renders them (empty is valid when unused). Source: README.md "Usage Monitoring"; client/src/pages/ai-analytics.tsx.
- **I8** Bedrock Knowledge Base sync. Acceptance: an admin can read `GET /api/admin/knowledge-base/status` and data sources. `POST /api/admin/knowledge-base/sync` returns a job id and `GET .../sync/:jobId` reports the job state. Search falls back to manual retrieval when it is not configured. (external: Bedrock, S3). Source: replit.md "AWS Bedrock Knowledge Bases"; docs/AWS_KNOWLEDGE_BASE_SETUP.md.
- **I9** Learning from resolved tickets. Acceptance: setting a ticket to `resolved` triggers the learning step without failing the update. `POST /api/tasks/:id/add-to-learning` queues it and `GET /api/admin/learning-queue/status` shows the queue. (external: Bedrock). Source: replit.md "automatic knowledge base learning"; server/routes.ts.

## K. Knowledge articles, help documents and guides

- **K1** Admin CRUD of knowledge articles. Acceptance: an admin can create, read, update and delete an article through `/api/admin/knowledge`. The changes show in `GET /api/admin/knowledge`, and a non-admin gets 403. Source: API_ENDPOINTS_REFERENCE.md "Knowledge Base Endpoints".
- **K2** Publish and unpublish. Acceptance: `PATCH /api/admin/knowledge/:id/publish` toggles visibility. Only published articles appear in `GET /api/knowledge/search`. Source: server/routes.ts; shared/schema.ts knowledgeArticles.
- **K3** Search the knowledge base. Acceptance: `GET /api/knowledge/search?query=<word>` returns published articles matching the title or content, and the Knowledge Base page shows them. Source: API_ENDPOINTS_REFERENCE.md "GET /api/knowledge"; client/src/pages/knowledge-base.tsx.
- **K4** Article feedback and ratings. Acceptance: `POST /api/knowledge/:id/feedback` and `/rate` record a rating, and the article's effectiveness changes. Source: server/routes.ts.
- **K5** Help documents (Word, PDF). Acceptance: an admin uploads a help document through `/api/admin/help`. Any signed-in user can list, search (`/api/help/search`) and open it. An admin can edit and delete it. Storing the file is (external: S3). Source: README.md "Help Documentation System".
- **K6** Company policies. Acceptance: an admin can create, toggle active, download and delete a policy. Users see only active policies at `GET /api/company-policies`. Storing the file is (external: S3). Source: README.md "Company Policy Management"; server/routes.ts.
- **K7** User guides and categories. Acceptance: an admin can manage categories and guides. Users can browse `GET /api/guide-categories` and `GET /api/guides` and open a guide, and the User Guides page shows them by category. Source: README.md "User Guide Management"; client/src/pages/user-guides.tsx.
- **K8** Presigned S3 upload URL. Acceptance: an authenticated `POST /api/s3/presigned-url` returns a time-limited URL, and an anonymous call returns 401. (external: S3). Source: docs/AWS_KNOWLEDGE_BASE_SETUP.md; server/routes.ts.

## E. Email and notifications

- **E1** SES email settings and test. Acceptance: an admin can save email settings and send a test email through `POST /api/smtp/test` or `/api/email/test`, and gets success or a clear error. (external: SES). Source: docs/aws-ses-setup-guide.md; server/routes.ts.
- **E2** Email templates. Acceptance: an admin can list templates and edit one (`PUT /api/email-templates/:name`). The edit persists. Default templates are seeded on first start. Source: README.md "Customizable Email Templates"; server/seedEmailTemplates.ts.
- **E3** Invitation email. Acceptance: `POST /api/admin/invitations` creates an invitation and sends an email with a token link. `POST /api/admin/invitations/:id/resend` resends it. (external: SES). Source: README.md "User Invitation System".
- **E4** Teams webhook notifications. Acceptance: with Teams integration enabled and `ticket_created`/`ticket_updated` selected, creating or updating a ticket posts to the webhook. `POST /api/teams-integration/test` reports success or failure. (external: Teams webhook). Source: README.md "Microsoft Teams Integration"; server/microsoftTeams.ts.
- **E5** Real-time updates and the Notifications page. Acceptance: a client connected to `/ws` receives a message when a relevant ticket changes, and the Notifications page loads. Source: replit.md "Real-time Updates".
- **E6** Receive email into tickets. Acceptance: an email sent to the support address creates a ticket, and a reply adds a comment. (external: SES). Source: README.md "Email Integration: Send and receive emails". Code check: no inbound email handler was found, only sending.

## G. Teams, departments and invitations

- **G1** Create and list teams. Acceptance: an admin or manager can `POST /api/teams` and the team appears in `GET /api/teams`. A plain user gets 403 on create. Source: API_ENDPOINTS_REFERENCE.md "Team Management Endpoints". Code check: the role gate on create was not verified.
- **G2** Team detail and members. Acceptance: `GET /api/teams/:id` and `/members` return the team and its members, and the Team Detail page lists them. Source: server/routes.ts; client/src/pages/team-detail.tsx.
- **G3** Change a team member's role (admin or member). Acceptance: `PATCH /api/teams/:teamId/members/:userId` updates the role, and an unauthorised caller gets 403. Source: replit.md "Team Management".
- **G4** Assign a user to a team and remove them. Acceptance: `POST /api/admin/users/:userId/assign-team` adds the user, and `DELETE .../remove-team/:teamId` removes them. `GET /api/teams/my` reflects both. Source: server/routes.ts.
- **G5** Departments. Acceptance: an admin can create, rename and delete departments. All signed-in users can list them at `GET /api/departments`. Source: README.md "Department Management".
- **G6** Invitation acceptance with auto-approval. Acceptance: `GET /api/invitations/:token` validates the token. `POST /api/invitations/:token/accept` creates an approved user with the invited role. An invalid token is refused. Source: README.md "auto-approval"; server/routes.ts.
- **G7** Invitation list and revoke. Acceptance: an admin lists invitations with their status, and `DELETE /api/admin/invitations/:id` revokes one so its token no longer works. Source: client/src/pages/invitations.tsx.

## D. Dashboards and reports

- **D1** Dashboard counts. Acceptance: `GET /api/stats` returns counts by status and the Dashboard tiles show them. The counts match the tickets the same user can list. Admins see all tickets, other users see their own. Source: client/src/pages/dashboard.tsx; server/routes.ts.
- **D2** Recent activity feed. Acceptance: `GET /api/activity?limit=5` returns at most 5 recent events in newest-first order, and the dashboard shows them. Source: README.md "Real-time Activity Feed".
- **D3** Admin statistics. Acceptance: `GET /api/admin/stats` returns user and ticket totals for an admin and 403 for others. Source: API_ENDPOINTS_REFERENCE.md "GET /api/admin/stats".

## S. Admin and settings

- **S1** User management. Acceptance: an admin lists users at `GET /api/admin/users` and can edit, approve, deactivate and reset a user's password. A non-admin gets 403 on each. Source: API_ENDPOINTS_REFERENCE.md "Admin Endpoints"; client/src/pages/admin.tsx.
- **S2** Company branding and ticket prefix. Acceptance: an admin updates the company name and ticket prefix through `PATCH /api/company-settings`. A logo can be uploaded through `/api/company-settings/logo`. Readers see the change. Source: README.md "Company Branding".
- **S3** Third-party API keys. Acceptance: an admin can add, list and delete API keys, and the list never returns the full secret. Source: README.md "API Key Management".
- **S4** Escalation rules. Acceptance: an admin can create, edit and delete escalation rules at `/api/admin/escalation-rules`. Source: shared/schema.ts escalationRules.
- **S5** FAQ cache admin. Acceptance: an admin can list and clear the FAQ cache at `/api/faq-cache`. Source: server/routes.ts.
- **S6** SSO configuration. Acceptance: an admin can save and test Microsoft SSO settings at `/api/sso/config` and `/api/sso/test`, and secrets are not returned in plain text. (external: Microsoft Graph/Entra). Source: server/routes.ts.

## Y. Security and data isolation

- **Y1** Every non-public API route needs authentication. Acceptance: without a cookie, `GET` on `/api/tasks`, `/api/teams`, `/api/admin/users` and `/api/knowledge/search` each return 401. Only login, register, reset, invitation-token and health routes work anonymously. Source: README.md "Zero-Trust Security Model".
- **Y2** Customers see only their own tickets. Acceptance: customer A cannot read, update, list, comment on or attach to customer B's ticket. Direct-id requests return 403, and A's list excludes B's tickets. Source: SECURITY_IMPLEMENTATION.md "Role-Based Access Control"; server/routes.ts.
- **Y3** Admin-only routes enforce role. Acceptance: a customer and a user each get 403 on `/api/admin/*` routes, and an admin gets 200. Source: API_ENDPOINTS_REFERENCE.md "Permissions: Admin only".
- **Y4** Non-admin staff are limited to their own tickets. Acceptance: a `user` with no assignee filter lists only tickets they created or are assigned to. Reading another user's unrelated ticket by id is refused. Source: API_ENDPOINTS_REFERENCE.md "GET /api/tasks/:id" (viewable by assigned or created). Code check: `GET /api/tasks/:id` blocks only customers, so a staff user may be able to read any ticket.
- **Y5** Passwords are stored hashed, never returned. Acceptance: no API response contains a password or a reset token. The stored value in `users.password` is a hash and not the plain text. Source: SECURITY.md "Authentication Layer". Code check: docs say bcrypt (10 or 12 rounds), but server/auth.ts uses scrypt. bcrypt is in server/security/secureAuth.ts only.
- **Y6** Rate limiting on authentication endpoints. Acceptance: more than 5 to 10 login attempts in 15 minutes from one IP returns 429 with `RATE_LIMIT_EXCEEDED`. General API traffic over 100 requests in 15 minutes is limited. Source: API_ENDPOINTS_REFERENCE.md "Rate Limit"; SECURITY_IMPLEMENTATION.md. Code check: the auth and password-reset limiters are commented out in server/security/index.ts.
- **Y7** Input validation and XSS sanitisation. Acceptance: a ticket title or comment containing `<script>alert(1)</script>` is stored and rendered inert, so no script runs on the ticket page. Oversized or malformed input returns 400. Source: SECURITY.md "Input Validation & Sanitization".
- **Y8** Security headers and health check. Acceptance: responses carry Helmet headers (CSP, X-Content-Type-Options, X-Frame-Options). `GET /api/security/health` returns the security status. Source: SECURITY_IMPLEMENTATION.md "Security Headers"; server/index.ts.
- **Y9** Session cookie hardening and expiry. Acceptance: the session cookie is httpOnly with SameSite=Lax (Secure in production) and a 7-day lifetime. Source: README.md "Sessions: Expire after 7 days"; server/auth.ts.

## P. API

- **P1** Error responses are JSON with a status code that matches the failure. Acceptance: 400 for invalid input, 401 for unauthenticated, 403 for forbidden, 404 for a missing id, and no stack traces in the body. Source: API_ENDPOINTS_REFERENCE.md "Error Response Format". Code check: the docs list an `{error,message,details,requestId}` shape, but the code returns `{message}`.
- **P2** Interactive API docs are available. Acceptance: the `/api-docs` page loads for a signed-in user and lists the ticket endpoints. Source: README.md "API Documentation"; client/src/pages/api-docs.tsx.
- **P3** The documented ticket-endpoint contract matches the running API. Acceptance: following API_ENDPOINTS_REFERENCE.md and the Postman collection for create, get, list, update, comment and delete gives the documented statuses. Every difference is logged as a defect. Source: TicketFlow_API_Collection.postman_collection.json; API_ENDPOINTS_REFERENCE.md.

## M. MCP tools (new; build after the defects found by validation are fixed)

The MCP server runs beside the REST API and calls the same service and storage layer, not a separate copy of the rules.

- **M1** An MCP server starts and lists its tools. Acceptance: an MCP client connects and `tools/list` returns `create_ticket`, `get_ticket`, `list_tickets`, `update_ticket`, `close_ticket`, `reopen_ticket`, `delete_ticket` and `add_comment`, each with a description and a JSON input schema. Source: new.
- **M2** Authentication is required. Acceptance: a call with no credential, or with an invalid or expired token, returns an authentication error and changes no data. The token is the same one the REST API accepts (session or JWT). Source: new; SECURITY_IMPLEMENTATION.md "JWT".
- **M3** `create_ticket`. Acceptance: with valid title, description, category and priority it returns the new ticket with a `ticketNumber` and `createdBy` equal to the caller. `GET /api/tasks/:id` then shows the same ticket. Invalid input returns a validation error and creates nothing. Source: new; T1, T2.
- **M4** `get_ticket`. Acceptance: it returns the ticket for an id the caller may see. An unknown id returns not-found. A customer asking for another customer's ticket is refused exactly as `GET /api/tasks/:id` refuses. Source: new; T4, Y2.
- **M5** `list_tickets`. Acceptance: it supports status, category, assignee, search, limit and offset, and returns the same set as `GET /api/tasks` for the same user and filters. Customers see only their own tickets. Source: new; T5 to T8.
- **M6** `update_ticket`. Acceptance: it changes only the fields supplied (status, priority, assignee, notes, tags). It writes the same history entries as the REST update and rejects invalid values. A user who could not update through REST is refused. Source: new; T10 to T12, T17.
- **M7** `close_ticket` and `reopen_ticket`. Acceptance: close sets status `closed` and `closedAt`, and reopen sets the status back to `open`. Closing an already closed ticket, or reopening an open one, returns a clear error or a no-op result. Both appear in the history. Source: new; T13.
- **M8** `delete_ticket` needs confirmation. Acceptance: without `confirm:true` (or an equal explicit argument) it refuses and the ticket remains. With it, an admin deletes the ticket and `GET /api/tasks/:id` then returns 404. A customer or other unauthorised role is refused even with the argument. Source: new; T16.
- **M9** `add_comment`, plus tests and isolation for every tool. Acceptance: `add_comment` adds a comment visible in `GET /api/tasks/:id/comments` and refuses an empty body or a ticket the caller cannot access. Every tool has automated tests for success, validation error, unauthenticated, forbidden and not-found cases, and the suite passes. A cross-user test proves no tool returns or changes another customer's data. Source: new; T14, Y2.
