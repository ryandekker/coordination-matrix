# Automation Daemon (Event-Based)

**Note:** For production use, see [Task Daemon](./task-daemon.md) which uses polling and works with remote APIs.

This document describes the event-based automation daemon in `backend/src/daemon/automation-daemon.ts`.

## Current Status

The event-based daemon uses an in-memory `EventEmitter` for the event bus. This means it **only works within the same Node.js process** as the backend API. Running it as a standalone process (`npm run dev:daemon`) will not receive any events.

For this daemon to work as a standalone process, it would need:
- MongoDB change streams, OR
- Redis pub/sub, OR
- Another cross-process messaging system

## When to Use Which

| Use Case | Recommended |
|----------|-------------|
| Remote API / distributed workers | [Task Daemon](./task-daemon.md) |
| Local development testing | Task Daemon (--once flag) |
| Future: embedded automation | Automation Daemon (after event bus upgrade) |

## Commands

```bash
# Copy config
cp backend/daemon-config.example.yaml backend/daemon-config.yaml

# Run (currently non-functional as standalone)
npm run dev:daemon
```

## Configuration

See `backend/daemon-config.example.yaml` for the YAML rule format:

```yaml
concurrency: 3

rules:
  - name: auto-triage
    trigger:
      event: task.created
      filter: "status:pending AND label:auto-triage"
    action:
      command: "echo 'Processing {{task.title}}'"
      timeout: 60000
      update_fields:
        status: "{{result.status}}"
        tags: "+processed"
```

## Related

- [Task Daemon](./task-daemon.md) - Production-ready polling daemon
- `backend/src/daemon/automation-daemon.ts` - Source code
- `backend/daemon-config.example.yaml` - Example configuration
