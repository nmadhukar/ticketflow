# EC2 Deployment Guide for TicketFlow

This guide walks you through deploying TicketFlow on an AWS EC2 instance using Docker Compose.

## Prerequisites

- AWS account with EC2 access
- SSH key pair for EC2 access
- Basic knowledge of Linux commands

## Step 1: Launch EC2 Instance

1. **Go to AWS Console** → EC2 → Launch Instance
2. **Choose AMI**:
   - Recommended: Amazon Linux 2023 or Ubuntu 22.04 LTS
3. **Instance Type**:
   - Minimum: `t3.small` (2 vCPU, 2 GB RAM)
   - Recommended: `t3.medium` (2 vCPU, 4 GB RAM) or higher
4. **Key Pair**:
   - Select or create a new key pair
   - Download the `.pem` file
5. **Network Settings**:
   - Allow SSH (port 22) from your IP
   - Allow HTTP (port 80) from anywhere (0.0.0.0/0)
   - Allow HTTPS (port 443) from anywhere if using SSL
6. **Storage**:
   - Minimum 20 GB (recommended 30+ GB for database)
7. **Launch Instance**

## Step 2: Connect to EC2 Instance

```bash
# Set proper permissions for key file
chmod 400 your-key.pem

# Connect to EC2 (replace with your instance details)
ssh -i your-key.pem ec2-user@your-ec2-public-ip
# For Ubuntu, use: ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

## Step 3: Update System and Install Dependencies

### For Amazon Linux 2023:

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user
```

### For Ubuntu:

```bash
# Update package index
sudo apt update

# Install prerequisites
sudo apt install -y ca-certificates curl gnupg lsb-release git

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update package index again
sudo apt update

# Install Docker Engine, CLI, and Docker Compose plugin
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group (replace 'ubuntu' with your username if different)
sudo usermod -aG docker ubuntu
```

**Important**: Log out and log back in for group changes to take effect.

## Step 4: Install Docker Compose (if not included)

### For Amazon Linux 2023:

```bash
# Docker Compose V2 is included with Docker, verify:
docker compose version
```

### Verify Installation:

```bash
# Verify Docker is running
sudo systemctl status docker

# Verify Docker Compose plugin is installed
docker compose version

# You should see output like: Docker Compose version v2.x.x
```

**Note**: If you followed Step 3 correctly, Docker Compose plugin should already be installed. If you see "command not found", log out and log back in, then try again.

## Step 5: Clone Your Repository

```bash
# Clone your TicketFlow repository
git clone https://github.com/your-username/ticketflow.git
cd ticketflow

# Or upload your code using SCP:
# scp -i your-key.pem -r /path/to/ticketflow ec2-user@your-ec2-ip:~/
```

## Step 6: Create Environment File

```bash
# Create .env file
nano .env
# Or use vi: vi .env
```

Add the following configuration (adjust values as needed):

```bash
# Database Configuration (using local postgres from docker-compose)
POSTGRES_USER=ticketflow_user
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=ticketflow
POSTGRES_PORT=5432

# Or use external database (comment out above, uncomment below)
# DATABASE_URL=postgresql://user:pass@external-db-host:5432/ticketflow

# Core Runtime
NODE_ENV=production
PORT=5000

# Security & Auth (generate secure random strings)
SESSION_SECRET=your-32-character-random-session-secret-here
JWT_SECRET=your-32-character-random-jwt-secret-here
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CORS_ENABLED=true
CORS_ORIGIN=*
CORS_CREDENTIALS=false

# Rate Limiting
RATE_LIMITING_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Input Validation
INPUT_VALIDATION_ENABLED=true
VALIDATION_STRICT_MODE=true

# Cookie Security (set to true if using HTTPS)
COOKIE_SECURE=false

# Email Service (Mailtrap or AWS SES)
MAILTRAP_TOKEN=your_mailtrap_token_here
# OR for AWS SES:
# AWS_ACCESS_KEY_ID=your_aws_access_key
# AWS_SECRET_ACCESS_KEY=your_aws_secret_key
# AWS_REGION=us-east-1

# AWS S3 (for file storage)
AWS_S3_BUCKET_NAME=your-s3-bucket-name
AWS_S3_REGION=us-east-1

# File Upload Limits
MAX_FILE_UPLOAD_SIZE_MB=50
MAX_FILES_PER_REQUEST=10
MAX_REQUEST_SIZE_MB=100

# Microsoft SSO (optional)
MICROSOFT_REDIRECT_URL=https://your-domain.com/api/auth/microsoft/callback

# Server Name for Nginx
SERVER_NAME=your-domain.com
# Or use _ to accept any hostname
# SERVER_NAME=_

# Debugging (optional)
DEBUG=
LOG_LEVEL=info
```

