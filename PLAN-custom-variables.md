# Custom Variables & Credential Packages Implementation Plan

## Overview

Add a global variable packages system with branch/variant support for organizing credentials and reusable configuration. Variables can be marked as secrets (encrypted, hidden until revealed). The token browser will be enhanced to browse and insert package variables, with a new bottom panel showing the full field value being edited.

## Requirements Summary

1. **Global packages** - Available to all workflows
2. **Encrypted secrets** - Values marked as secrets are encrypted at rest
3. **Nested interpolation** - `{{packages.email[{{trigger.payload.account}}].username}}`
4. **Settings page** - Manage packages with ability to add from token browser
5. **Token browser enhancement** - Show full field value at bottom

---

## Phase 1: Backend Data Model

### New Collection: `variable_packages`

```javascript
// mongo-init/01-init-db.js addition
db.createCollection('variable_packages', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['name', 'branches', 'createdAt', 'isActive'],
      properties: {
        name: {
          bsonType: 'string',
          description: 'Package name (unique, used in templates) - required'
        },
        displayName: {
          bsonType: 'string',
          description: 'Human-readable display name'
        },
        description: {
          bsonType: 'string',
          description: 'Package description'
        },
        // Branch definitions - each branch is a variant of the package
        branches: {
          bsonType: 'object',
          description: 'Map of branch name -> branch data'
          // Example: { "personal": { email: "...", password: "..." }, "work": { ... } }
        },
        // Default branch to use when not specified
        defaultBranch: {
          bsonType: 'string',
          description: 'Default branch name'
        },
        // Schema definition for UI and validation
        schema: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              key: { bsonType: 'string' },        // Field name
              displayName: { bsonType: 'string' }, // UI label
              type: { bsonType: 'string' },       // 'string' | 'secret' | 'number' | 'boolean'
              required: { bsonType: 'bool' },
              description: { bsonType: 'string' }
            }
          },
          description: 'Field schema for the package'
        },
        // Ownership and audit
        createdById: {
          bsonType: ['objectId', 'null'],
          description: 'User who created this package'
        },
        updatedById: {
          bsonType: ['objectId', 'null'],
          description: 'User who last updated this package'
        },
        isActive: {
          bsonType: 'bool',
          description: 'Whether the package is active'
        },
        createdAt: {
          bsonType: 'date',
          description: 'Creation timestamp'
        },
        updatedAt: {
          bsonType: 'date',
          description: 'Last update timestamp'
        }
      }
    }
  }
});

db.variable_packages.createIndex({ name: 1 }, { unique: true });
db.variable_packages.createIndex({ isActive: 1 });
```

### Encryption Strategy

- Use AES-256-GCM for encrypting secret values
- Encryption key stored in environment variable `VARIABLE_ENCRYPTION_KEY`
- Secret fields identified by `schema[].type === 'secret'`
- Encrypted values stored with `enc:` prefix for identification
- Decryption happens at runtime during template resolution

### Files to Create/Modify

1. **`backend/src/services/encryption.ts`** (new)
   - `encrypt(plaintext: string): string` - Returns `enc:iv:ciphertext:tag`
   - `decrypt(encrypted: string): string` - Decrypts `enc:...` format
   - `isEncrypted(value: string): boolean` - Checks for `enc:` prefix

2. **`mongo-init/01-init-db.js`**
   - Add `variable_packages` collection schema

---

## Phase 2: Backend API Routes

### New Route File: `backend/src/routes/variable-packages.ts`

```typescript
// Endpoints:
GET    /api/variable-packages              // List all packages (secrets redacted)
GET    /api/variable-packages/:id          // Get package by ID (secrets redacted)
POST   /api/variable-packages              // Create package
PATCH  /api/variable-packages/:id          // Update package
DELETE /api/variable-packages/:id          // Delete package (soft delete via isActive)

// Branch management
POST   /api/variable-packages/:id/branches           // Add branch
PATCH  /api/variable-packages/:id/branches/:branch   // Update branch
DELETE /api/variable-packages/:id/branches/:branch   // Delete branch

// Secret reveal (requires auth, logs access)
GET    /api/variable-packages/:id/branches/:branch/reveal  // Get decrypted values
```

