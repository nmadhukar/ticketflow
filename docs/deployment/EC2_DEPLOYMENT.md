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

### Using Nginx with Let's Encrypt:

1. **Install Certbot**:

   ```bash
   sudo dnf install -y certbot python3-certbot-nginx
   # Or for Ubuntu:
   # sudo apt install -y certbot python3-certbot-nginx
   ```

2. **Update nginx.conf.template** to include SSL configuration

3. **Get SSL Certificate**:

   ```bash
   sudo certbot --nginx -d your-domain.com
   ```

4. **Update docker-compose.yml** to expose port 443:

   ```yaml
   ports:
     - "80:80"
     - "443:443"
   ```

5. **Restart services**:
   ```bash
   docker compose restart nginx
   ```

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
