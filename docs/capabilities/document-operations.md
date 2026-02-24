---
capabilityId: document-operations
title: Document Operations
complexity: 2
tags: [capability, documents, storage]
summary: Create, update, and search documents in the document store.
---

# Document Operations

Include a `documentOperations` array in your response to interact with the document store.

## 1. Create Document

```json
{
  "documentOperations": [
    {
      "action": "create",
      "document": {
        "title": "Analysis Report - 2024-01",
        "content": "# Report\n\nFindings go here...",
        "type": "output",
        "status": "draft",
        "tags": ["report", "analysis"],
        "summary": "Monthly analysis findings"
      }
    }
  ]
}
```

Created documents are automatically linked to the current task.

## 2. Update Document

Update an existing document by ID (from `foundDocuments` or previous search):

```json
{
  "documentOperations": [
    {
      "action": "update",
      "documentId": "abc123...",
      "changes": {
        "content": "# Updated Content\n\nRevised findings...",
        "summary": "Updated with new data",
        "status": "review",
        "tags": ["report", "analysis", "revised"]
      }
    }
  ]
}
```

Only include fields you want to change.

## 3. Search Documents

Search for documents by semantic similarity:

```json
{
  "documentOperations": [
    {
      "action": "search",
      "prompt": "customer onboarding procedures",
      "type": ["sop", "reference"],
      "status": ["approved"],
      "tags": ["onboarding"],
      "limit": 5
    }
  ]
}
```

Search results are returned in the task output for reference.

## Document Types

| Type | Use For |
|------|---------|
| output | Generated results, reports, deliverables |
| reference | Background information, research |
| template | Reusable document templates |
| sop | Standard operating procedures |
| plan | Project or action plans |
| strategy | Strategic documents |

## Document Statuses

| Status | Meaning |
|--------|---------|
| draft | Work in progress |
| review | Ready for review |
| approved | Finalized and approved |
| archived | No longer active |

## Accessing Documents in Context

Documents provided to you appear in the task context as `foundDocuments`:

```json
{
  "foundDocuments": [
    {
      "id": "abc123",
      "title": "Onboarding SOP",
      "content": "...",
      "score": 0.92
    }
  ]
}
```

Use the `id` field when updating documents.

## Best Practices

1. **Use meaningful titles** - Include dates or identifiers for uniqueness
2. **Add relevant tags** - Enables future discovery
3. **Write good summaries** - Powers semantic search matching
4. **Set appropriate status** - draft → review → approved
5. **Use markdown** - Content supports full GitHub-flavored markdown