### API Response Handling

- List/Get responses redact secret values to `"••••••••"`
- Reveal endpoint returns actual decrypted values (audit logged)
- Create/Update encrypts secret fields before storage

### Files to Create/Modify

1. **`backend/src/routes/variable-packages.ts`** (new)
   - Full CRUD with encryption/decryption
   - Audit logging for secret access

2. **`backend/src/index.ts`**
   - Register new route

3. **`backend/src/swagger/variable-packages.yaml`** (new)
   - API documentation

---

## Phase 3: Template Resolution Enhancement

### Nested Interpolation Support

Modify `backend/src/services/workflow/template-utils.ts` to support:

```
{{packages.email[{{trigger.payload.account}}].username}}
```

Resolution order:
1. First pass: Resolve inner `{{...}}` expressions that don't contain `[`
2. Second pass: Resolve remaining expressions (including those with resolved brackets)

### New Resolution Logic

```typescript
// In template-utils.ts

interface PackageContext {
  packages: Record<string, Record<string, Record<string, unknown>>>;
  // packages.{packageName}.{branchName}.{fieldKey}
}

export async function resolvePackageVariables(
  template: string,
  context: TemplateContext,
  packageContext: PackageContext
): Promise<string> {
  // Multi-pass resolution for nested interpolation
  let result = template;
  let iterations = 0;
  const maxIterations = 5; // Safety limit

  while (result.includes('{{') && iterations < maxIterations) {
    const prevResult = result;

    // Resolve non-bracket expressions first (inner expressions)
    result = resolveSimpleExpressions(result, context);

    // Resolve package references (may now have resolved branch names)
    result = resolvePackageReferences(result, packageContext);

    if (result === prevResult) break; // No changes, done
    iterations++;
  }

  return result;
}

function resolvePackageReferences(
  template: string,
  packageContext: PackageContext
): string {
  // Pattern: {{packages.NAME[BRANCH].FIELD}} or {{packages.NAME.FIELD}} (uses default)
  const pattern = /\{\{packages\.(\w+)(?:\[([^\]]+)\])?\.(\w+)\}\}/g;

  return template.replace(pattern, (match, pkgName, branch, field) => {
    const pkg = packageContext.packages[pkgName];
    if (!pkg) return match; // Leave unresolved

    const branchName = branch || Object.keys(pkg)[0]; // Default to first/default
    const branchData = pkg[branchName];
    if (!branchData) return match;

    const value = branchData[field];
    return value !== undefined ? String(value) : match;
  });
}
```

### Files to Modify

1. **`backend/src/services/workflow/template-utils.ts`**
   - Add `resolvePackageVariables()` function
   - Add nested interpolation support
   - Integrate with existing `resolveTemplateVariables()`

2. **`backend/src/services/workflow/workflow-execution-service.ts`**
   - Load package context when executing steps
   - Pass package context to template resolution

---

## Phase 4: Token Browser Enhancement

### 4.1: Add Packages Category

Add a new "Packages" category to the token browser that:
- Lists all active packages
- Shows branches as expandable items
- Displays field paths with proper syntax
- Handles secret fields (shows lock icon, type indicator)

### 4.2: Bottom Panel Full-Value Editor

Replace the small footer hint with an expandable panel that shows:
- The current field being edited (label)
- Full value with syntax highlighting
- Cursor position indicator
- Token insertion point preview

### UI Mockup

