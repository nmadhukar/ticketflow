# Requirement status after the fix program

Branch `wt/t24`, based on 076197a (all 23 earlier tasks merged). Requirements are the IDs in
`ticketflow-requirements.md`. Each row names the test that proves the requirement as
`file::test name`, found by reading `server/__tests__/**`, `client/src/__tests__/**` and
`e2e/**`. Test files are relative to `server/__tests__/` unless they start with `e2e/` or
`client/`. A name with `%s` is an `it.each` title. This file was written from the test
sources, not from a test run: the controller's full verification is the proof that the
named tests pass.

## Summary

| Status | Count | IDs |
|---|---|---|
| Proven by a test | 70 | A1-A3, A5-A9, T1-T14, T16-T18, I1-I4, I7, K1-K3, K5-K7, E1-E6, G1, G4, G6, G7, D1-D3, S1, S3, S6, Y1-Y8, P1, M1-M9 |
| External | 1 | T15 (S3) |
| Not covered | 16 | A4, I5, I6, I8, I9, K4, K8, G2, G3, G5, S2, S4, S5, Y9, P2, P3 |
| Total | 87 | |

"Proven" means the acceptance behaviour of the API is asserted by a test. Where a requirement
also names something no test reaches (a UI table, a live Microsoft/SES/Teams/Bedrock/S3 call),
the "Gap or external part" column says so; many of the 70 proven rows carry such a gap. Mocked
Bedrock, SES and Microsoft calls in the tests prove the application's side only.

## Status by requirement

### A. Accounts, login and roles

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| A1 | Proven | `auth.test.ts::should register a new user successfully`; `auth.test.ts::should reject registration with existing email`; `integration/invitations.test.ts::(a) registering with an invited email but no token gives an unapproved customer`; `integration/help.policies.test.ts::register answers an existing email identically for password and password-less accounts`; `unit/accountStatus.test.ts::blocks accounts awaiting approval` | No single test registers and then attempts the login end to end. The route is `/api/auth/register`; the existing-email answer is now `400 email_registered`. |
| A2 | Proven | `integration/smoke.test.ts::logs a seeded admin in and lists tickets`; `e2e/tickets.spec.ts::customer creates a ticket and sees its TKT number` | Cookie flags are not asserted (see Y9). |
| A3 | Proven | `auth.test.ts::should reject login with a wrong password`; `auth.test.ts::should reject login with invalid email`; `integration/smoke.test.ts::rejects an anonymous ticket list with 401 JSON` | |
| A4 | Not covered | none | No server test calls `POST /api/auth/logout` and then reuses the cookie. `bearer.test.ts` only proves a bearer cannot log out; the client test covers the forced-password sign-out screen. |
| A5 | Proven | `integration/session.inactive.test.ts::deactivating a logged-in user makes their next request 401`; `integration/session.inactive.test.ts::un-approving a logged-in user makes their next request 401`; `auth.test.ts::should reject login for a deactivated account`; `integration/realtime.test.ts::a deactivated user: through the admin API the socket closes at once` | Re-activation and the approve route followed by a successful login are not tested end to end. |
| A6 | Proven | `integration/passwordReset.test.ts::stores only a sha256 hash; the emailed token resets the password`; `auth.test.ts::should return generic message for non-existent email`; `integration/passwordReset.test.ts::a password-less (SSO) account gets no token, no email, and the same answer as an unknown email`; `integration/passwordChange.test.ts::a token reset ends existing sessions` | Real email delivery is external (SES). |
| A7 | Proven | `integration/contract.minor.test.ts::an admin changes a role and login returns it`; `integration/contract.minor.test.ts::self-registration defaults to customer`; `integration/roles.vocabulary.test.ts::a converted legacy account keeps agent rights (staff-only /api/users)` | The roles are now admin, manager, agent, customer; the legacy `user` is read as `agent`. |
| A8 | Proven | `integration/login.lockout.test.ts::locks on the 6th attempt after 5 wrong passwords, even with the right one`; `integration/login.lockout.test.ts::lets the user in once lockedUntil has passed and resets the counter`; `integration/login.lockout.test.ts::10 parallel wrong logins (different IPs) allow at most 5 password comparisons and leave the account locked` | The lockout is on the live login path now (the earlier gap is closed). |
| A9 | Proven | `integration/sso.microsoft.redirect.test.ts::redirects to login.microsoftonline.com and keeps the secret out of the URL`; `integration/contract.minor.test.ts::reports not configured, without secrets`; `integration/contract.minor.test.ts::reports configured once an SSO configuration is stored, still without secrets` | **External: Microsoft Entra.** The callback that signs in or creates the user is not run by any test. |

