# TicketFlow Render.com Deployment Guide

## 🚀 Quick Start

This guide will help you deploy your TicketFlow application to Render.com in under 10 minutes.

## Prerequisites

- [ ] GitHub repository with your TicketFlow code
- [ ] Render.com account (free tier works for testing)
- [ ] AWS credentials (optional - for email and AI features)

## Step 1: Connect Repository to Render

1. **Go to [Render.com](https://render.com)** and sign in
2. **Click "New +"** → **"Blueprint"**
3. **Connect your GitHub repository**
4. **Select your TicketFlow repository**
5. **Click "Apply"**

## Step 2: Configure Services

Render will automatically detect your `render.yaml` file and create:

### ✅ Web Service (ticketflow-app)
- **Runtime**: Node.js 20
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Health Check**: `/api/security/health`

### ✅ PostgreSQL Database (ticketflow-db)
- **Version**: PostgreSQL 15
- **Plan**: Free (90 days) or Starter ($7/month)

## Step 3: Environment Variables

### Required Variables (Auto-configured)
- `DATABASE_URL` - Automatically provided by Render PostgreSQL
- `PORT` - Automatically set by Render
- `NODE_ENV=production` - Set in render.yaml

### Security Variables (Auto-generated)
- `SESSION_SECRET` - Auto-generated secure random string
- `JWT_SECRET` - Auto-generated secure random string

### Optional Variables (Add in Render Dashboard)

**AWS Services** (if you have credentials):
```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
```

**Microsoft SSO** (if configured):
```
MICROSOFT_CLIENT_ID=your-azure-app-id
MICROSOFT_CLIENT_SECRET=your-azure-secret
MICROSOFT_TENANT_ID=your-tenant-id
```

## Step 4: Deploy

1. **Click "Create New Web Service"**
2. **Wait for build to complete** (5-10 minutes)
3. **Check build logs** for any errors
4. **Verify health check** passes

## Step 5: Post-Deployment Setup

### 1. Access Your Application
- Your app will be available at: `https://ticketflow-app.onrender.com`
- Replace `ticketflow-app` with your actual service name

### 2. Create Admin User
1. **Navigate to** `/auth` on your deployed app
2. **Register the first user** (this becomes admin)
3. **Update user role** in database (if needed):
   ```sql
   UPDATE users SET role = 'admin', is_approved = true WHERE email = 'your-admin@email.com';
   ```

### 3. Configure AWS Services (Optional)
1. **Go to Admin Panel** → **API Keys**
2. **Add AWS credentials** for:
   - **SES** (email sending)
   - **Bedrock** (AI features)

### 4. Test Features
- [ ] **Login/Registration** works
- [ ] **WebSocket connections** (real-time updates)
- [ ] **Email sending** (if AWS SES configured)
- [ ] **AI features** (if AWS Bedrock configured)

## 🔧 Troubleshooting

### Build Failures

**Common Issues:**
- **Missing dependencies**: Check `package.json` includes all required packages
- **TypeScript errors**: Build will fail on type errors in server code
- **Environment variables**: Ensure all required vars are set

**Solutions:**
```bash
# Test build locally
npm run build

# Check for missing dependencies
npm install

# Fix TypeScript errors
npm run check
```

### Runtime Errors

**Database Connection Issues:**
- Verify `DATABASE_URL` is set correctly
- Check PostgreSQL service is running
- Ensure database migrations are applied

**WebSocket Issues:**
- Verify WebSocket endpoint is accessible
- Check for CORS configuration
- Ensure proper proxy settings

### Performance Issues

**Cold Starts (Free Tier):**
- Free tier sleeps after 15 minutes of inactivity
- Wake time: ~50 seconds
- Upgrade to paid plan for always-on service

**Memory Issues:**
- Monitor memory usage in Render dashboard
- Consider upgrading to higher plan
- Optimize application code

## 📊 Monitoring

### Health Checks
- **Endpoint**: `/api/security/health`
- **Checks**: Database, AWS services, security features
- **Frequency**: Every 5 minutes

### Logs
- **Access**: Render Dashboard → Your Service → Logs
- **Levels**: Info, Warning, Error
- **Retention**: 7 days (free), 30 days (paid)

### Metrics
- **Response Time**: Average request duration
- **Error Rate**: Failed requests percentage
- **Memory Usage**: RAM consumption
- **CPU Usage**: Processing load

## 💰 Cost Breakdown

### Free Tier
- **Web Service**: $0 (with limitations)
- **PostgreSQL**: $0 for 90 days, then $7/month
- **Total**: $0 → $7/month after 90 days

### Starter Tier (Recommended)
- **Web Service**: $7/month
- **PostgreSQL**: $7/month
- **Total**: $14/month

### Features Comparison

| Feature | Free | Starter |
|---------|------|---------|
| Always On | ❌ | ✅ |
| Custom Domain | ✅ | ✅ |
| SSL Certificate | ✅ | ✅ |
| WebSockets | ✅ | ✅ |
| Build Time | 5 min | 5 min |
| Sleep Time | 15 min | Never |
| Wake Time | 50s | Instant |

## 🔄 Updates & Maintenance

### Automatic Deployments
- **Trigger**: Push to main branch
- **Process**: Automatic build and deploy
- **Rollback**: Available in Render dashboard

### Manual Deployments
1. **Go to Render Dashboard**
2. **Select your service**
3. **Click "Manual Deploy"**
4. **Choose branch/commit**

### Database Migrations
```bash
# Run migrations after deployment
npm run db:push
```

### Environment Variable Updates
1. **Go to Render Dashboard**
2. **Select your service**
3. **Go to Environment tab**
4. **Add/Update variables**
5. **Redeploy service**

## 🛡️ Security Best Practices

### Environment Variables
- ✅ Never commit secrets to Git
- ✅ Use Render's secure environment variable storage
- ✅ Rotate secrets regularly
- ✅ Use different secrets for different environments

### Database Security
- ✅ Use strong passwords
- ✅ Enable SSL connections
- ✅ Regular backups
- ✅ Monitor access logs

### Application Security
- ✅ Enable rate limiting
- ✅ Use HTTPS only
- ✅ Validate all inputs
- ✅ Keep dependencies updated

## 📞 Support

### Render Support
- **Documentation**: [render.com/docs](https://render.com/docs)
- **Community**: [community.render.com](https://community.render.com)
- **Status**: [status.render.com](https://status.render.com)

### TicketFlow Support
- **Issues**: GitHub Issues
- **Documentation**: Check project README
- **Community**: Project discussions

## 🎉 Success Checklist

- [ ] Application deployed successfully
- [ ] Health check passing
- [ ] Admin user created
- [ ] Database migrations applied
- [ ] WebSocket connections working
- [ ] Email sending configured (if applicable)
- [ ] AI features working (if applicable)
- [ ] Custom domain configured (optional)
- [ ] SSL certificate active
- [ ] Monitoring set up

## Next Steps

1. **Set up monitoring** and alerts
2. **Configure custom domain** (optional)
3. **Set up automated backups**
4. **Implement CI/CD pipeline**
5. **Scale as needed**

---

**🎊 Congratulations!** Your TicketFlow application is now live on Render.com!

For additional help, refer to the main [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) or create an issue in the project repository.
