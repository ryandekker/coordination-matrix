import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { Document, DocumentSearchQuery, DocumentSearchResult } from '../types/index.js';

// OpenAI embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Get OpenAI API key from environment
function getOpenAIKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

/**
 * Generate embedding for text using OpenAI API
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    console.warn('OpenAI API key not configured - semantic search disabled');
    return null;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.slice(0, 8000), // Truncate to avoid token limits
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('OpenAI embedding error:', error);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    return null;
  }
}

/**
 * Generate text for embedding from a document
 * Combines title, summary, and content for semantic matching
 */
function getDocumentEmbeddingText(doc: {
  title: string;
  summary?: string;
  content: string;
  tags?: string[];
}): string {
  const parts = [
    doc.title,
    doc.summary || '',
    doc.tags?.join(' ') || '',
    doc.content.slice(0, 6000), // Limit content to fit token window
  ];
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Update embedding for a document
 */
export async function updateDocumentEmbedding(documentId: string | ObjectId): Promise<boolean> {
  const db = getDb();
  const docId = typeof documentId === 'string' ? new ObjectId(documentId) : documentId;

  const document = await db.collection<Document>('documents').findOne({ _id: docId });
  if (!document) {
    return false;
  }

  const text = getDocumentEmbeddingText(document);
  const embedding = await generateEmbedding(text);

  if (!embedding) {
    return false;
  }

  await db.collection<Document>('documents').updateOne(
    { _id: docId },
    {
      $set: {
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        embeddingUpdatedAt: new Date(),
      },
    }
  );

  return true;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Search documents using semantic similarity
 */
export async function searchDocuments(
  query: DocumentSearchQuery
): Promise<DocumentSearchResult[]> {
  const db = getDb();
  const { prompt, type, status, tags, limit = 10, minScore = 0.5 } = query;

  // Generate embedding for the search prompt
  const queryEmbedding = await generateEmbedding(prompt);

  // Build filter for pre-filtering documents
  const filter: Record<string, unknown> = {};

  if (type && type.length > 0) {
    filter.type = { $in: type };
  }

  if (status && status.length > 0) {
    filter.status = { $in: status };
  } else {
    // Default: exclude archived
    filter.status = { $ne: 'archived' };
  }

  if (tags && tags.length > 0) {
    filter.tags = { $all: tags };
  }

  // If we have an embedding, use vector similarity search
  if (queryEmbedding) {
    // Get documents with embeddings
    filter.embedding = { $exists: true };

    const documents = await db
      .collection<Document>('documents')
      .find(filter)
      .project({ embedding: 1, title: 1, content: 1, summary: 1, type: 1, status: 1, tags: 1, version: 1, createdAt: 1, updatedAt: 1, createdById: 1, lastModifiedById: 1 })
      .toArray();

    // Calculate similarity scores
    const results: DocumentSearchResult[] = documents
      .map((doc) => ({
        document: { ...doc, embedding: undefined } as Document, // Remove embedding from response
        score: cosineSimilarity(queryEmbedding, doc.embedding as number[]),
        highlights: extractHighlights(doc.content, prompt),
      }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  // Fallback to text search if no embedding available
  filter.$text = { $search: prompt };

  const documents = await db
    .collection<Document>('documents')
    .find(filter, { projection: { score: { $meta: 'textScore' }, embedding: 0 } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .toArray();

  return documents.map((doc) => ({
    document: doc as Document,
    score: (doc as unknown as { score: number }).score / 10, // Normalize text score to 0-1 range
    highlights: extractHighlights(doc.content, prompt),
  }));
}

/**
 * Extract relevant text snippets containing search terms
 */
function extractHighlights(content: string, query: string): string[] {
  const highlights: string[] = [];
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const sentences = content.split(/[.!?]+/);

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();
    if (terms.some((term) => lowerSentence.includes(term))) {
      const trimmed = sentence.trim();
      if (trimmed.length > 20 && trimmed.length < 500) {
        highlights.push(trimmed);
        if (highlights.length >= 3) break;
      }
    }
  }

  return highlights;
}

/**
 * Batch update embeddings for documents without them
 */
export async function updateMissingEmbeddings(batchSize = 10): Promise<number> {
  const db = getDb();

  const documents = await db
    .collection<Document>('documents')
    .find({
      $or: [{ embedding: { $exists: false } }, { embedding: null }],
      status: { $ne: 'archived' },
    })
    .limit(batchSize)
    .toArray();

  let updated = 0;
  for (const doc of documents) {
    const success = await updateDocumentEmbedding(doc._id);
    if (success) updated++;
  }

  return updated;
}
