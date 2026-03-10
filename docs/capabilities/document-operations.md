---
capabilityId: document-operations
title: Document Operations
complexity: 2
tags: [capability, documents, storage]
summary: Create, update, and search documents in the document store.
---

# Document Operations

Include a `documentOperations` array in your response to create, update, or search documents.
The system processes these operations after your response — you declare intent, the system executes.

**When to use document operations:**
- Your task produces written content (blog posts, reports, plans, SOPs) → **create** a document
- You need to revise an existing document linked to the task → **update** it by ID
- You need reference material before proceeding → **search** for relevant documents

If your task is to produce content, the document IS the deliverable. Put the content in a document, not just in the output field.

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

Created documents are automatically linked to the current task and inherit its group/project.

## 2. Update Document

Update an existing document by ID. Use this when the task has linked documents (shown in your context as `linkedDocuments`) or from a previous search result.

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

## Linked Documents in Context

Documents already linked to your task appear in your context as `linkedDocuments`:

```json
{
  "linkedDocuments": [
    {
      "id": "abc123",
      "title": "Onboarding SOP",
      "type": "sop",
      "status": "draft"
    }
  ]
}
```

Use the `id` field to update these documents. Documents from workflow `findDocument` steps appear as `foundDocuments` with content and similarity scores.

## Best Practices

1. **Create documents for content deliverables** - If you wrote it, store it as a document
2. **Use meaningful titles** - Include dates or identifiers for uniqueness
3. **Add relevant tags** - Enables future discovery
4. **Write good summaries** - Powers semantic search matching
5. **Set appropriate status** - draft → review → approved
6. **Use markdown** - Content supports full GitHub-flavored markdown