### T. Tickets

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| T1 | Proven | `integration/tickets.create.test.ts::T1: create returns 201 with ticketNumber, status open and createdBy the caller` | |
| T2 | Proven | `integration/tickets.create.test.ts::T2: bad title, priority or category is 400 with details and writes nothing`; `integration/tickets.create.test.ts::server-owned fields in a create body are 400 and write nothing` | |
| T3 | Proven | `integration/ticketNumber.concurrency.test.ts::20 parallel creates get 20 distinct numbers in TKT-YYYY-NNNN form`; `integration/storage.test.ts::creates tasks with sequential ticket numbers and filters by status`; `integration/ticketNumber.concurrency.test.ts::past 9999 the next number is numeric (10000), not the string max` | Changing the prefix (`HD-`) through company settings is not tested. |
| T4 | Proven | `integration/idParams.test.ts::%s %s with %s=%s -> 400 invalid_id`; `integration/isolation.matrix.test.ts::a missing ticket id is 404 not_found for staff and customers alike` | |
| T5 | Proven | `integration/contract.minor.test.ts::every list row carries number, title, status, priority and assignee`; `integration/isolation.matrix.test.ts::%s: GET /api/tasks lists exactly the matrix row` | The Tasks page table is not tested. The list is a bare array. |
| T6 | Proven | `integration/contract.minor.test.ts::filters by status, category and assigneeId return only matching visible tickets`; `integration/contract.minor.test.ts::invalid status, priority, category, limit or offset is 400, never zero rows`; `integration/contract.minor.test.ts::a filter never widens visibility` | UI filter parity is not tested. |
| T7 | Proven | `integration/tickets.workflow.test.ts::search is case-insensitive in both search paths`; `integration/help.policies.test.ts::ticket search treats % and _ literally`; `integration/mcp/isolation.test.ts::%s's search for A's unique word finds nothing` | |
| T8 | Proven | `integration/contract.minor.test.ts::limit and offset page without overlap`; `integration/mcp/listTickets.pagination.test.ts::limit 25 of 60 visible: hasMore, true total, and offsets reach every row exactly once` | |
| T9 | Proven | `integration/contract.minor.test.ts::GET /api/tasks/my returns only tickets assigned to the caller`; `integration/isolation.matrix.test.ts::GET /api/tasks/my lists only tickets assigned to me` | My Tasks page not tested. |
| T10 | Proven | `integration/tickets.create.test.ts::PATCH with an unknown category, priority or blank title is 400 with details`; `integration/tickets.workflow.test.ts::every field meta lists is accepted by PATCH for admin, manager, agent and customer`; `integration/mcp/updateCloseReopen.test.ts::changes only the supplied fields`; `integration/tickets.history.test.ts::updateTask on a ticket deleted mid-request is 404 not_found; a conditional status miss stays 409` | The verb is PATCH. |
| T11 | Proven | `integration/isolation.matrix.test.ts::assigning a person (no type given) makes it a user assignment and clears the team`; `integration/isolation.matrix.test.ts::user -> team clears assignee_id; the old assignee's team loses the ticket`; `integration/tickets.create.test.ts::staff create keeps one assignee kind and sets the type; a bad assigneeType is 400` | |
| T12 | Proven | `unit/ticketSchemas.test.ts::accepts every status and rejects others`; `integration/tickets.workflow.test.ts::agent resolves then closes an accessible ticket; timestamps follow`; `unit/workflow.test.ts::every staff role follows STAFF_TRANSITIONS for every status pair` | The workflow is now enforced: an illegal staff move is 409. |
| T13 | Proven | `integration/tickets.workflow.test.ts::customer cannot close their own ticket (403); can reopen it once closed`; `e2e/tickets.spec.ts::an agent replies and closes the ticket; the customer sees the reply and the closed status`; `e2e/tickets.spec.ts::the customer who created it reopens it`; `integration/tickets.history.test.ts::GET /history lists create, status change and reassignment, oldest first, with a public actor` | |
| T14 | Proven | `integration/comments.test.ts::an empty or whitespace-only body is 400 and nothing is stored`; `integration/comments.test.ts::stores the trimmed body`; `e2e/tickets.spec.ts::customer adds a comment`; `integration/storage.test.ts::stores task comments and returns them with their author` | |
| T15 | External | `integration/isolation.matrix.test.ts::%s: GET /api/attachments/:id/download follows the matrix`; `integration/isolation.matrix.test.ts::DELETE /api/attachments/:id needs ticket access, and agents may delete only their own uploads`; `integration/tickets.delete.test.ts::a failing S3 delete is logged (key and message, no Error object) and does not undo the delete` | **External: S3.** Only the access rules and the delete path are tested. Upload, listing with presigned URLs and the file-size limit are not. |
| T16 | Proven | `integration/tickets.delete.test.ts::agent, customer and manager (flag off) get 403 and the ticket remains`; `integration/tickets.delete.test.ts::admin deletes a ticket with every kind of child: 204, then 404, children gone, cost rows kept with a NULL ticket`; `integration/tickets.delete.test.ts::a manager may delete when ALLOW_MANAGER_DELETE=true` | |
| T17 | Proven | `integration/tickets.history.test.ts::GET /history lists create, status change and reassignment, oldest first, with a public actor`; `integration/tickets.history.test.ts::a customer outside the ticket is 403, a missing ticket is 404, a bad id is 400`; `client/src/components/__tests__/ticket-detail-history.test.tsx::shows the structured entries and never an undefined/details text` | The read endpoint now exists (`GET /api/tasks/:id/history`). |
| T18 | Proven | `integration/contract.minor.test.ts::dueDate:null clears the date; tags round-trip`; `integration/tickets.create.test.ts::R3 and T18: staff set hours, dueDate and tags and read them back; a customer cannot set hours`; `integration/tickets.create.test.ts::multipart create with tags (JSON string) and a file is 201 and tags read back` | Hours are staff only (R3). |

