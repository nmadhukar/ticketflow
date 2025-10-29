# Admin Email Integrations - Implementation Notes and Suggestions

## Scope

- Route: `admin/email?section=integrations`
- Client: `client/src/pages/admin.tsx` (email tab renderer)
- Server: `/api/smtp/settings`, `/api/smtp/test`, `/api/email-templates`

## Current Implementation

- Email tab combines AWS SES (email) and AWS Bedrock (AI) configuration.
- Uses `/api/smtp/settings` (GET/POST) and `/api/smtp/test` (POST) and email templates endpoints.
- `?section=` query param not previously wired to jump to a subsection.

## Changes Applied

- Deep-linking enabled by scrolling to `#email-<section>` anchors on mount when tab is `email`.
  - Anchors: `email-integrations` (SES), `email-ai` (Bedrock), `email-sender`, `email-test`, `email-templates`.
- Server GET `/api/smtp/settings` now omits secrets and returns presence flags:
  - `hasAwsSecret`, `hasBedrockSecret` booleans.
- Server POST `/api/smtp/settings` now supports partial updates:
  - Preserves existing secrets if omitted or blank in request.
  - Response omits secrets and mirrors GET shape.

## Suggestions

- Separate Bedrock config into AI tab to reduce cognitive load, or add a clear visual divider and help text.
- Add show/hide toggles for secret fields on the client and indicate when a secret is already set (without revealing it).
- Consider domain/identity verification surface for SES status (optional enhancement).
- Record audit logs for configuration changes.

## Deep-link Examples

- `/admin/email?section=integrations`
- `/admin/email?section=ai`
- `/admin/email?section=test`

## Files Touched

- `client/src/pages/admin.tsx` (anchors + scroll)
- `server/routes.ts` (sanitize/partial updates for SMTP)