```
┌─────────────────────────────────────────────────┐
│ 🔍 Search tokens...                             │
├─────────────────────────────────────────────────┤
│ ⚡ System                                        │
│   {{_apiUrl}}           Base API URL            │
│   {{_apiKey}}           System API key          │
│                                                 │
│ 📦 Packages                                     │
│   ▼ email_credentials                           │
│     ├─ [personal]                               │
│     │   {{packages.email_credentials[personal]  │
│     │     .email}}                              │
│     │   {{packages.email_credentials[personal]  │
│     │     .password}}  🔒                       │
│     └─ [work]                                   │
│         {{packages.email_credentials[work]      │
│           .email}}                              │
│                                                 │
│   ▼ api_keys                                    │
│     ...                                         │
├─────────────────────────────────────────────────┤
│ 📝 Editing: Payload Template                    │
│ ┌─────────────────────────────────────────────┐ │
│ │ {                                           │ │
│ │   "email": "{{packages.email_credentials    │ │
│ │     [{{trigger.payload.account}}].email}}", │ │
│ │   "callback": "{{callbackUrl}}"             │ │
│ │ }                                       ▼   │ │
│ └─────────────────────────────────────────────┘ │
│ [+ Add from Token Browser]  [Create Package]    │
└─────────────────────────────────────────────────┘
```

### Files to Modify

1. **`frontend/src/components/workflows/token-browser.tsx`**
   - Add packages category with branch expansion
   - Add bottom panel for full value editing
   - Add "Create Package" quick action

2. **`frontend/src/components/workflows/token-browser-dialog.tsx`**
   - Same enhancements for dialog version
   - Add packages tab

3. **`frontend/src/lib/api.ts`**
   - Add `variablePackagesApi` client

---

## Phase 5: Settings Page UI

### New Page: `/settings/variables`

Features:
- List all variable packages with branch counts
- Create/Edit package modal with:
  - Name, display name, description
  - Schema builder (add/remove fields, set types including secret)
  - Branch manager (add/edit/delete branches)
- Secret field handling:
  - Values hidden by default (shown as `••••••••`)
  - "Reveal" button to show (triggers audit log)
  - Click-to-edit reveals temporarily
- Import/Export packages (JSON format, secrets excluded on export)

### Files to Create

1. **`frontend/src/app/settings/variables/page.tsx`** (new)
   - Main variables settings page

2. **`frontend/src/components/settings/variable-package-form.tsx`** (new)
   - Create/edit package form component

3. **`frontend/src/components/settings/branch-editor.tsx`** (new)
   - Branch data editor with secret masking

---

## Phase 6: Integration & Testing

### Test Scenarios

1. **Basic package usage**
   - Create package with branches
   - Reference in workflow step
   - Verify correct branch value injected

2. **Dynamic branch selection**
   - Trigger payload specifies branch
   - Nested interpolation resolves correctly
   - Different branches produce different outputs

3. **Secret handling**
   - Secrets encrypted in database
   - Secrets redacted in API responses
   - Secrets decrypted only during workflow execution
   - Reveal endpoint works with audit logging

4. **Token browser**
   - Packages appear in browser
   - Correct syntax inserted on click
   - Bottom panel shows full value

### Files to Create

1. **`backend/src/__tests__/variable-packages.test.ts`** (new)
   - API endpoint tests

2. **`backend/src/__tests__/template-utils-packages.test.ts`** (new)
   - Template resolution tests with packages

---

## Implementation Order

1. **Phase 1**: Backend data model + encryption service (~2 files)
2. **Phase 2**: API routes (~2 files)
3. **Phase 3**: Template resolution (~2 files modified)
4. **Phase 4**: Token browser enhancements (~3 files modified)
5. **Phase 5**: Settings page UI (~3 new files)
6. **Phase 6**: Testing & polish

---

## Environment Variables

Add to `.env.example`:
```
# Encryption key for variable package secrets (32 bytes, base64 encoded)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
VARIABLE_ENCRYPTION_KEY=
```

---

## Migration Notes

- No breaking changes to existing workflows
- Existing template variables continue to work unchanged
- New `packages.*` namespace reserved for variable packages
- Database migration not required (new collection only)