### I. AI features

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| I1 | Proven | `integration/ai.routes.test.ts::AI disabled in settings: no Bedrock call at all, ticket still created`; `integration/ai.routes.test.ts::Bedrock throwing: ticket still 201, only the error type, status and ticket id are logged`; `integration/ai.routes.test.ts::GET: customer 404 on an unapplied draft, staff 200; after apply the customer sees it` | Bedrock is mocked; live analysis is external (Bedrock). The saved complexity score is not asserted. |
| I2 | Proven | `integration/ai.routes.test.ts::threshold 0.7: one comment by the AI system user (not the customer) and one row applied, in agreement`; `integration/ai.routes.test.ts::threshold 0.9 and a real confidence of about 0.8: no comment, exactly one row, not applied`; `unit/aiAutoResponse.test.ts::returns the one decision and stores exactly ONE row, never marked applied by the service itself` | Bedrock mocked. |
| I3 | Proven | `integration/ai.routes.test.ts::admin gets 200, and the model sees the stored ticket, never client-sent text`; `integration/ai.routes.test.ts::404 for a missing ticket, 403 for a ticket outside the agent's scope, 403 for a customer`; `integration/ai.routes.test.ts::an agent who can see the ticket may use them` | Bedrock mocked. The routes take `{ticketId}`. |
| I4 | Proven | `integration/contract.minor.test.ts::auto-response feedback is recorded when an auto-response exists`; `integration/contract.minor.test.ts::POST /api/ai-feedback then GET /api/ai-feedback/:type/:referenceId returns the stored rating`; `integration/contract.minor.test.ts::an invalid rating is 400 validation_failed` | |
| I5 | Not covered | none | No test calls `POST /api/chat`, `GET /api/chat/:sessionId` or `GET /api/chat-sessions` for behaviour; `integration/ai.routes.test.ts::titles, reasons, problem types and error messages from the model leave no trace` only checks the logs. A live answer is external (Bedrock). |
| I6 | Not covered | none | No test reads or updates `/api/admin/ai-settings`, checks the 403 for a non-admin, or calls the test-connection route. (The settings are exercised only through the create-time tests in `ai.routes.test.ts`.) |
| I7 | Proven | `integration/ai.routes.test.ts::ai-performance: total counts every row, applied and helpful only the true ones`; `integration/ai.routes.test.ts::ai-analytics: autoResponsesSent counts applied rows; ticketsResolvedByAI counts DISTINCT resolved/closed tickets whose applied response came first`; `costMonitoring.test.ts::sums tokens and cost and counts operations` | `/api/bedrock/usage/summary` and the AI Analytics page render are not tested. |
| I8 | Not covered | none | The Bedrock Knowledge Base sync endpoints (`/api/admin/knowledge-base/*`) were not ported in this branch (Ruling R5), so there is nothing to test. External: Bedrock, S3. |
| I9 | Not covered | none | Only the access rule of `POST /api/tasks/:id/add-to-learning` is in the isolation matrix. The learning-on-resolve step and the queue status route have no test. External: Bedrock. |

