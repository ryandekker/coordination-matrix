# Deployment Guide

Production deployment options for Coordination Matrix.

## Overview

The application consists of three services:
- **Frontend** - Next.js React application (port 3000)
- **Backend** - Express.js REST API (port 3001)
- **MongoDB** - Database (port 27017)

## Docker Compose (Recommended)

The simplest deployment method using Docker Compose.

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+
- 2GB RAM minimum
- Ports 3000, 3001, 27017 available

### Quick Deploy

```bash
# Clone the repository
git clone <repo-url>
cd coordination-matrix

# Create production environment file
cp .env.example .env

# Edit with production values
nano .env
```

**Required `.env` configuration:**

```bash
# MongoDB
MONGO_ROOT_USER=admin
MONGO_ROOT_PASSWORD=<strong-password>

# Security
JWT_SECRET=<random-256-bit-string>
NODE_ENV=production

# URLs (adjust for your domain)
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api
CORS_ORIGIN=https://yourdomain.com
```

**Start the services:**

```bash
# Build and start
docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f
```

### Architecture

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │  (nginx/caddy)  │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   │
┌─────────────────┐  ┌─────────────────┐         │
│    Frontend     │  │    Backend      │         │
│  (Next.js)      │  │  (Express.js)   │         │
│  Port 3000      │  │  Port 3001      │         │
└─────────────────┘  └────────┬────────┘         │
                              │                  │
                     ┌────────▼────────┐         │
                     │    MongoDB      │         │
                     │  Port 27017     │◄────────┘
                     │  (internal)     │  healthchecks
                     └─────────────────┘
```

### Reverse Proxy Setup

For production, add a reverse proxy. Example with nginx:

```nginx
# /etc/nginx/sites-available/coordination-matrix
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Backend API
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Health Checks

Built-in health checks for monitoring:

```bash
# Backend health
curl http://localhost:3001/health

# MongoDB health (via Docker)
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"
```

### Backup and Restore

**Backup MongoDB:**

```bash
# Create backup
docker compose exec mongodb mongodump \
  -u admin -p <password> --authenticationDatabase admin \
  -d coordination_matrix --archive=/tmp/backup.archive

# Copy from container
docker cp coordination-mongodb:/tmp/backup.archive ./backup-$(date +%Y%m%d).archive
```

**Restore MongoDB:**

```bash
# Copy to container
docker cp ./backup.archive coordination-mongodb:/tmp/backup.archive

# Restore
docker compose exec mongodb mongorestore \
  -u admin -p <password> --authenticationDatabase admin \
  --archive=/tmp/backup.archive --drop
```

### Scaling

For high availability, consider:

1. **MongoDB Replica Set** - Replace single MongoDB with a replica set
2. **Multiple Backend Instances** - Scale horizontally behind a load balancer
3. **CDN for Frontend** - Use a CDN for static assets

Example scaling with Docker Compose:

```bash
# Scale backend to 3 instances
docker compose up -d --scale backend=3
```

## Kubernetes Deployment

For Kubernetes deployments, create manifests based on the Docker Compose configuration.

### Key Considerations

1. **Secrets** - Store MongoDB credentials and JWT secret in Kubernetes Secrets
2. **Persistent Volume** - Use PersistentVolumeClaim for MongoDB data
3. **Services** - Create ClusterIP services for internal communication
4. **Ingress** - Configure Ingress for external access

### Example Deployment

```yaml
# mongodb-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      containers:
      - name: mongodb
        image: mongo:7.0
        ports:
        - containerPort: 27017
        env:
        - name: MONGO_INITDB_ROOT_USERNAME
          valueFrom:
            secretKeyRef:
              name: mongodb-secret
              key: username
        - name: MONGO_INITDB_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mongodb-secret
              key: password
        volumeMounts:
        - name: mongodb-data
          mountPath: /data/db
      volumes:
      - name: mongodb-data
        persistentVolumeClaim:
          claimName: mongodb-pvc
```

## Cloud Platform Deployments

### Railway / Render / Fly.io

These platforms support Docker deployments:

1. Connect your repository
2. Set environment variables in the platform dashboard
3. Deploy each service separately or use the Docker Compose file

### AWS / GCP / Azure

Options include:
- **Container Services** (ECS, Cloud Run, Container Apps)
- **Kubernetes** (EKS, GKE, AKS)
- **VM-based** with Docker Compose

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_ROOT_USER` | Yes | admin | MongoDB admin username |
| `MONGO_ROOT_PASSWORD` | Yes | adminpassword | MongoDB admin password |
| `NODE_ENV` | No | development | Environment (production/development) |
| `JWT_SECRET` | Yes | - | Secret for JWT token signing |
| `PORT` | No | 3001 | Backend API port |
| `MONGODB_URI` | No | auto | Full MongoDB connection string |
| `CORS_ORIGIN` | No | localhost:3000 | Allowed CORS origin |
| `NEXT_PUBLIC_API_URL` | Yes | - | Backend API URL for frontend |
| `NEXT_PUBLIC_APP_NAME` | No | Coordination Matrix | App display name |

## Security Checklist

Before going to production:

- [ ] Change default MongoDB credentials
- [ ] Generate strong JWT secret (`openssl rand -hex 32`)
- [ ] Set `NODE_ENV=production`
- [ ] Configure HTTPS with valid SSL certificates
- [ ] Set proper CORS origin
- [ ] Enable firewall, only expose ports 80/443
- [ ] Set up regular database backups
- [ ] Configure monitoring and alerting
- [ ] Review MongoDB access controls

## Monitoring

Recommended monitoring setup:

1. **Container Metrics** - Use Prometheus + Grafana or cloud provider metrics
2. **Application Logs** - Aggregate with ELK stack or cloud logging
3. **Uptime Monitoring** - Use external uptime monitor for `/health` endpoint
4. **Database Monitoring** - MongoDB Compass or cloud provider tools

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs backend
docker compose logs frontend

# Check container status
docker compose ps -a
```

### Database connection issues

```bash
# Test MongoDB connection
docker compose exec mongodb mongosh -u admin -p <password>

# Check network
docker network inspect coordination-matrix_coordination-network
```

### Out of memory

```bash
# Check container resource usage
docker stats

# Increase limits in docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 512M
```
