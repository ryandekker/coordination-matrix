# Development Setup

Quick guide to get the development environment running with hot reload.

## Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **Docker** - For MongoDB only ([Docker Desktop](https://www.docker.com/products/docker-desktop/) or [Docker Engine](https://docs.docker.com/engine/install/))

## Quick Start

```bash
# 1. Install all dependencies (root, backend, frontend)
npm run install:all

# 2. Start development (MongoDB + backend + frontend with hot reload)
npm run dev
```

That's it! The app will be available at:
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **API Health Check:** http://localhost:3001/health

Changes to backend or frontend code will automatically reload.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start everything (MongoDB + backend + frontend) |
| `npm run dev:backend` | Start only the backend API |
| `npm run dev:frontend` | Start only the frontend |
| `npm run dev:daemon` | Start the automation daemon |
| `npm run db:start` | Start MongoDB |
| `npm run db:stop` | Stop MongoDB |
| `npm run db:reset` | Reset MongoDB (clears all data, re-seeds) |
| `npm run db:logs` | View MongoDB logs |
| `npm run build` | Build both backend and frontend |
| `npm run lint` | Lint both backend and frontend |
| `npm run test` | Run backend tests |

## How It Works

The dev setup runs:
1. **MongoDB** in Docker (required for data persistence)
2. **Backend** locally with `tsx watch` for instant TypeScript hot reload
3. **Frontend** locally with `next dev` for React fast refresh

```
┌─────────────────────────────────────────────────────────┐
│  Your Browser                                           │
│  http://localhost:3000                                  │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  Frontend (Next.js dev server)                          │
│  - Hot reload on file changes                           │
│  - Proxies /api/* to backend                            │
│  localhost:3000                                         │
└─────────────────┬───────────────────────────────────────┘
                  │ /api/* requests
┌─────────────────▼───────────────────────────────────────┐
│  Backend (Express + tsx watch)                          │
│  - Hot reload on file changes                           │
│  - REST API                                             │
│  localhost:3001                                         │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│  MongoDB (Docker)                                       │
│  - Persistent data volume                               │
│  - Auto-initialized with schema + seed data             │
│  localhost:27017                                        │
└─────────────────────────────────────────────────────────┘
```

## Database Management

### View Database with MongoDB Express

```bash
# Start MongoDB with the management UI
docker compose -f docker-compose.dev.yml --profile tools up -d

# Access at http://localhost:8081
# Login: admin / admin (default)
```

### Reset Database

To clear all data and re-seed:

```bash
npm run db:reset
```

### Connect with MongoDB Shell

```bash
docker exec -it coordination-mongodb-dev mongosh \
  -u admin -p adminpassword --authenticationDatabase admin \
  coordination_matrix
```

## Environment Variables

Default environment variables work out of the box. To customize, create a `.env` file in the root:

```bash
# Copy the example
cp .env.example .env

# Edit as needed
```

Key variables:
- `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` - MongoDB credentials
- `JWT_SECRET` - Secret for JWT tokens
- `NODE_ENV` - development / production

## Troubleshooting

### Port already in use

```bash
# Find what's using the port
lsof -i :3000  # or :3001, :27017

# Kill the process
kill -9 <PID>
```

### MongoDB connection refused

```bash
# Check if MongoDB is running
docker ps

# If not running, start it
npm run db:start

# Check logs for errors
npm run db:logs
```

### Dependencies out of sync

```bash
# Reinstall everything
rm -rf node_modules backend/node_modules frontend/node_modules
npm run install:all
```

### Backend not hot reloading

The backend uses `tsx watch` which watches for file changes. If it's not reloading:

```bash
# Restart just the backend
# (Ctrl+C to stop dev, then restart)
npm run dev
```

## Running Individual Services

If you prefer running services in separate terminals:

```bash
# Terminal 1: MongoDB
npm run db:start

# Terminal 2: Backend
npm run dev:backend

# Terminal 3: Frontend
npm run dev:frontend

# Terminal 4: Automation Daemon (optional)
npm run dev:daemon
```

## Full Docker Mode

For testing the production-like Docker setup:

```bash
# Start all services in Docker
npm run docker:up

# View logs
npm run docker:logs

# Stop all services
npm run docker:down
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment instructions.