### K. Knowledge articles, help documents and guides

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| K1 | Proven | `integration/knowledge.admin.test.ts::POST without title or content is 400 in the error contract and stores nothing`; `integration/knowledge.admin.test.ts::POST by a non-admin is 403`; `integration/knowledge.admin.test.ts::PUT strips id, createdAt, usageCount and createdBy but applies the rest`; `integration/knowledge.admin.test.ts::list filters by status, source, category and published (all = no filter)` | `DELETE /api/admin/knowledge/:id` is not tested. |
| K2 | Proven | `integration/contract.minor.test.ts::PATCH publish with no body flips isPublished both ways`; `integration/contract.minor.test.ts::GET /api/knowledge/search never returns unpublished articles`; `integration/knowledge.admin.test.ts::PATCH publish keeps status and isPublished consistent, including from archived (archivedAt cleared)` | |
| K3 | Proven | `integration/contract.minor.test.ts::GET /api/knowledge/search never returns unpublished articles`; `integration/help.policies.test.ts::knowledge search treats % and _ literally and bounds limit` | Knowledge Base page not tested. |
| K4 | Not covered | none | `integration/idParams.test.ts` only proves a bad id is 400 on `/api/knowledge/:id/feedback` and `/rate`; no test records a rating or checks effectiveness. |
| K5 | Proven | `integration/help.policies.test.ts::any signed-in user can list, search and open help documents`; `integration/help.policies.test.ts::anonymous /api/help, /api/help/search and /api/help/:id are 401`; `integration/help.policies.test.ts::help search treats % and _ as literal characters` | Admin upload, edit and delete need S3 (external) and are not tested. |
| K6 | Proven | `integration/help.policies.test.ts::anonymous policy list, item and download are 401`; `integration/help.policies.test.ts::an inactive policy is 404 by id and by download for a non-admin, readable by an admin`; `integration/help.policies.test.ts::includeInactive=true lists inactive policies for an admin only` | Admin create, toggle and delete (S3 file) are not tested. |
| K7 | Proven | `integration/help.policies.test.ts::a customer sees only published guides, even when asking for drafts`; `integration/help.policies.test.ts::a customer cannot create or edit a guide`; `integration/help.policies.test.ts::a guide saved with script and handlers is stored and returned sanitised` | User Guides page not tested. |
| K8 | Not covered | none | The route `POST /api/s3/presigned-url` does not exist in `server/` or `client/src` (grep finds no such route), so nothing can prove it. External: S3. |

