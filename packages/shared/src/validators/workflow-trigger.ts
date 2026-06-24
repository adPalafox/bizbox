import { createHash } from "node:crypto";
import { z } from "zod";
import {
  WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY,
  WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION,
  type WeeklyRetroWorkflowTriggerPayload,
  type WorkflowTriggerEnvelope,
} from "../types/workflow-trigger.js";

export {
  WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY,
  WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION,
  type WeeklyRetroWorkflowTriggerEvidenceReference,
  type WeeklyRetroWorkflowTriggerPayload,
  type WeeklyRetroWorkflowTriggerSection,
  type WorkflowTriggerEnvelope,
  type WorkflowTriggerLineage,
} from "../types/workflow-trigger.js";

export const WORKFLOW_TRIGGER_PAYLOAD_MAX_BYTES = 128 * 1024;

const workflowTriggerEvidenceReferenceSchema = z.object({
  key: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(500),
  url: z.string().trim().min(1).url().nullable().optional(),
  note: z.string().trim().max(2_000).nullable().optional(),
}).passthrough();

const workflowTriggerSectionSchema = z.object({
  key: z.string().trim().min(1).max(255),
  title: z.string().trim().min(1).max(200),
  summaryMarkdown: z.string().min(1).max(100_000),
  evidenceRefs: z.array(z.string().trim().min(1).max(255)).default([]),
}).passthrough();

export const weeklyRetroWorkflowTriggerPayloadSchema = z.object({
  generatedAt: z.string().trim().min(1).datetime(),
  evidenceWindow: z.object({
    startAt: z.string().trim().min(1).datetime(),
    endAt: z.string().trim().min(1).datetime(),
  }),
  summaryMarkdown: z.string().min(1).max(100_000),
  sections: z.array(workflowTriggerSectionSchema).default([]),
  evidence: z.array(workflowTriggerEvidenceReferenceSchema).default([]),
}).passthrough();

export const workflowTriggerEnvelopeSchema = z.object({
  contractKey: z.string().trim().min(1).max(200),
  contractVersion: z.string().trim().min(1).max(50),
  companyId: z.string().uuid(),
  sourceHeartbeatRunId: z.string().uuid(),
  generatedAt: z.string().trim().min(1).datetime(),
  payload: z.unknown(),
}).passthrough();

const workflowTriggerPayloadSchemas = new Map<string, z.ZodTypeAny>([
  [
    `${WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY}:${WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION}`,
    weeklyRetroWorkflowTriggerPayloadSchema,
  ],
]);

function stringifyWorkflowTrigger(workflowTrigger: unknown) {
  const json = JSON.stringify(workflowTrigger ?? null);
  return typeof json === "string" ? json : "null";
}

export function resolveWorkflowTriggerPayloadSchema(contractKey: string, contractVersion: string) {
  return workflowTriggerPayloadSchemas.get(`${contractKey}:${contractVersion}`) ?? null;
}

export function getWorkflowTriggerPayloadBytes(workflowTrigger: unknown) {
  return Buffer.byteLength(stringifyWorkflowTrigger(workflowTrigger), "utf8");
}

export type WorkflowTriggerValidationResult =
  | {
      success: true;
      workflowTrigger: WorkflowTriggerEnvelope & {
        payload: WeeklyRetroWorkflowTriggerPayload;
      };
      payloadBytes: number;
      payloadHash: string;
    }
  | {
      success: false;
      code: "size_limit" | "invalid_envelope" | "invalid_payload" | "company_mismatch" | "source_run_mismatch" | "unknown_contract";
      error: string;
      payloadBytes: number;
      payloadHash: string;
    };

export function validateWorkflowTrigger(input: {
  workflowTrigger: unknown;
  companyId: string;
  sourceHeartbeatRunId: string;
  maxBytes?: number;
}): WorkflowTriggerValidationResult {
  const payloadBytes = getWorkflowTriggerPayloadBytes(input.workflowTrigger);
  const payloadHash = createHash("sha256").update(stringifyWorkflowTrigger(input.workflowTrigger)).digest("hex");
  const maxBytes = input.maxBytes ?? WORKFLOW_TRIGGER_PAYLOAD_MAX_BYTES;
  if (payloadBytes > maxBytes) {
    return {
      success: false,
      code: "size_limit",
      error: `Workflow trigger exceeds the maximum size of ${maxBytes} bytes.`,
      payloadBytes,
      payloadHash,
    };
  }

  const envelopeResult = workflowTriggerEnvelopeSchema.safeParse(input.workflowTrigger);
  if (!envelopeResult.success) {
    return {
      success: false,
      code: "invalid_envelope",
      error: envelopeResult.error.issues[0]?.message ?? "Workflow trigger envelope is invalid.",
      payloadBytes,
      payloadHash,
    };
  }

  if (envelopeResult.data.companyId !== input.companyId) {
    return {
      success: false,
      code: "company_mismatch",
      error: `Workflow trigger companyId "${envelopeResult.data.companyId}" does not match heartbeat run company "${input.companyId}".`,
      payloadBytes,
      payloadHash,
    };
  }

  if (envelopeResult.data.sourceHeartbeatRunId !== input.sourceHeartbeatRunId) {
    return {
      success: false,
      code: "source_run_mismatch",
      error: `Workflow trigger sourceHeartbeatRunId "${envelopeResult.data.sourceHeartbeatRunId}" does not match heartbeat run "${input.sourceHeartbeatRunId}".`,
      payloadBytes,
      payloadHash,
    };
  }

  const payloadSchema = resolveWorkflowTriggerPayloadSchema(envelopeResult.data.contractKey, envelopeResult.data.contractVersion);
  if (!payloadSchema) {
    return {
      success: false,
      code: "unknown_contract",
      error: `Unknown workflow trigger contract "${envelopeResult.data.contractKey}@${envelopeResult.data.contractVersion}".`,
      payloadBytes,
      payloadHash,
    };
  }

  const payloadResult = payloadSchema.safeParse(envelopeResult.data.payload);
  if (!payloadResult.success) {
    return {
      success: false,
      code: "invalid_payload",
      error: payloadResult.error.issues[0]?.message ?? "Workflow trigger payload is invalid.",
      payloadBytes,
      payloadHash,
    };
  }

  return {
    success: true,
    workflowTrigger: {
      ...envelopeResult.data,
      payload: payloadResult.data as WeeklyRetroWorkflowTriggerPayload,
    },
    payloadBytes,
    payloadHash,
  };
}
