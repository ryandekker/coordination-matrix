# Access Control & Group Management

This document describes the access control system in Coordination Matrix, including groups, projects, roles, and user provisioning flows.

## Overview

Coordination Matrix uses a group-based access control model:

```
User → Groups → Projects → Tasks/Workflows
```

- **Users** belong to one or more **Groups**
- **Groups** contain **Projects** for organizing work
- **Tasks** and **Workflows** are scoped to Groups (and optionally Projects)
- **Admins** have global access regardless of group membership

## Groups

Groups are the primary organizational unit. Every user should belong to at least one group.

### Group Roles

Roles are hierarchical - higher roles inherit all permissions from lower roles:

| Role | Permissions |
|------|-------------|
| `owner` | Full control: delete group, transfer ownership, manage all members |
| `admin` | Manage group settings and members (except owners) |
| `member` | Create and edit content (tasks, workflows, documents) |
| `viewer` | Read-only access to group content |

### Group Visibility

| Visibility | Description |
|------------|-------------|
| `private` | Only group members can see the group exists |
| `internal` | All authenticated users can see the group, but only members can access content |

### Creating Groups

**Admin users** can create groups via:
- The Groups settings page (`/settings/groups`)
- The API (`POST /api/groups`)

**Regular users** get groups created automatically:
- During SSO provisioning (personal workspace)
- When accepting a group invite

## Projects

Projects are subdivisions within groups for organizing related work.

### Project Status

| Status | Description |
|--------|-------------|
| `active` | Currently active project |
| `archived` | Hidden from default views but preserved |
| `completed` | Finished project |

## User Provisioning

### Flow 1: SSO Registration (New User)

When a new user signs up via SSO:

```
SSO Provider → POST /api/auth/provision → Create User + Group + Project → Return Token
```

1. External SSO system validates user identity
2. SSO calls `/api/auth/provision` with user details
3. System creates:
   - New user account (role: `operator`)
   - Personal group (e.g., "John's Workspace")
   - Default project in that group
4. Returns JWT token for immediate login

**Request:**
```json
{
  "email": "newuser@example.com",
  "displayName": "New User",
  "externalId": "sso-provider-id"
}
```

**Response:**
```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "email": "newuser@example.com",
    "displayName": "New User",
    "role": "operator"
  },
  "isNewUser": true,
  "groupId": "auto-created-group-id"
}
```

### Flow 2: Group Invite Acceptance

When a user accepts an invite to join an existing group:

```
Admin creates invite → User clicks link → SSO validates → POST /api/auth/provision (with inviteGroupId) → Add to Group → Return Token
```

**For new users:**
```json
{
  "email": "invited@example.com",
  "displayName": "Invited User",
  "inviteGroupId": "target-group-id",
  "inviteRole": "member"
}
```

The system creates the user and adds them to the invited group (no personal workspace created).

**For existing users:**
The system adds them to the group if not already a member, then returns a login token.

### Flow 3: Returning SSO User

When an existing user logs in via SSO:

```
SSO Provider → POST /api/auth/sso-login → Validate User → Return Token
```

**Request:**
```json
{
  "email": "existing@example.com"
}
```

## UI Access Control

### Groups Management Page

| User Role | Capabilities |
|-----------|-------------|
| Admin | Create, edit, delete any group; manage all members |
| Non-Admin | View groups they belong to; see member list |

### No-Group Banner

Users without any group membership see a warning banner:

- **Admins:** "You are not a member of any group. As an admin, you can still view all content."
- **Non-Admins:** "You are not a member of any group. Contact your administrator to be added to a group."

## API Endpoints Summary

### Authentication
| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/provision` | SSO user provisioning |
| `POST /api/auth/sso-login` | SSO login for existing users |

### Groups
| Endpoint | Description |
|----------|-------------|
| `GET /api/groups` | List user's groups |
| `GET /api/groups?all=true` | List all groups (admin) |
| `POST /api/groups` | Create group |
| `GET /api/groups/:id` | Get group details |
| `PATCH /api/groups/:id` | Update group |
| `DELETE /api/groups/:id` | Delete group |
| `POST /api/groups/:id/members` | Add member |
| `PATCH /api/groups/:id/members/:userId` | Update member role |
| `DELETE /api/groups/:id/members/:userId` | Remove member |

### Projects
| Endpoint | Description |
|----------|-------------|
| `GET /api/projects` | List projects |
| `GET /api/projects?groupId=xxx` | List group projects |
| `POST /api/projects` | Create project |
| `GET /api/projects/:id` | Get project |
| `PATCH /api/projects/:id` | Update project |
| `DELETE /api/projects/:id` | Delete project |

## Database Schema

### Groups Collection

```javascript
{
  _id: ObjectId,
  name: String,           // Machine name (auto-generated slug)
  displayName: String,    // Human-readable name
  description: String,    // Optional
  visibility: "private" | "internal",
  members: [{
    userId: ObjectId,
    role: "owner" | "admin" | "member" | "viewer",
    addedAt: Date,
    addedById: ObjectId | null
  }],
  createdById: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

### Projects Collection

```javascript
{
  _id: ObjectId,
  name: String,           // Machine name (auto-generated slug)
  displayName: String,    // Human-readable name
  description: String,    // Optional
  groupId: ObjectId,      // Parent group
  status: "active" | "archived" | "completed",
  color: String,          // Optional hex color
  createdById: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

### Users Collection (relevant fields)

```javascript
{
  _id: ObjectId,
  email: String,
  displayName: String,
  role: "admin" | "operator" | "reviewer" | "viewer",
  externalId: String,     // SSO provider ID
  isActive: Boolean,
  // ... other fields
}
```

## Security Considerations

1. **Rate Limiting:** SSO provisioning endpoints are rate-limited to prevent abuse
2. **Group Validation:** Invite group IDs are validated before user creation
3. **Role Hierarchy:** Lower roles cannot modify higher roles
4. **Admin Bypass:** System admins can access all content regardless of group membership
5. **Soft Delete:** User deletion is a soft delete (deactivation) to preserve audit trails
