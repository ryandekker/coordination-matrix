# Deployment Guide

Production deployment and migration instructions for Coordination Matrix.

## Production Architecture

```
     Browser
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    cm.hcizero.com                             │
│                  (Cloudflare DNS)                             │
│                                                              │
│   /*  ──────────►  Cloudflare Pages (frontend)               │
│                    coordination-matrix.pages.dev              │
│                    Next.js app (static + edge functions)      │
│                                                              │
│   /api/*  ─────►  Render (backend, via Cloudflare proxy)     │
│                    Express.js API, port 3001                  │
│                    Backend /health endpoint lives here        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
               ┌───────────────────┐
               │   MongoDB Atlas   │
               │ (Managed cluster) │
               └───────────────────┘
```

### URL Routing (Important)

All traffic flows through `cm.hcizero.com` via Cloudflare:

| URL Pattern | Serves | Platform |
|-------------|--------|----------|
| `cm.hcizero.com/*` | Frontend (Next.js pages) | Cloudflare Pages |
| `cm.hcizero.com/api/*` | Backend API (proxied) | Render |
| `cm.hcizero.com/health` | **Frontend 404** (not backend!) | Cloudflare Pages |
| `coordination-matrix.pages.dev` | Frontend (alias) | Cloudflare Pages |

**Key detail:** The backend's `/health` endpoint is **not** reachable through `cm.hcizero.com/health` because Cloudflare Pages handles all non-`/api` routes as frontend paths. To directly health-check the backend, use the Render service URL or check via `/api/tasks` with authentication.

## Production Services

| Service | Platform | URL | Deploys From |
|---------|----------|-----|-------------|
| Frontend | Cloudflare Pages | `cm.hcizero.com`, `coordination-matrix.pages.dev` | `wrangler pages deploy --branch prod` |
| Backend | Render | `cm.hcizero.com/api/*` (proxied) | Auto-deploys from `prod` branch push |
| Database | MongoDB Atlas | Internal connection string | Managed |

### Cloudflare Pages Production Branch

The Cloudflare Pages project has **`prod`** set as the production branch. When deploying with `wrangler pages deploy`, you **must** pass `--branch prod` for the deploy to go to production. Without this flag, deploys land as previews and will NOT be served on `cm.hcizero.com` or `coordination-matrix.pages.dev`.

## Deployment Workflow

### Automated Deploy (Recommended)

```bash
# Full 6-step pipeline: test → build → deploy backend → deploy frontend → migrate → verify
npm run deploy

# Resume from a specific step (e.g., after fixing a failure)
bash scripts/deploy/deploy.sh --from 3

# Run a single step
bash scripts/deploy/deploy.sh --step 4
```

### Manual Deploy

```bash
# 1. Merge main to prod and push (triggers Render auto-deploy)
git checkout prod && git merge main && git push origin prod
git checkout main

# 2. Build and deploy frontend to Cloudflare Pages
cd frontend
npx @cloudflare/next-on-pages
npx wrangler pages deploy .vercel/output/static \
  --project-name coordination-matrix --branch prod
cd ..

# 3. Run migrations
MONGODB_URI="mongodb+srv://..." npm --prefix backend run db:migrate
```

### Environment Variables

**Render (Backend):**

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Secure random string (use `openssl rand -hex 32`) |
| `CORS_ORIGIN` | `https://cm.hcizero.com` |
| `PORT` | `3001` (Render default) |

**Cloudflare Pages (Frontend):**

The frontend uses relative `/api` paths in production (no `NEXT_PUBLIC_API_URL` needed). The Cloudflare proxy rule routes `/api/*` to Render.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_NAME` | Application display name (optional) |

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
# Backend health (cloud production — must go through /api since Cloudflare handles root)
# Use authenticated API request as a liveness check:
curl -s -H "X-API-Key: $API_KEY" https://cm.hcizero.com/api/tasks?limit=1

# Backend health (if you have the direct Render URL):
curl https://<render-service>.onrender.com/health

# MongoDB health (self-hosted Docker only)
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
