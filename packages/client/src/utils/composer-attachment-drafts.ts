import { reactive } from 'vue'
import type { Attachment } from '@/stores/hermes/chat'

interface AttachmentDraft {
  attachments: Attachment[]
  jobs: Set<Promise<void>>
}
// Files remain local in memory while moving between conversations. They are never
// serialized into browser storage, and a different account gets a separate scope.
const drafts = new Map<string, AttachmentDraft>()
export function attachmentDraftFor(scope: string): AttachmentDraft {
  let draft = drafts.get(scope)
  if (!draft) {
    draft = reactive({ attachments: [] as Attachment[], jobs: new Set<Promise<void>>() })
    drafts.set(scope, draft)
  }
  return draft
}
export function clearAttachmentDrafts() {
  for (const draft of drafts.values()) {
    for (const attachment of draft.attachments) {
      if (attachment.url?.startsWith('blob:')) URL.revokeObjectURL(attachment.url)
    }
    draft.attachments = []
  }
  drafts.clear()
}
if (typeof window !== 'undefined') window.addEventListener('hermes-auth-notice', clearAttachmentDrafts)
