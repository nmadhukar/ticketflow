# Webhook test TLS fixture

`key.pem` and `cert.pem` are a throwaway self-signed key and certificate (CN and SAN
`contoso.webhook.office.com`) used only by the local HTTPS server in
`server/__tests__/unit/webhookGuard.test.ts`. They protect nothing and give access to
nothing: no service, host or account trusts them. Never use them outside that test.