### E. Email and notifications

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| E1 | Proven | `companySettings.email.test.ts::validates payload and saves AWS provider`; `companySettings.email.test.ts::succeeds for AWS adapter`; `companySettings.email.test.ts::returns 400 when not configured`; `integration/sso.secrets.test.ts::AWS SES: the secret key is never returned and a blank one keeps the stored key` | The routes are `/api/company-settings/email` and `/email/test`. The adapter is mocked: real delivery is external (SES). |
| E2 | Proven | `integration/help.policies.test.ts::an admin's email template keeps its <style> block` | Listing templates and first-start seeding are not tested. |
| E3 | Proven | `integration/invitations.test.ts::(f) admin create defaults expiry to 7 days and rejects a garbage expiresAt`; `integration/invitations.claim.test.ts::accepts 29 days ahead and defaults to about 7 days`; `integration/roles.vocabulary.test.ts::accepts %s` | The email itself is external (SES). `POST /api/admin/invitations/:id/resend` is not tested. |
| E4 | Proven | `integration/teamsWebhook.test.ts::on create: the admin and the creator, not unrelated agents, managers or customer`; `integration/teamsWebhook.test.ts::the test route sends to an allow-listed webhook`; `integration/teamsWebhook.test.ts::a legacy webhook with a non-allow-listed host is never called`; `unit/webhookGuard.test.ts::refuses when ANY resolved address is private` | The webhook call is mocked: a real Teams post is external. |
| E5 | Proven | `integration/realtime.test.ts::tells A1 when their ticket changes, and tells A3 (no access) nothing, even after forging an auth message`; `integration/realtime.test.ts::sends a comment on a ticket to users who can see it, not to others`; `integration/realtime.test.ts::still tells the people who could see a ticket when it is deleted` | The Notifications page load is not tested. |
| E6 | Proven | `integration/email.inbound.test.ts::a signed notification from a known customer creates a ticket they own, with the subject and body`; `integration/email.inbound.test.ts::a reply carrying [TKT-YYYY-NNNN] becomes a comment on that ticket by the sender`; `integration/email.inbound.test.ts::requires DMARC PASS: DKIM PASS with DMARC FAIL (or no DMARC verdict) is refused` | Inbound handling now exists. A real SES delivery is external. |

### G. Teams, departments and invitations

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| G1 | Proven | `integration/teams.manage.test.ts::an admin may create in any department`; `integration/teams.manage.test.ts::an agent does not become a team admin or member by calling it`; `integration/teams.manage.test.ts::a missing department is 400 for an admin` | A department manager creating a team and `GET /api/teams` are not tested. The role gate is now admin or the department's manager (R12). |
| G2 | Not covered | none | Only `integration/isolation.matrix.test.ts::GET /api/teams/:id/members?taskId= requires access to that ticket` touches the members route; team detail and the member list are not asserted. |
| G3 | Not covered | none | `PATCH /api/teams/:teamId/members/:userId` appears only in the numeric-id check of `integration/idParams.test.ts`. |
| G4 | Proven | `integration/teams.manage.test.ts::%s adds a member -> %i`; `integration/teams.manage.test.ts::%s removes a member -> %i`; `integration/teams.manage.test.ts::an agent cannot add themselves to a team` | `GET /api/teams/my` reflecting the change is not tested. |
| G5 | Not covered | none | Department create, rename and delete have no test (only the numeric-id check in `integration/idParams.test.ts`). |
| G6 | Proven | `integration/invitations.test.ts::(b) the right token and email gives the invited role, approved, invitation accepted`; `integration/invitations.test.ts::(e2) a logged-in user whose email matches accepts: role applied, invitation accepted`; `integration/invitations.test.ts::(c) a token issued for another email is refused`; `integration/invitations.claim.test.ts::two concurrent accepts by the signed-in user promote once` | An anonymous accept now returns `registrationRequired` and creates no account. |
| G7 | Proven | `integration/invitations.test.ts::(d) a cancelled token: GET 404, accept 400, register 400`; `integration/invitations.test.ts::(e) an expired token is refused everywhere` | The admin invitation list with statuses is not asserted. |

