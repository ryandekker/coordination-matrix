# Deployment Guide

Production deployment and migration instructions for Coordination Matrix.

## Production Architecture

```
                    ┌─────────────────────────────────────┐
                    │         Cloudflare Pages            │
                    │  https://coordination-matrix.pages  │
                    │         (Static Frontend)           │
                    └────────────────┬────────────────────┘
                                     │ API calls
                    ┌────────────────▼────────────────────┐
                    │            Render                   │
                    │    (Backend - Express.js API)       │
                    │   Auto-deploys from prod branch     │
                    └────────────────┬────────────────────┘
                                     │
                    ┌────────────────▼────────────────────┐
                    │         MongoDB Atlas               │
                    │       (Managed Database)            │
                    └─────────────────────────────────────┘
```

## Production Services

| Service | Platform | Deployment |
|---------|----------|------------|
| Frontend | Cloudflare Pages | Auto-deploys from `prod` branch |
| Backend | Render | Auto-deploys from `prod` branch |
| Database | MongoDB Atlas | Managed cluster |

## Deployment Workflow

### Deploying to Production

1. **Merge to prod branch** - Both Cloudflare Pages and Render watch the `prod` branch
2. **Run migrations** - After backend deploys, run any pending migrations (see below)
3. **Verify** - Check the health endpoint and frontend

```bash
# Merge main to prod
git checkout prod
git merge main
git push origin prod

# Wait for deployments to complete, then run migrations
MONGODB_URI="mongodb+srv://..." npm --prefix backend run db:migrate
```

### Environment Variables

**Render (Backend):**

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Secure random string (use `openssl rand -hex 32`) |
| `CORS_ORIGIN` | `https://coordination-matrix.pages.dev` |
| `PORT` | `3001` (Render default) |

**Cloudflare Pages (Frontend):**

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API URL (Render URL + `/api`) |
| `NEXT_PUBLIC_APP_NAME` | Application display name |

---

## Database Migrations

The migration system allows safe, incremental schema updates without data loss.

### Migration Commands

```bash
# Check migration status (shows applied and pending)
npm --prefix backend run db:migrate:status

# Run pending migrations
npm --prefix backend run db:migrate
```

### Running Migrations Against Production

**Before running migrations:**
1. Ensure the backend is not actively processing requests (consider maintenance mode)
2. Take a backup of the database (MongoDB Atlas has automated backups)

```bash
# Set the production MongoDB URI
export MONGODB_URI="mongodb+srv://username:password@cluster.mongodb.net/coordination_matrix?retryWrites=true&w=majority"

# Check what migrations are pending
npm --prefix backend run db:migrate:status

# Run the migrations
npm --prefix backend run db:migrate
```

### Creating New Migrations

Migrations live in `backend/src/migrations/`. To create a new migration:

1. Create a new file with the format `YYYY-MM-DD-NNN-description.ts`
2. Implement the `Migration` interface:

```typescript
// backend/src/migrations/2024-12-19-001-example-migration.ts
import { Migration, migrationHelpers } from './runner.js';
import { Db } from 'mongodb';

export const migration: Migration = {
  id: '2024-12-19-001-example-migration',
  name: 'Example migration description',
  schemaVersion: 5, // Optional: increment if changing schema

  async up(db: Db) {
    // Add a field to all documents
    await migrationHelpers.addFieldIfMissing(db, 'tasks', 'newField', 'defaultValue');

    // Or create an index
    await migrationHelpers.ensureIndex(db, 'tasks', { newField: 1 });
  },

  async down(db: Db) {
    // Optional: rollback logic
    await db.collection('tasks').updateMany({}, { $unset: { newField: '' } });
  },
};
```

3. Register it in `backend/src/migrations/index.ts`:

```typescript
import { migration as exampleMigration } from './2024-12-19-001-example-migration.js';

export const migrations: Migration[] = [
  // ... existing migrations
  exampleMigration,
];
```

### Schema Sync: Local vs Production

The local development database is initialized from `mongo-init/01-init-db.js`. Production may have schema differences if:
- New fields were added to init scripts but not yet migrated in production
- Production has data created before certain schema changes

**To identify discrepancies:**

1. Compare `mongo-init/01-init-db.js` against production schema
2. Write migrations for any fields/indexes missing in production
3. Test migrations locally first
4. Run against production

---

## Self-Hosted Deployment (Docker)

For self-hosted deployments using Docker Compose.

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

### Architecture (Self-Hosted)

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

---

## Operations

### Health Checks

```bash
# Backend health
curl https://api.yourdomain.com/health

# MongoDB health (via Docker)
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"
```

### Backup and Restore

**MongoDB Atlas:**
- Automatic daily backups enabled
- Point-in-time recovery available
- Manual snapshot via Atlas UI

**Self-hosted MongoDB:**

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

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_ROOT_USER` | Yes | admin | MongoDB admin username |
| `MONGO_ROOT_PASSWORD` | Yes | adminpassword | MongoDB admin password |
| `MONGODB_URI` | No | auto | Full MongoDB connection string (overrides above) |
| `NODE_ENV` | No | development | Environment (production/development) |
| `JWT_SECRET` | Yes | - | Secret for JWT token signing |
| `PORT` | No | 3001 | Backend API port |
| `CORS_ORIGIN` | No | localhost:3000 | Allowed CORS origin |
| `NEXT_PUBLIC_API_URL` | Yes | - | Backend API URL for frontend |
| `NEXT_PUBLIC_APP_NAME` | No | Coordination Matrix | App display name |

---

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
- [ ] Run pending migrations

---

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

### Migration failures

```bash
# Check migration status
npm --prefix backend run db:migrate:status

# View detailed logs (migrations print to console)
MONGODB_URI="..." npx --prefix backend tsx src/migrations/cli.ts run
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
