import type {
  AttachmentEvidenceCategory,
  AttachmentOwnerObjectType,
  AttachmentReferenceStatus,
  AttachmentSafetyStatus,
  AttachmentVisibility,
  ObjectRef,
} from '@forgeloop/contracts';

export interface Attachment {
  id: string;
  owner_object_type: AttachmentOwnerObjectType;
  owner_object_id: string;
  linked_object_refs: ObjectRef[];
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_uri: string;
  checksum_sha256: string;
  uploaded_by_actor_id: string;
  created_at: string;
  evidence_category: AttachmentEvidenceCategory;
  caption?: string;
  alt_text?: string;
  visibility: AttachmentVisibility;
  safety_status: AttachmentSafetyStatus;
  reference_status: AttachmentReferenceStatus;
}