### D. Dashboards and reports

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| D1 | Proven | `integration/stats.test.ts::dashboard stats > %s :: GET /api/stats per-status counts equal GET /api/tasks?status=X paged to the end, on_hold included`; `integration/stats.test.ts::staff roles see different totals, so a role is not served another role's scope` | Dashboard tiles not tested. |
| D2 | Proven | `integration/isolation.matrix.test.ts::%s: /api/activity shows only events of tickets in the matrix row` | `limit` and the newest-first order are not asserted. |
| D3 | Proven | `integration/stats.test.ts::stays admin-only`; `integration/stats.test.ts::urgentTickets counts every non-closed urgent ticket, not only open ones` | |

### S. Admin and settings

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| S1 | Proven | `integration/users.secrets.test.ts::leaks no secret fields from any user-bearing endpoint`; `integration/contract.minor.test.ts::a non-admin cannot change roles; an unknown user is 404`; `integration/passwordReset.test.ts::is admin only (403) and 404 for an unknown user`; `integration/passwordReset.test.ts::returns a temporary password once; it logs in, the old one does not, and the user must change it`; `integration/contract.minor.test.ts::the only active admin cannot be demoted or deactivated (409 last_admin)` | Approving a user through `POST .../approve` is not tested directly. |
| S2 | Not covered | none | No test updates company name, ticket prefix or logo; only the email settings routes (`companySettings.email.test.ts`) and the numeric-id check touch `/api/company-settings`. |
| S3 | Proven | `integration/apiKeys.test.ts::issues a key for a chosen customer: plaintext once, only the hash stored, server-set permissions and 90-day expiry`; `integration/apiKeys.test.ts::lists keys without plaintext or hash, and revokes one`; `integration/apiKeys.test.ts::answers 401 to an anonymous caller and 403 to every non-admin role`; `integration/apiKeys.test.ts::no longer serves the old Perplexity key routes, which stored a third-party key in key_hash` | The requirement's "third-party keys" feature was replaced by admin-issued TicketFlow keys (hashed, shown once). |
| S4 | Not covered | none | Escalation rules appear only in the numeric-id check of `integration/idParams.test.ts`; the stored escalation settings have no effect and their UI controls are hidden (R23). |
| S5 | Not covered | none | `/api/faq-cache` has no test. |
| S6 | Proven | `integration/sso.secrets.test.ts::GET /api/sso/config returns hasClientSecret, never clientSecret`; `integration/sso.secrets.test.ts::an absent or empty clientSecret keeps the stored one; a non-empty one replaces it`; `integration/sso.secrets.test.ts::is admin only` | `POST /api/sso/test` calls Microsoft: external (Entra), not tested. |