**Generate secure secrets:**

```bash
# Generate SESSION_SECRET
openssl rand -hex 32

# Generate JWT_SECRET
openssl rand -hex 32
```

## Step 7: Build and Start Services

```bash
# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f

# Check service status
docker compose ps
```

## Step 8: Verify Services Are Running

```bash
# Check if all containers are running
docker compose ps

# Expected output should show:
# - ticketflow-postgres (healthy)
# - ticketflow-app (running)
# - ticketflow-nginx (running)

# Check PostgreSQL logs
docker compose logs postgres

# Check application logs
docker compose logs app

# Check nginx logs
docker compose logs nginx
```

## Step 9: Access Your Application

1. **Get your EC2 public IP or domain**:

   ```bash
   # Find your public IP
   curl http://169.254.169.254/latest/meta-data/public-ipv4
   ```

2. **Access the application**:

   - Open browser: `http://your-ec2-public-ip`
   - Or if using domain: `http://your-domain.com`

3. **Default admin credentials** (if seeded):
   - Check your seed files for default admin user

## Step 10: Configure Domain and SSL (Optional but Recommended)

This section provides a complete guide to adding a custom domain to your EC2 deployment with SSL/TLS encryption.

### Prerequisites

- A domain name (e.g., `example.com`)
- Access to your domain's DNS settings (via Route 53, GoDaddy, Namecheap, etc.)
- EC2 instance with public IP address

### Step 10.1: Allocate and Assign Elastic IP (Recommended)

An Elastic IP ensures your domain always points to the same IP address, even if you restart your EC2 instance.

1. **Allocate Elastic IP**:

   - Go to AWS Console → EC2 → Elastic IPs → Allocate Elastic IP address
   - Click "Allocate"
   - Note the Elastic IP address

2. **Associate Elastic IP with EC2 Instance**:

   - Select the Elastic IP
   - Click "Actions" → "Associate Elastic IP address"
   - Select your EC2 instance
   - Click "Associate"

3. **Verify**:
   ```bash
   # On your EC2 instance, check the public IP
   curl http://169.254.169.254/latest/meta-data/public-ipv4
   ```

### Step 10.2: Configure DNS Records

Point your domain to your EC2 instance's Elastic IP.

#### Option A: Using AWS Route 53

1. **Go to Route 53** → Hosted Zones
2. **Select your domain** (or create a hosted zone if needed)
3. **Create A Record**:

   - Record name: `@` (for root domain) or `www` (for www subdomain)
   - Record type: `A`
   - Value: Your Elastic IP address (e.g., `54.123.45.67`)
   - TTL: `300` (5 minutes)
   - Click "Create records"

4. **For both root and www** (recommended):
   - Create A record for `@` → Elastic IP
   - Create A record for `www` → Elastic IP
   - Or create CNAME: `www` → `your-domain.com`

#### Option B: Using Other DNS Providers (GoDaddy, Namecheap, etc.)

1. **Log in to your DNS provider**
2. **Find DNS Management / DNS Settings**
3. **Add/Edit A Record**:

   - Type: `A`
   - Host/Name: `@` (or leave blank for root domain) or `www`
   - Points to/Value: Your Elastic IP address
   - TTL: `600` (10 minutes) or default

4. **Wait for DNS propagation** (usually 5-60 minutes):
   ```bash
   # Check DNS propagation
   dig your-domain.com
   # Or
   nslookup your-domain.com
   ```

### Step 10.3: Update Security Group

Ensure your EC2 Security Group allows HTTPS traffic:

1. **Go to EC2** → Security Groups → Select your instance's security group
2. **Edit Inbound Rules**:
   - Add rule: Type `HTTPS`, Port `443`, Source `0.0.0.0/0`
   - Ensure HTTP (port 80) is also allowed (needed for Let's Encrypt verification)

### Step 10.4: Update Environment Variables

Update your `.env` file on the EC2 instance:

```bash
# On EC2 instance
nano .env
```

Update these values:

```bash
# Server Name for Nginx (replace with your actual domain)
SERVER_NAME=your-domain.com www.your-domain.com

# Cookie Security (set to true when using HTTPS)
COOKIE_SECURE=true

# CORS Origin (update to your domain)
CORS_ORIGIN=https://your-domain.com

# Microsoft SSO redirect URL (if using)
MICROSOFT_REDIRECT_URL=https://your-domain.com/api/auth/microsoft/callback
```

### Step 10.5: Install Certbot for SSL Certificate

**On your EC2 instance**, install Certbot:

#### For Amazon Linux 2023:

```bash
sudo dnf install -y certbot python3-certbot-nginx
```

#### For Ubuntu:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

### Step 10.6: Update Docker Compose to Expose Port 443

Edit `docker-compose.yml`:

```bash
nano docker-compose.yml
```

Uncomment the HTTPS port in the nginx service:

```yaml
nginx:
  image: nginx:1.27-alpine
  depends_on:
    - app
  ports:
    - "80:80"
    - "443:443" # Uncomment this line
  # ... rest of config
```

### Step 10.7: Create SSL-Enabled Nginx Configuration

Create a new nginx configuration template with SSL support:

```bash
nano nginx.conf.template
```

Replace the content with:

```nginx
# HTTP server - redirects to HTTPS
server {
  listen 80;
  server_name ${SERVER_NAME};

  # Let's Encrypt challenge location
  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  # Redirect all other traffic to HTTPS
  location / {
    return 301 https://$host$request_uri;
  }
}

# HTTPS server
server {
  listen 443 ssl http2;
  server_name ${SERVER_NAME};

  # SSL certificate paths (will be set by Certbot)
  ssl_certificate /etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${SERVER_NAME}/privkey.pem;

  # SSL configuration
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;

  # Security headers
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;

  client_max_body_size 25m;

  # WebSocket support
  location /ws {
    proxy_pass http://app:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  # All other requests
  location / {
    proxy_pass http://app:5000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
  }
}
```

**Note**: For initial certificate generation, you'll need a simpler config first. See Step 10.8.

### Step 10.7 (Alternative): Use Standalone Certbot Method

Since nginx is running in Docker, we'll use Certbot's standalone mode:

1. **Stop nginx container temporarily**:

   ```bash
   docker compose stop nginx
   ```

2. **Obtain SSL certificate**:

   ```bash
   sudo certbot certonly --standalone \
     -d your-domain.com \
     -d www.your-domain.com \
     --email your-email@example.com \
     --agree-tos \
     --non-interactive
   ```

3. **Create directory for certificates in docker-compose volume**:

   ```bash
   sudo mkdir -p /etc/letsencrypt
   ```

4. **Update docker-compose.yml to mount certificates**:

   ```yaml
   nginx:
     image: nginx:1.27-alpine
     depends_on:
       - app
     ports:
       - "80:80"
       - "443:443"
     environment:
       - SERVER_NAME=${SERVER_NAME:-_}
     volumes:
       - ./nginx.conf.template:/etc/nginx/templates/default.conf.template:ro
       - /etc/letsencrypt:/etc/letsencrypt:ro # Mount SSL certificates
     restart: unless-stopped
     networks:
       - ticketflow-network
   ```

5. **Update nginx.conf.template** with the SSL configuration from Step 10.7

6. **Restart services**:
   ```bash
   docker compose up -d
   ```

### Step 10.8: Set Up Automatic Certificate Renewal

Let's Encrypt certificates expire every 90 days. Set up automatic renewal:

1. **Test renewal**:

   ```bash
   sudo certbot renew --dry-run
   ```

2. **Add cron job for automatic renewal**:

   ```bash
   sudo crontab -e
   ```

3. **Add this line** (runs twice daily and restarts nginx if certificate is renewed):

   ```bash
   0 0,12 * * * certbot renew --quiet --deploy-hook "docker compose -f /path/to/your/docker-compose.yml restart nginx"
   ```

   **Or create a renewal script**:

   ```bash
   sudo nano /usr/local/bin/certbot-renew.sh
   ```

   Add:

   ```bash
   #!/bin/bash
   cd /path/to/your/ticketflow/directory
   certbot renew --quiet
   docker compose restart nginx
   ```

   Make executable:

   ```bash
   sudo chmod +x /usr/local/bin/certbot-renew.sh
   ```

   Add to crontab:

   ```bash
   0 0,12 * * * /usr/local/bin/certbot-renew.sh
   ```

### Step 10.9: Verify Domain Configuration

1. **Check DNS propagation**:

   ```bash
   dig your-domain.com
   nslookup your-domain.com
   ```

2. **Test HTTP redirect**:

   ```bash
   curl -I http://your-domain.com
   # Should return 301 redirect to HTTPS
   ```

3. **Test HTTPS**:

   ```bash
   curl -I https://your-domain.com
   # Should return 200 OK
   ```

4. **Verify SSL certificate**:

   - Visit `https://your-domain.com` in a browser
   - Check the padlock icon in the address bar
   - Or use: `openssl s_client -connect your-domain.com:443 -servername your-domain.com`

5. **Test application**:
   - Visit `https://your-domain.com` in your browser
   - Verify the application loads correctly
   - Test WebSocket connections if applicable

### Step 10.10: Troubleshooting Domain Issues

#### DNS Not Resolving:

```bash
# Check if DNS is propagated
dig your-domain.com +short
# Should return your Elastic IP

# Check from different locations
# Use online tools like: https://dnschecker.org
```

#### SSL Certificate Issues:

```bash
# Check certificate status
sudo certbot certificates

# View nginx logs
docker compose logs nginx

# Test nginx configuration
docker compose exec nginx nginx -t
```

#### Port 443 Not Accessible:

```bash
# Check if port 443 is open
sudo netstat -tlnp | grep 443

# Check security group rules in AWS Console
# Ensure HTTPS (443) is allowed from 0.0.0.0/0
```

#### Certificate Renewal Fails:

- Ensure port 80 is open (needed for Let's Encrypt verification)
- Check that DNS still points to your EC2 instance
- Verify nginx is running and accessible
- Check Certbot logs: `sudo tail -f /var/log/letsencrypt/letsencrypt.log`

## Step 11: Set Up Automatic Backups (Recommended)

Create a backup script:

```bash
# Create backup directory
mkdir -p ~/backups

# Create backup script
nano ~/backup-db.sh
```

Add this content:

```bash
#!/bin/bash
BACKUP_DIR=~/backups
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ticketflow_db_$DATE.sql"

docker compose exec -T postgres pg_dump -U ticketflow_user ticketflow > $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Keep only last 7 days of backups
find $BACKUP_DIR -name "ticketflow_db_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE.gz"
```

Make it executable:

```bash
chmod +x ~/backup-db.sh
```

Add to crontab for daily backups:

```bash
crontab -e
# Add this line (runs daily at 2 AM):
0 2 * * * /home/ec2-user/backup-db.sh
```

## Step 12: Monitor and Maintain

### View Logs:

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f app
docker compose logs -f postgres
docker compose logs -f nginx
```

### Restart Services:

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart app
```

### Update Application:

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build
```

### Stop Services:

```bash
docker compose down
```

### Stop and Remove Volumes (⚠️ Deletes Data):

```bash
docker compose down -v
```

## Step 13: Security Hardening

1. **Update Security Group**:

   - Remove SSH access from 0.0.0.0/0
   - Only allow SSH from your IP
   - Use AWS Systems Manager Session Manager instead of SSH if possible

2. **Set Strong Passwords**:

   - Use strong `POSTGRES_PASSWORD` in `.env`
   - Rotate secrets regularly

3. **Enable HTTPS**:

   - Use Let's Encrypt or AWS Certificate Manager
   - Set `COOKIE_SECURE=true` in production

4. **Regular Updates**:

   ```bash
   # Update system packages
   sudo dnf update -y  # Amazon Linux
   # sudo apt update && sudo apt upgrade -y  # Ubuntu

   # Update Docker images
   docker compose pull
   docker compose up -d
   ```

## Troubleshooting

### Database Connection Issues:

```bash
# Check if postgres is healthy
docker compose ps postgres

# Check postgres logs
docker compose logs postgres

# Test connection manually
docker compose exec postgres psql -U ticketflow_user -d ticketflow
```

### Application Not Starting:

```bash
# Check application logs
docker compose logs app

# Check if migrations ran
docker compose exec app npm run db:push

# Restart app service
docker compose restart app
```

### Port Already in Use:

```bash
# Check what's using port 80
sudo lsof -i :80

# Stop conflicting service or change port in docker-compose.yml
```

### Out of Disk Space:

```bash
# Check disk usage
df -h

# Clean up Docker
docker system prune -a

# Remove old logs
docker compose logs --tail=0
```

## Useful Commands Reference

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# View logs
docker compose logs -f

# Rebuild after code changes
docker compose up -d --build

# Execute command in container
docker compose exec app npm run db:push
docker compose exec postgres psql -U ticketflow_user -d ticketflow

# Backup database
docker compose exec -T postgres pg_dump -U ticketflow_user ticketflow > backup.sql

# Restore database
docker compose exec -T postgres psql -U ticketflow_user ticketflow < backup.sql

# Check resource usage
docker stats

# View container details
docker compose ps
docker inspect ticketflow-postgres
```

## Next Steps

1. Configure your domain DNS to point to EC2 IP
2. Set up SSL certificate
3. Configure email service (Mailtrap or AWS SES)
4. Set up monitoring and alerts
5. Configure automated backups
6. Set up CI/CD pipeline for deployments
