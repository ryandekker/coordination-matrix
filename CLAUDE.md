# Claude Code Instructions

Project context and conventions for Claude Code.

**Note:** The `.claude/settings.local.json` file contains shared Claude Code permissions (auto-allowed commands) and should be committed to the repo so all developers have consistent settings.

## Git Workflow

- **Main branch**: `main` - use this as the base for all PRs
- Feature branches should be named descriptively (e.g., `feature/add-workflow-steps`)

## Project Overview

Coordination Matrix is a full-stack AI workflow task management system:
- **Frontend**: Next.js 14 with React, TanStack Table, shadcn/ui (port 3000)
- **Backend**: Express.js with TypeScript (port 3001)
- **Database**: MongoDB 7.0 (port 27017)

## Development Setup

**Quick start (one command):**
```bash
npm run dev
```

This starts MongoDB (Docker), backend, and frontend with hot reload. First time setup requires `npm run install:all`.

**Key commands:**
- `npm run dev` - Start everything with hot reload
- `npm run db:reset` - Reset database (clears data, re-seeds)
- `npm run docker:up` - Full Docker mode (production-like)

See [DEVELOPMENT.md](./DEVELOPMENT.md) for full details.

## Code Structure

```
coordination-matrix/
├── frontend/          # Next.js app (app router)
│   └── src/
│       ├── app/       # Pages and routes
│       └── components/# React components
├── backend/           # Express API
│   └── src/
│       ├── routes/    # API endpoints
│       ├── services/  # Business logic
│       └── daemon/    # Automation daemon
├── mongo-init/        # DB initialization scripts
└── docs/              # API documentation
```

## Conventions

- **API routes**: All under `/api/*`, frontend proxies to backend
- **Components**: Use shadcn/ui components from `frontend/src/components/ui/`
- **Validation**: Zod schemas for both frontend forms and backend
- **Styling**: Tailwind CSS with class-variance-authority

## Testing Changes

After making changes:
1. Backend changes auto-reload via `tsx watch`
2. Frontend changes auto-reload via Next.js fast refresh
3. For database schema changes, run `npm run db:reset`

**For API testing (preferred method):** Use the CLI tool rather than the web UI, as the web UI requires authentication setup. The CLI stores credentials in `~/.matrix-cli.json`:

```bash
# Check if already authenticated
npm run cli status

# List workflows to verify API works
npm run cli workflows --brief

# List tasks
npm run cli tasks --status pending --brief
```

## API Documentation

Full API documentation is available at:
- **Swagger UI**: http://localhost:3001/api-docs (interactive API explorer)
- **OpenAPI Spec**: http://localhost:3001/api-docs.json
- **Reference Doc**: [docs/API-endpoints.md](./docs/API-endpoints.md) (complete endpoint reference)

### CLI Tool

A CLI tool is available for easy API interaction:

```bash
# Show help
npm run cli help

# Login and store credentials
npm run cli login

# Or use API key
npm run cli use-key cm_ak_live_xxxxx

# List tasks
npm run cli tasks --status pending --brief

# Create a task
npm run cli task:create --title "New task" --status pending

# Generic API request
npm run cli request /api/tasks --method GET

# Test SSE (Server-Sent Events) connection
npm run cli events --duration 30

# Test SSE while creating a task in another terminal
npm run cli events --duration 30 --quiet  # Suppress heartbeats
```

**Note:** Always prefer using the CLI for API testing rather than the browser, as it provides clearer output and avoids authentication complexities.

See `./scripts/matrix-cli.mjs --help` for all commands.

## Common Tasks

**Add a new API endpoint:**
1. Create route file in `backend/src/routes/`
2. Register in `backend/src/index.ts`
3. Add Swagger documentation in `backend/src/swagger.ts`

**Add a new UI component:**
1. Use `npx shadcn@latest add <component>` for shadcn components
2. Custom components go in `frontend/src/components/`

**Modify database schema:**
1. Update `mongo-init/01-init-db.js` for schema validation
2. Update seed data in `mongo-init/02-seed-data.js` if needed
3. Run `npm run db:reset` to apply