### Y. Security and data isolation

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| Y1 | Proven | `integration/smoke.test.ts::rejects an anonymous ticket list with 401 JSON`; `integration/help.policies.test.ts::anonymous /api/help, /api/help/search and /api/help/:id are 401`; `integration/teamsWebhook.test.ts::an unauthenticated caller gets 401`; `integration/mcp/auth.test.ts::no credential: 401 with WWW-Authenticate: Bearer, ticket count unchanged` | `/api/teams`, `/api/admin/users` and `/api/knowledge/search` anonymous calls are not each asserted. |
| Y2 | Proven | `integration/isolation.matrix.test.ts::%s gets exactly the tickets in the matrix`; `e2e/isolation.spec.ts::customer B cannot open customer A's ticket and does not see it listed`; `integration/mcp/isolation.test.ts::%s is FORBIDDEN, nothing changes, nothing leaks` | |
| Y3 | Proven | `integration/apiKeys.test.ts::answers 401 to an anonymous caller and 403 to every non-admin role`; `integration/teamsWebhook.test.ts::a %s gets 403 on every route and nothing is stored`; `integration/stats.test.ts::stays admin-only`; `integration/sso.secrets.test.ts::is admin only` | |
| Y4 | Proven | `integration/isolation.matrix.test.ts::%s gets exactly the tickets in the matrix`; `integration/isolation.matrix.test.ts::DELETE /api/tasks/:id: 404 for a missing id, 403 outside scope`; `unit/ticketAccess.test.ts::agent: assigned to me, created by me, queued to my team, or assigned to a teammate` | Closed: staff can no longer read any ticket by id. |
| Y5 | Proven | `integration/users.secrets.test.ts::leaks no secret fields from any user-bearing endpoint`; `integration/passwordReset.test.ts::stores only a sha256 hash; the emailed token resets the password`; `integration/login.lockout.test.ts::never returns the lockout columns`; `integration/passwordChange.test.ts::passwordChangedAt is never sent to clients` | The password hash algorithm (scrypt, not the documented bcrypt) is not asserted directly. |
| Y6 | Proven | `integration/auth.ratelimit.test.ts::11 login attempts in a minute from one IP get 429 even when the client spoofs X-Forwarded-For`; `integration/auth.ratelimit.test.ts::forgot-password and reset-password are limited too`; `unit/authRateLimitConfig.test.ts::are ignored in production and development: fixed at 10 per minute`; `unit/inboundRateLimit.test.ts::the general /api limiter does not count the inbound endpoint, and still limits everything else` | The code is 10 per minute with `error: too_many_requests`, not the 5-10 per 15 minutes and `RATE_LIMIT_EXCEEDED` the requirement wording gives. |
| Y7 | Proven | `integration/help.policies.test.ts::ticket title/description and comment text round-trip byte for byte`; `integration/help.policies.test.ts::integration requests run through the production CSP (script-src 'self')`; `e2e/tickets.spec.ts::loads from script-src 'self' with no CSP violations`; `unit/sanitizeHtml.test.ts::drops handlers and scripts and keeps allowed markup`; `integration/errorContract.test.ts::malformed JSON body is 400 JSON without a stack` | Design (R27): plain text is stored verbatim and protected by React escaping plus the strict CSP; only HTML-rendered fields (guides) are sanitised. No test renders a `<script>` title in a browser. |
| Y8 | Proven | `unit/sanitizeHtml.test.ts::sends a Content-Security-Policy whose script-src has no unsafe-inline`; `integration/help.policies.test.ts::integration requests run through the production CSP (script-src 'self')` | `X-Content-Type-Options`, `X-Frame-Options` and `GET /api/security/health` are not asserted. |
| Y9 | Not covered | none | No test asserts the session cookie's httpOnly, SameSite, Secure or 7-day lifetime. |

### P. API

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| P1 | Proven | `integration/errorContract.test.ts::unknown /api path is a 404 JSON, not HTML`; `integration/errorContract.test.ts::500 JSON hides the message and the stack`; `integration/errorContract.test.ts::zod failure is 400 with field details`; `unit/errorContractSweep.test.ts::no error response is a bare { message } without an error code` | `requestId` from the old documentation is not part of the contract. |
| P2 | Not covered | none | The `/api-docs` page of the client has no test. |
| P3 | Not covered | none | `API_ENDPOINTS_REFERENCE.md` and the Postman collection were rewritten from the code in Task 24, but no automated test compares either to the running API. |

### M. MCP tools

