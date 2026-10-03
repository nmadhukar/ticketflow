# TicketFlow on AWS EC2 with Docker Compose (Postgres on EC2)

## Architecture

- Single EC2 instance running Docker Compose - `app` (Node/Express serves built React) on port 5000 - `postgres` (16-alpine) with persistent volume, no host port exposed - `nginx` reverse proxy on 80/443 → `app:5000` (with WebSocket support)
- Optional: Certbot (for Let's Encrypt) or Caddy instead of Nginx for automatic TLS
- Backups: nightly `pg_dump` to local disk, optionally sync to S3

## 1) Fresh AWS account bootstrap

- Create IAM admin user; enable MFA; create named profile in AWS CLI
- Set a budget and alerts (Cost Management → Budgets)
- Request Elastic IP quota if needed; keep SES sandbox in mind (must verify identities to send mail)
- Choose region (e.g., `us-east-1`)

## 2) Networking and IAM

- Use default VPC and one public subnet (or create VPC if required)
- Security Group for EC2: - Inbound: 22 (SSH), 80 (HTTP), 443 (HTTPS) from 0.0.0.0/0 - Outbound: all
- Key pair: create and download `.pem`
- Optional IAM role (instance profile) attached to EC2 (for SSM/backup to S3): - `AmazonSSMManagedInstanceCore` - Least-privilege S3 write policy if using S3 backups

## 3) Provision EC2

- AMI: Amazon Linux 2023; Type: `t3.small` (or `t3.medium`), 30–60 GB gp3 EBS
- Assign Elastic IP; attach Security Group and IAM role
- User data (cloud-init) to install Docker and docker-compose plugin:

```bash
#!/bin/bash
set -eux
yum update -y
amazon-linux-extras enable docker
yum install -y docker git
systemctl enable docker && systemctl start docker
usermod -aG docker ec2-user
curl -L https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
mkdir -p /opt/ticketflow && chown ec2-user:ec2-user /opt/ticketflow
```

## 4) DNS and HTTPS

- Buy/transfer domain to Route 53 (or use any registrar)
- Create A record to Elastic IP
- TLS options: - Nginx + Certbot: obtain/renew certs via cron (needs port 80 open) - Caddy container (auto-HTTPS) if you prefer simpler management

## 5) Prepare app artifacts on the server

- SSH to EC2 and clone repo into `/opt/ticketflow`
- Create these files (do not commit secrets): - `Dockerfile` (multi-stage build) - `docker-compose.yml` - `nginx.conf` (if using Nginx) - `.env` (Compose env for app and Postgres)

### Dockerfile

```dockerfile
# 1) Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production
RUN npm run build

# 2) Runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# If the app reads static from dist/public, the above includes it
EXPOSE 5000
CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      PORT: 5000
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      SESSION_SECRET: ${SESSION_SECRET}
      JWT_SECRET: ${JWT_SECRET}
      CORS_ENABLED: ${CORS_ENABLED}
      CORS_ORIGIN: ${CORS_ORIGIN}
      RATE_LIMITING_ENABLED: ${RATE_LIMITING_ENABLED}
      INPUT_VALIDATION_ENABLED: ${INPUT_VALIDATION_ENABLED}
      AWS_REGION: ${AWS_REGION}
      # Optional: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY for SES/Bedrock
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    depends_on:
      - app
    ports:
      - "80:80"
      # - "443:443"  # enable after TLS is set up
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      # - ./certs:/etc/ssl/private:ro  # if using manual TLS
    restart: unless-stopped

volumes:
  pgdata:
```

### nginx.conf (HTTP first, WS support; add TLS later)

```nginx
server {
  listen 80;
  server_name _; # replace with your domain later

  client_max_body_size 25m;

  location /ws/ {
    proxy_pass http://app:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }

  location / {
    proxy_pass http://app:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### .env (for docker-compose)

```bash
# Postgres
POSTGRES_USER=ticketflow
POSTGRES_PASSWORD=strong-password
POSTGRES_DB=ticketflow

# App
SESSION_SECRET=replace-with-32b-hex
JWT_SECRET=replace-with-32b-hex
NODE_ENV=production
AWS_REGION=us-east-1
CORS_ENABLED=true
CORS_ORIGIN=https://your-domain.com
RATE_LIMITING_ENABLED=true
INPUT_VALIDATION_ENABLED=true
```

## 6) First deployment

- On EC2: - `cd /opt/ticketflow` - `docker-compose build` - Run migrations (Drizzle) once Postgres is healthy: - `docker-compose run --rm app npm run db:push` - Start stack: `docker-compose up -d` - Check: `curl http://localhost/health` from EC2, then load `http://your-domain`

Note: The app seeds data on startup in `server/index.ts`. Consider removing or gating seeding in production later.

## 7) Enable HTTPS

- Option A: Nginx + Certbot containers (manual setup; renew via cron) - Stop Nginx, run Certbot HTTP-01 challenge to generate certs into `./certs` - Mount certs in Nginx and add `listen 443 ssl;` with `ssl_certificate` paths
- Option B: Switch to Caddy in Compose for automatic TLS

```yaml
caddy:
  image: caddy:2
  depends_on:
    - app
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile:ro
  restart: unless-stopped
```

```bash

# Caddyfile

your-domain.com {

encode gzip

reverse_proxy app:5000

}

```

- Update DNS A record to your EC2 Elastic IP before enabling TLS

## 8) Backups (recommended)

- Local nightly backup using cron:

```bash
mkdir -p /opt/ticketflow/backups
cat >/etc/cron.d/pg_backup <<'CRON'
0 2 * * * root docker exec $(docker ps -qf name=_postgres_) pg_dump -U $POSTGRES_USER $POSTGRES_DB > /opt/ticketflow/backups/$(date +\%F).sql
CRON
```

- Optional: copy to S3 (requires IAM role/policy) using `aws s3 cp /opt/ticketflow/backups/... s3://your-bucket/`

## 9) Monitoring and ops

- Logs: `docker logs` or mount to host for `nginx`, `app`, `postgres`
- Health: `/health` endpoint; set up Uptime monitoring (Route 53 health check or external)
- Updates: `git pull`, `docker-compose build`, `docker-compose up -d`
- Rollback: keep previous `image` tag or last backup; re-run `docker-compose up -d` with prior tag

## 10) Optional integrations

- AWS SES (email): - Verify domain/email in SES; still in sandbox by default - To send to unverified recipients, request production access - Set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` in `.env`
- Bedrock: create IAM user/role with Bedrock access, set env vars; enable access in region

## 11) Security hardening checklist

- Restrict SSH to your IP (Security Group)
- Disable SSH password auth (key-only)
- Regularly patch AMI and base images
- Rotate secrets; store in SSM Parameter Store and load via `.env` generation
- Do not publish Postgres port; keep Compose service internal only

## 12) Acceptance checklist

- HTTP 200 at `/health` via domain
- Database migrations applied, app functional (create/login, tickets visible)
- HTTPS enabled with valid certificate
- Backups present and restorable
- Costs/budget alarms active
