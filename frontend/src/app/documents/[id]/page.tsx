'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDocument, useDocumentVersions } from '@/hooks/use-documents'
import { DocumentStatus, DocumentType } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ArrowLeft,
  FileEdit,
  Eye,
  History,
  Clock,
  User,
  Tag,
  FileType,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { DocumentModal } from '@/components/documents/document-modal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const DOCUMENT_TYPES: Record<DocumentType, string> = {
  sop: 'SOP',
  strategy: 'Strategy',
  plan: 'Plan',
  template: 'Template',
  reference: 'Reference',
  output: 'Output',
  custom: 'Custom',
}

const STATUS_COLORS: Record<DocumentStatus, string> = {
  draft: 'bg-yellow-500',
  review: 'bg-blue-500',
  approved: 'bg-green-500',
  archived: 'bg-gray-500',
}

export default function DocumentViewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'content' | 'history'>('content')
  const [editModalOpen, setEditModalOpen] = useState(false)

  const { data: documentData, isLoading, error } = useDocument(id, true)
  const { data: versionsData } = useDocumentVersions(id)

  const document = documentData?.data || null
  const versions = versionsData?.data || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading document...</div>
      </div>
    )
  }

  if (error || !document) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive">Document not found</div>
        <Button variant="outline" onClick={() => router.push('/documents')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Documents
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/documents')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{document.title}</h1>
            {document.summary && (
              <p className="text-muted-foreground mt-1">{document.summary}</p>
            )}
          </div>
        </div>
        <Button onClick={() => setEditModalOpen(true)}>
          <FileEdit className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>

      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-4 border-b px-6 py-3 bg-muted/30">
        <Badge variant="outline" className="gap-1.5">
          <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[document.status]}`} />
          {document.status.charAt(0).toUpperCase() + document.status.slice(1)}
        </Badge>

        <Badge variant="secondary" className="gap-1.5">
          <FileType className="h-3 w-3" />
          {DOCUMENT_TYPES[document.type]}
        </Badge>

        <Badge variant="outline" className="gap-1.5">
          <History className="h-3 w-3" />
          Version {document.version}
        </Badge>

        {document._resolved?.createdBy && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="h-3 w-3" />
            {document._resolved.createdBy.displayName}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-3 w-3" />
          Updated {formatDistanceToNow(new Date(document.updatedAt), { addSuffix: true })}
        </div>

        {document.tags && document.tags.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Tag className="h-3 w-3 text-muted-foreground" />
            {document.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'content' | 'history')}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="px-6 border-b">
          <TabsList className="bg-transparent h-10">
            <TabsTrigger value="content" className="gap-2">
              <Eye className="h-4 w-4" />
              Content
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              Version History ({versions.length})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="content" className="flex-1 m-0 overflow-auto p-6">
          <article className="max-w-4xl mx-auto prose prose-sm dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {document.content}
            </ReactMarkdown>
          </article>
        </TabsContent>

        <TabsContent value="history" className="flex-1 m-0 overflow-auto p-6">
          <div className="max-w-4xl mx-auto">
            {versions.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No version history available
              </div>
            ) : (
              <div className="space-y-4">
                {versions.map((version, index) => (
                  <div
                    key={version._id}
                    className={`border rounded-lg p-4 ${
                      index === 0 ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={index === 0 ? 'default' : 'outline'}>
                          v{version.version}
                          {index === 0 && ' (current)'}
                        </Badge>
                        <span className="font-medium">{version.title}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(version.modifiedAt), 'PPp')}
                      </div>
                    </div>
                    {version.changeDescription && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {version.changeDescription}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">
                      by {version.modifiedByName || 'Unknown'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Modal */}
      <DocumentModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        document={document}
        isCreating={false}
      />
    </div>
  )
}