| ID | Status | Proving test(s) | Gap or external part |
|---|---|---|---|
| M1 | Proven | `unit/mcp/toolsList.test.ts::lists exactly the eight ticket tools, each with a description and an object input schema`; `integration/mcp/auth.test.ts::lists the eight tools for a valid key and sets no cookie and no session row` | |
| M2 | Proven | `integration/mcp/auth.test.ts::no credential: 401 with WWW-Authenticate: Bearer, ticket count unchanged`; `integration/mcp/auth.test.ts::garbage key: 401 with WWW-Authenticate: Bearer, ticket count unchanged`; `integration/mcp/auth.test.ts::revoked key: 401, ticket count unchanged`; `integration/mcp/auth.test.ts::a key without mcp:tickets is refused (403), ticket count unchanged` | Decision: MCP accepts an API key with `mcp:tickets` only. A session cookie or a JWT is refused (`integration/mcp/auth.test.ts::a session cookie alone is refused for MCP (401 + Bearer)`), unlike the requirement's wording. |
| M3 | Proven | `integration/mcp/createGetList.test.ts::creates a ticket as the caller, visible over REST`; `integration/mcp/createGetList.test.ts::invalid priority: VALIDATION and no row`; `integration/mcp/createGetList.test.ts::a status in the body is refused (server-owned), no row` | |
| M4 | Proven | `integration/mcp/createGetList.test.ts::%s: same body for visible tickets, same refusal for the rest`; `integration/mcp/createGetList.test.ts::unknown id: NOT_FOUND; non-positive id: VALIDATION` | |
| M5 | Proven | `integration/mcp/createGetList.test.ts::%s: same ids in the same order across every filter, limit and offset`; `integration/mcp/createGetList.test.ts::%s: total equals the REST count and paging reaches every row`; `integration/mcp/createGetList.test.ts::an invented status is VALIDATION, never an empty list` | MCP caps `limit` at 100, REST at 500. |
| M6 | Proven | `integration/mcp/updateCloseReopen.test.ts::changes only the supplied fields`; `integration/mcp/updateCloseReopen.test.ts::reports ignoredFields for fields the role may not change, and leaves them alone`; `integration/mcp/updateCloseReopen.test.ts::a bad value is VALIDATION and changes nothing`; `integration/mcp/updateCloseReopen.test.ts::another customer's ticket is FORBIDDEN, unknown is NOT_FOUND` | History parity with the REST update is not asserted. |
| M7 | Proven | `integration/mcp/updateCloseReopen.test.ts::%s closes a ticket; closedAt is set`; `integration/mcp/updateCloseReopen.test.ts::closing twice: the second is INVALID_STATE and writes nothing more`; `integration/mcp/updateCloseReopen.test.ts::the creating customer reopens: open again, resolvedAt and closedAt cleared`; `integration/mcp/updateCloseReopen.test.ts::reopening an open ticket is INVALID_STATE` | |
| M8 | Proven | `integration/mcp/deleteComment.test.ts::without confirm: VALIDATION and the ticket remains`; `integration/mcp/deleteComment.test.ts::admin with confirm: deleted, comments and history gone, REST GET is 404`; `integration/mcp/deleteComment.test.ts::%s with confirm (flag off): FORBIDDEN, ticket remains`; `integration/mcp/deleteComment.test.ts::a confirm that is not literally true (a string) never deletes` | |
| M9 | Proven | `integration/mcp/deleteComment.test.ts::is visible in GET /api/tasks/:id/comments and attributed to the caller`; `integration/mcp/deleteComment.test.ts::empty, blank and over-long content: VALIDATION, no row`; `integration/mcp/deleteComment.test.ts::an inaccessible ticket: FORBIDDEN, no row; unknown ticket: NOT_FOUND`; `integration/mcp/isolation.test.ts::%s is FORBIDDEN, nothing changes, nothing leaks` | Isolation suite covers every tool. |

## Notes for the owner

- Of the 16 "not covered" rows, 12 are admin or secondary routes that exist and work as far as
  the code shows but have no behaviour test (A4, I5, I6, I9, K4, G2, G3, G5, S2, S4, S5, Y9).
  The other four: I8 (feature not ported), K8 (route does not exist), P2 (client page) and P3
  (no automated check of the documents).
- No tests were run for this file; counts are from reading the test sources.
