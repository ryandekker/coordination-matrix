import { ObjectId, Document } from 'mongodb';
import { getDb } from '../db/connection.js';
import { FieldConfig, LookupValue } from '../types/index.js';

interface ResolvedReferences {
  [key: string]: Record<string, unknown> | undefined;
}

/**
 * Resolves references and lookups for a set of documents based on field configurations
 */
export class ReferenceResolver {
  private fieldConfigs: FieldConfig[] = [];
  private lookupCache: Map<string, Map<string, LookupValue>> = new Map();
  private referenceCache: Map<string, Map<string, Document>> = new Map();

  async loadFieldConfigs(collectionName: string): Promise<void> {
    const db = getDb();
    this.fieldConfigs = await db
      .collection<FieldConfig>('field_configs')
      .find({ collectionName })
      .toArray();
  }

  async resolveDocuments<T extends Document>(
    documents: T[],
    fieldsToResolve?: string[]
  ): Promise<(T & { _resolved?: ResolvedReferences })[]> {
    if (documents.length === 0) return documents;

    // Determine which fields need resolution
    const referenceFields = this.fieldConfigs.filter(
      (fc) =>
        fc.fieldType === 'reference' &&
        (!fieldsToResolve || fieldsToResolve.includes(fc.fieldPath))
    );

    const lookupFields = this.fieldConfigs.filter(
      (fc) =>
        fc.fieldType === 'select' &&
        fc.lookupType &&
        (!fieldsToResolve || fieldsToResolve.includes(fc.fieldPath))
    );

    // Collect all IDs that need to be resolved
    const referenceIdsPerCollection: Map<string, Set<string>> = new Map();
    const lookupCodesPerType: Map<string, Set<string>> = new Map();

    for (const doc of documents) {
      // Collect reference IDs
      for (const field of referenceFields) {
        const value = this.getNestedValue(doc, field.fieldPath);
        if (value && field.referenceCollection) {
          if (!referenceIdsPerCollection.has(field.referenceCollection)) {
            referenceIdsPerCollection.set(field.referenceCollection, new Set());
          }
          referenceIdsPerCollection.get(field.referenceCollection)!.add(value.toString());
        }
      }

      // Collect lookup codes
      for (const field of lookupFields) {
        const value = this.getNestedValue(doc, field.fieldPath);
        if (value && field.lookupType) {
          if (!lookupCodesPerType.has(field.lookupType)) {
            lookupCodesPerType.set(field.lookupType, new Set());
          }
          lookupCodesPerType.get(field.lookupType)!.add(value.toString());
        }
      }
    }

    // Fetch all references in batch
    await this.fetchReferences(referenceIdsPerCollection);
    await this.fetchLookups(lookupCodesPerType);

    // Resolve each document
    return documents.map((doc) => this.resolveDocument(doc, referenceFields, lookupFields));
  }

  private async fetchReferences(
    referenceIdsPerCollection: Map<string, Set<string>>
  ): Promise<void> {
    const db = getDb();

    for (const [collection, ids] of referenceIdsPerCollection) {
      if (!this.referenceCache.has(collection)) {
        this.referenceCache.set(collection, new Map());
      }

      const idsToFetch = [...ids].filter(
        (id) => !this.referenceCache.get(collection)!.has(id)
      );

      if (idsToFetch.length > 0) {
        const objectIds = idsToFetch
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const docs = await db
          .collection(collection)
          .find({ _id: { $in: objectIds } })
          .toArray();

        for (const doc of docs) {
          this.referenceCache.get(collection)!.set(doc._id.toString(), doc);
        }
      }
    }
  }

  private async fetchLookups(lookupCodesPerType: Map<string, Set<string>>): Promise<void> {
    const db = getDb();

    for (const [type, codes] of lookupCodesPerType) {
      if (!this.lookupCache.has(type)) {
        this.lookupCache.set(type, new Map());
      }

      const codesToFetch = [...codes].filter(
        (code) => !this.lookupCache.get(type)!.has(code)
      );

      if (codesToFetch.length > 0) {
        const lookups = await db
          .collection<LookupValue>('lookups')
          .find({ type, code: { $in: codesToFetch } })
          .toArray();

        for (const lookup of lookups) {
          this.lookupCache.get(type)!.set(lookup.code, lookup);
        }
      }
    }
  }

  private resolveDocument<T extends Document>(
    doc: T,
    referenceFields: FieldConfig[],
    lookupFields: FieldConfig[]
  ): T & { _resolved?: ResolvedReferences } {
    const resolved: ResolvedReferences = {};

    // Resolve references
    for (const field of referenceFields) {
      const value = this.getNestedValue(doc, field.fieldPath);
      if (value && field.referenceCollection) {
        const refDoc = this.referenceCache
          .get(field.referenceCollection)
          ?.get(value.toString());
        if (refDoc) {
          const fieldName = field.fieldPath.replace('Id', '');
          resolved[fieldName] = {
            _id: refDoc._id,
            [field.referenceDisplayField || 'displayName']:
              refDoc[field.referenceDisplayField || 'displayName'],
          };
        }
      }
    }

    // Resolve lookups
    for (const field of lookupFields) {
      const value = this.getNestedValue(doc, field.fieldPath);
      if (value && field.lookupType) {
        const lookup = this.lookupCache.get(field.lookupType)?.get(value.toString());
        if (lookup) {
          resolved[field.fieldPath] = {
            code: lookup.code,
            displayName: lookup.displayName,
            color: lookup.color,
            icon: lookup.icon,
          };
        }
      }
    }

    if (Object.keys(resolved).length > 0) {
      return { ...doc, _resolved: resolved };
    }
    return doc;
  }

  private getNestedValue(obj: Document, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
    }, obj as unknown);
  }

  clearCache(): void {
    this.lookupCache.clear();
    this.referenceCache.clear();
  }
}

/**
 * Get all lookup values for a specific type
 */
export async function getLookupsByType(type: string): Promise<LookupValue[]> {
  const db = getDb();
  return db
    .collection<LookupValue>('lookups')
    .find({ type, isActive: true })
    .sort({ sortOrder: 1 })
    .toArray();
}

/**
 * Get all lookups grouped by type
 */
export async function getAllLookups(): Promise<Record<string, LookupValue[]>> {
  const db = getDb();
  const lookups = await db
    .collection<LookupValue>('lookups')
    .find({ isActive: true })
    .sort({ type: 1, sortOrder: 1 })
    .toArray();

  const grouped: Record<string, LookupValue[]> = {};
  for (const lookup of lookups) {
    if (!grouped[lookup.type]) {
      grouped[lookup.type] = [];
    }
    grouped[lookup.type].push(lookup);
  }

  return grouped;
}
