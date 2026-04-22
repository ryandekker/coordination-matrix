'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  documentsApi,
  Document,
  DocumentType,
  DocumentStatus,
  DocumentSearchQuery,
} from '@/lib/api'

// Helper to normalize query params for consistent cache keys
function normalizeParams(params?: Record<string, unknown>): string {
  if (!params) return ''
  const sortedKeys = Object.keys(params).sort()
  return sortedKeys
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}:${JSON.stringify(params[k])}`)
    .join('|')
}

interface UseDocumentsOptions {
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  search?: string
  type?: DocumentType | DocumentType[]
  excludeType?: DocumentType | DocumentType[]
  status?: DocumentStatus | DocumentStatus[]
  tags?: string[]
  includeArchived?: boolean
  createdById?: string
  workflowRunId?: string
  parentDocumentId?: string | null
  resolveReferences?: boolean
  groupId?: string
  projectId?: string
  richAnswerContext?: 'workflow' | 'document'
  richAnswerTargetId?: string
  enabled?: boolean
}

export function useDocuments(options?: UseDocumentsOptions) {
  const { enabled = true, ...params } = options || {}
  const normalizedKey = normalizeParams(params)

  return useQuery({
    queryKey: ['documents', normalizedKey],
    queryFn: () => documentsApi.list(params),
    enabled,
    staleTime: 30 * 1000, // 30 seconds
  })
}

export function useDocument(id: string | null, resolveReferences = true) {
  return useQuery({
    queryKey: ['document', id, resolveReferences],
    queryFn: () => (id ? documentsApi.get(id, resolveReferences) : null),
    enabled: !!id,
  })
}

export function useDocumentVersions(id: string | null) {
  return useQuery({
    queryKey: ['document-versions', id],
    queryFn: () => (id ? documentsApi.getVersions(id) : null),
    enabled: !!id,
    staleTime: 60 * 1000, // 1 minute
  })
}

export function useDocumentVersion(id: string | null, version: number | null) {
  return useQuery({
    queryKey: ['document-version', id, version],
    queryFn: () => (id && version ? documentsApi.getVersion(id, version) : null),
    enabled: !!id && !!version,
  })
}

export function useCreateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: documentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useUpdateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof documentsApi.update>[1]
    }) => documentsApi.update(id, data),
    // Optimistic update for better UX
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['document', id] })
      await queryClient.cancelQueries({ queryKey: ['documents'] })

      const previousDocument = queryClient.getQueryData(['document', id, true])
      const previousDocuments = queryClient.getQueriesData({ queryKey: ['documents'] })

      // Optimistically update single document
      queryClient.setQueryData(
        ['document', id, true],
        (old: { data: Document } | undefined) => {
          if (!old) return old
          return { ...old, data: { ...old.data, ...data } }
        }
      )

      // Optimistically update documents list
      queryClient.setQueriesData(
        { queryKey: ['documents'] },
        (old: { data: Document[]; pagination: unknown } | undefined) => {
          if (!old) return old
          return {
            ...old,
            data: old.data.map((doc) =>
              doc._id === id ? { ...doc, ...data } : doc
            ),
          }
        }
      )

      return { previousDocument, previousDocuments }
    },
    onError: (_err, { id }, context) => {
      if (context?.previousDocument) {
        queryClient.setQueryData(['document', id, true], context.previousDocument)
      }
      if (context?.previousDocuments) {
        context.previousDocuments.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['document', id] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-versions', id] })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, permanent = false }: { id: string; permanent?: boolean }) =>
      documentsApi.delete(id, permanent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}

export function useRestoreDocumentVersion() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      documentsApi.restoreVersion(id, version),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['document', id] })
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      queryClient.invalidateQueries({ queryKey: ['document-versions', id] })
    },
  })
}

export function useDiffDocumentVersions() {
  return useMutation({
    mutationFn: ({
      id,
      fromVersion,
      toVersion,
    }: {
      id: string
      fromVersion: number
      toVersion: number
    }) => documentsApi.diffVersions(id, fromVersion, toVersion),
  })
}

export function useLinkTaskToDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ documentId, taskId }: { documentId: string; taskId: string }) =>
      documentsApi.linkTask(documentId, taskId),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
    },
  })
}

export function useUnlinkTaskFromDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ documentId, taskId }: { documentId: string; taskId: string }) =>
      documentsApi.unlinkTask(documentId, taskId),
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] })
    },
  })
}

export function useSearchDocuments() {
  return useMutation({
    mutationFn: (query: DocumentSearchQuery) => documentsApi.search(query),
  })
}
