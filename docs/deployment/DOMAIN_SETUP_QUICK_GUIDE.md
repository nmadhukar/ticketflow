# Quick Guide: Adding Domain to EC2 Deployment

This is a quick reference guide for adding a custom domain to your TicketFlow EC2 deployment.

## Prerequisites Checklist

- [ ] Domain name purchased
- [ ] EC2 instance running
- [ ] Elastic IP allocated and associated
- [ ] DNS access (Route 53 or other provider)

## Quick Steps

### 1. Allocate Elastic IP (5 minutes)

```bash
# AWS Console → EC2 → Elastic IPs → Allocate → Associate with instance
```

### 2. Configure DNS (5-10 minutes)

**Route 53:**

- Hosted Zones → Your Domain → Create A Record
- Name: `@` → Value: Your Elastic IP
- Name: `www` → Value: Your Elastic IP (or CNAME to root)

**Other Providers:**

- DNS Settings → Add A Record
- Host: `@` → Points to: Elastic IP
- Host: `www` → Points to: Elastic IP

### 3. Update Security Group (2 minutes)

- EC2 → Security Groups → Edit Inbound Rules
- Add: HTTPS (443) from 0.0.0.0/0

### 4. Update Environment Variables (2 minutes)

```bash
# On EC2 instance
nano .env
```

Update:

```bash
SERVER_NAME=your-domain.com www.your-domain.com
COOKIE_SECURE=true
CORS_ORIGIN=https://your-domain.com
```

### 5. Install Certbot (2 minutes)

**Amazon Linux:**

```bash
sudo dnf install -y certbot python3-certbot-nginx
```

**Ubuntu:**

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 6. Update docker-compose.yml (1 minute)

Uncomment port 443:

```yaml
ports:
  - "80:80"
  - "443:443" # Uncomment this
```

Add certificate volume:

```yaml
volumes:
  - ./nginx.conf.template:/etc/nginx/templates/default.conf.template:ro
  - /etc/letsencrypt:/etc/letsencrypt:ro # Add this
```

### 7. Get SSL Certificate (5 minutes)

```bash
# Stop nginx temporarily
docker compose stop nginx

# Get certificate
sudo certbot certonly --standalone \
  -d your-domain.com \
  -d www.your-domain.com \
  --email your-email@example.com \
  --agree-tos \
  --non-interactive

# Update nginx.conf.template with SSL config (see full guide)
# Then restart
docker compose up -d
```

### 8. Set Up Auto-Renewal (3 minutes)

```bash
# Test renewal
sudo certbot renew --dry-run

# Add to crontab
sudo crontab -e
# Add: 0 0,12 * * * certbot renew --quiet --deploy-hook "docker compose -f /path/to/docker-compose.yml restart nginx"
```

## Verify Everything Works

```bash
# Check DNS
dig your-domain.com +short

# Test HTTPS
curl -I https://your-domain.com

# Check certificate
sudo certbot certificates
```

## Common Issues

**DNS not resolving:**

- Wait 5-60 minutes for propagation
- Check DNS settings are correct
- Verify Elastic IP is associated

**SSL certificate fails:**

- Ensure port 80 is open (for Let's Encrypt)
- Verify DNS points to your EC2 instance
- Check nginx is stopped during certificate generation

**Port 443 not accessible:**

- Check Security Group allows HTTPS
- Verify docker-compose.yml exposes port 443
- Check nginx container is running: `docker compose ps`

## Full Documentation

For detailed instructions, see: [EC2_DEPLOYMENT.md](./EC2_DEPLOYMENT.md#step-10-configure-domain-and-ssl-optional-but-recommended)
