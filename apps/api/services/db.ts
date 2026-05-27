import { PrismaClient } from '@prisma/client';
import type {
  Db,
  FormRecord,
  SubmissionRecord,
  FileRecord,
  UploadJobRecord,
  UploadState,
  PrivacyMode,
} from './metadata-orchestrator';

// Instantiate the Prisma Client singleton
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Helper to register the user lazily on request
async function ensureUserExists(address: string, signerKind = 'zk-login'): Promise<void> {
  await prisma.dbUser.upsert({
    where: { address },
    update: { lastSeenAt: new Date() },
    create: {
      address,
      signerKind,
    },
  });
}

// ─── Value Mapping Utilities ──────────────────────────────────────────────────

function mapForm(f: any): FormRecord {
  return {
    id: f.id,
    ownerAddress: f.ownerAddress,
    walrusBlobId: f.walrusBlobId,
    privacyMode: f.privacyMode as PrivacyMode,
    policyId: f.policyId,
    version: f.version,
    predecessorId: f.predecessorId,
    state: f.state as UploadState,
    contentDigest: f.contentDigest ?? '',
    sizeBytes: f.sizeBytes ? Number(f.sizeBytes) : 0,
    createdAt: f.createdAt.toISOString(),
  };
}

function mapSubmission(s: any): SubmissionRecord {
  return {
    id: s.id,
    formId: s.formId,
    formVersion: s.formVersion,
    submitterAddress: s.submitterAddress,
    walrusBlobId: s.walrusBlobId,
    privacyMode: s.privacyMode as PrivacyMode,
    contentDigest: s.contentDigest,
    sizeBytes: Number(s.sizeBytes),
    state: s.state as UploadState,
    policyId: s.privacyMode === 'private' ? (s.form?.policyId || s.policyId || null) : null,
    createdAt: s.createdAt.toISOString(),
  };
}

function mapFile(f: any): FileRecord {
  return {
    id: f.id,
    submissionId: f.submissionId,
    walrusBlobId: f.walrusBlobId,
    contentType: f.contentType,
    sizeBytes: Number(f.sizeBytes),
    contentDigest: f.contentDigest,
    state: f.state as UploadState,
    createdAt: f.createdAt.toISOString(),
  };
}

function mapUploadJob(j: any): UploadJobRecord {
  return {
    id: j.id,
    ownerAddress: j.ownerAddress,
    artifactKind: j.artifactKind as any,
    artifactId: j.artifactId,
    walrusBlobId: j.walrusBlobId,
    state: j.state as UploadState,
    failureReason: j.failureReason,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

// ─── Db Interface Implementation ──────────────────────────────────────────────

export const db: Db = {
  async getForm(formId: string): Promise<FormRecord | undefined> {
    const f = await prisma.dbForm.findUnique({
      where: { id: formId },
    });
    return f ? mapForm(f) : undefined;
  },

  async insertForm(row: FormRecord): Promise<FormRecord> {
    await ensureUserExists(row.ownerAddress);
    const f = await prisma.dbForm.create({
      data: {
        id: row.id,
        ownerAddress: row.ownerAddress,
        walrusBlobId: row.walrusBlobId,
        privacyMode: row.privacyMode,
        policyId: row.policyId,
        version: row.version,
        predecessorId: row.predecessorId,
        state: row.state,
        contentDigest: row.contentDigest,
        sizeBytes: row.sizeBytes,
        createdAt: new Date(row.createdAt),
      },
    });
    return mapForm(f);
  },

  async getSubmission(submissionId: string): Promise<SubmissionRecord | undefined> {
    const s = await prisma.dbSubmission.findUnique({
      where: { id: submissionId },
      include: { form: true },
    });
    return s ? mapSubmission(s) : undefined;
  },

  async insertSubmission(row: SubmissionRecord): Promise<SubmissionRecord> {
    await ensureUserExists(row.submitterAddress);
    const s = await prisma.dbSubmission.create({
      data: {
        id: row.id,
        formId: row.formId,
        formVersion: row.formVersion,
        submitterAddress: row.submitterAddress,
        walrusBlobId: row.walrusBlobId,
        privacyMode: row.privacyMode,
        contentDigest: row.contentDigest,
        sizeBytes: BigInt(row.sizeBytes),
        state: row.state,
        createdAt: new Date(row.createdAt),
      },
      include: { form: true },
    });
    return mapSubmission(s);
  },

  async getFile(fileId: string): Promise<FileRecord | undefined> {
    const f = await prisma.dbFile.findUnique({
      where: { id: fileId },
    });
    return f ? mapFile(f) : undefined;
  },

  async insertFile(row: FileRecord): Promise<FileRecord> {
    const f = await prisma.dbFile.create({
      data: {
        id: row.id,
        submissionId: row.submissionId,
        walrusBlobId: row.walrusBlobId,
        contentType: row.contentType,
        sizeBytes: BigInt(row.sizeBytes),
        contentDigest: row.contentDigest,
        state: row.state,
        createdAt: new Date(row.createdAt),
      },
    });
    return mapFile(f);
  },

  async insertUploadJob(row: UploadJobRecord): Promise<UploadJobRecord> {
    await ensureUserExists(row.ownerAddress);
    const j = await prisma.dbUploadJob.create({
      data: {
        id: row.id,
        ownerAddress: row.ownerAddress,
        artifactKind: row.artifactKind,
        artifactId: row.artifactId,
        walrusBlobId: row.walrusBlobId,
        state: row.state,
        failureReason: row.failureReason,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      },
    });
    return mapUploadJob(j);
  },

  async updateUploadJobState(
    jobId: string,
    state: UploadState,
    failureReason?: string,
  ): Promise<void> {
    await prisma.dbUploadJob.update({
      where: { id: jobId },
      data: {
        state,
        failureReason: failureReason ?? null,
        updatedAt: new Date(),
      },
    });
  },

  async findFormByBlob(ownerAddress: string, walrusBlobId: string): Promise<FormRecord | undefined> {
    const f = await prisma.dbForm.findFirst({
      where: { ownerAddress, walrusBlobId },
    });
    return f ? mapForm(f) : undefined;
  },

  async findSubmissionByBlob(formId: string, walrusBlobId: string): Promise<SubmissionRecord | undefined> {
    const s = await prisma.dbSubmission.findFirst({
      where: { formId, walrusBlobId },
      include: { form: true },
    });
    return s ? mapSubmission(s) : undefined;
  },
};
