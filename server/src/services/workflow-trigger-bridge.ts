import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, workflowTriggerArtifacts, workflows } from "@paperclipai/db";
import {
  validateWorkflowTrigger,
  workflowTriggerEnvelopeSchema,
  type WorkflowTriggerLineage,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { workflowService } from "./workflows.js";

type WorkflowTriggerArtifactRow = typeof workflowTriggerArtifacts.$inferSelect;

function normalizeTriggerPayload(raw: unknown) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return { value: raw };
}

function readWorkflowTriggerCandidate(resultJson: Record<string, unknown> | null | undefined) {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) return null;
  return (resultJson as Record<string, unknown>).workflowTrigger ?? null;
}

function toWorkflowTriggerLineage(row: WorkflowTriggerArtifactRow): WorkflowTriggerLineage {
  return {
    artifactId: row.id,
    sourceHeartbeatRunId: row.sourceHeartbeatRunId,
    sourceAgentId: row.sourceAgentId,
    sourceHeartbeatRunStatus: row.sourceHeartbeatRunStatus,
    targetWorkflowId: row.targetWorkflowId ?? null,
    contractKey: row.contractKey,
    contractVersion: row.contractVersion,
    payloadHash: row.payloadHash,
    payloadBytes: row.payloadBytes,
    validationStatus: row.validationStatus,
    validationError: row.validationError ?? null,
    triggerStatus: row.triggerStatus,
    triggerError: row.triggerError ?? null,
    triggeredWorkflowRunId: row.triggeredWorkflowRunId ?? null,
    payload: (row.payloadJson as Record<string, unknown>) ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializeWorkflowTriggerLineage(lineage: WorkflowTriggerLineage) {
  return {
    ...lineage,
    createdAt: lineage.createdAt.toISOString(),
    updatedAt: lineage.updatedAt.toISOString(),
  };
}

async function updateHeartbeatRunTriggerContext(db: Db, runId: string, lineage: WorkflowTriggerLineage) {
  const run = await db
    .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.id, runId))
    .then((rows) => rows[0] ?? null);
  const baseContext = (run?.contextSnapshot as Record<string, unknown> | null) ?? {};
  await db.update(heartbeatRuns).set({
    contextSnapshot: {
      ...baseContext,
      workflowTrigger: serializeWorkflowTriggerLineage(lineage),
    },
    updatedAt: new Date(),
  }).where(eq(heartbeatRuns.id, runId));
}

async function recordBridgeActivity(
  db: Db,
  input: Parameters<typeof logActivity>[1],
) {
  try {
    await logActivity(db, input);
  } catch (error) {
    logger.warn({ err: error, action: input.action, entityId: input.entityId }, "workflow trigger bridge activity log failed");
  }
}

async function selectTargetWorkflow(db: Db, companyId: string, contractKey: string, contractVersion: string) {
  return db
    .select()
    .from(workflows)
    .where(and(
      eq(workflows.companyId, companyId),
      eq(workflows.status, "active"),
      sql`coalesce(${workflows.runnerConfig} ->> 'inputContractKey', '') = ${contractKey}`,
      sql`coalesce(${workflows.runnerConfig} ->> 'inputContractVersion', '') = ${contractVersion}`,
    ))
    .then((rows) => rows);
}

async function persistArtifactRow(
  db: Db,
  input: {
    companyId: string;
    sourceHeartbeatRunId: string;
    sourceAgentId: string;
    sourceHeartbeatRunStatus: string;
    targetWorkflowId: string | null;
    contractKey: string;
    contractVersion: string;
    payloadJson: Record<string, unknown>;
    payloadBytes: number;
    payloadHash: string;
    validationStatus: "passed" | "failed";
    validationError: string | null;
    triggerStatus: "not_triggered" | "triggering" | "triggered" | "failed";
    triggerError: string | null;
    triggeredWorkflowRunId: string | null;
  },
) {
  const inserted = await db.insert(workflowTriggerArtifacts).values({
    companyId: input.companyId,
    sourceHeartbeatRunId: input.sourceHeartbeatRunId,
    sourceAgentId: input.sourceAgentId,
    sourceHeartbeatRunStatus: input.sourceHeartbeatRunStatus,
    targetWorkflowId: input.targetWorkflowId,
    contractKey: input.contractKey,
    contractVersion: input.contractVersion,
    payloadJson: input.payloadJson,
    payloadBytes: input.payloadBytes,
    payloadHash: input.payloadHash,
    validationStatus: input.validationStatus,
    validationError: input.validationError,
    triggerStatus: input.triggerStatus,
    triggerError: input.triggerError,
    triggeredWorkflowRunId: input.triggeredWorkflowRunId,
  }).onConflictDoNothing().returning().then((rows) => rows[0] ?? null);

  if (inserted) return inserted;
  return db
    .select()
    .from(workflowTriggerArtifacts)
    .where(eq(workflowTriggerArtifacts.sourceHeartbeatRunId, input.sourceHeartbeatRunId))
    .then((rows) => rows[0] ?? null);
}

export function workflowTriggerBridgeService(db: Db) {
  const workflowSvc = workflowService(db);

  return {
    processCompletedHeartbeatRun: async (run: typeof heartbeatRuns.$inferSelect) => {
      const rawWorkflowTrigger = readWorkflowTriggerCandidate(run.resultJson as Record<string, unknown> | null | undefined);
      if (!rawWorkflowTrigger) {
        return { status: "skipped" as const, reason: "no_workflow_trigger" as const };
      }

      const envelopeResult = workflowTriggerEnvelopeSchema.safeParse(rawWorkflowTrigger);
      const validation = validateWorkflowTrigger({
        workflowTrigger: rawWorkflowTrigger,
        companyId: run.companyId,
        sourceHeartbeatRunId: run.id,
      });
      const payloadBytes = validation.payloadBytes;
      const payloadHash = validation.payloadHash;
      const contractKey = envelopeResult.success ? envelopeResult.data.contractKey : "unknown";
      const contractVersion = envelopeResult.success ? envelopeResult.data.contractVersion : "unknown";
      const payloadJson = validation.success
        ? validation.workflowTrigger.payload
        : normalizeTriggerPayload(envelopeResult.success ? envelopeResult.data.payload : rawWorkflowTrigger);

      const existingArtifact = await db
        .select()
        .from(workflowTriggerArtifacts)
        .where(eq(workflowTriggerArtifacts.sourceHeartbeatRunId, run.id))
        .then((rows) => rows[0] ?? null);
      if (existingArtifact) {
        await updateHeartbeatRunTriggerContext(db, run.id, toWorkflowTriggerLineage(existingArtifact));
        return {
          status: "duplicate" as const,
          artifact: toWorkflowTriggerLineage(existingArtifact),
        };
      }

      const validationStatus = validation.success ? "passed" as const : "failed" as const;
      const validationError = validation.success ? null : validation.error;
      const triggerStatus = validation.success ? "triggering" as const : "not_triggered" as const;

      const insertedArtifact = await persistArtifactRow(db, {
        companyId: run.companyId,
        sourceAgentId: run.agentId,
        sourceHeartbeatRunId: run.id,
        sourceHeartbeatRunStatus: run.status,
        targetWorkflowId: null,
        contractKey,
        contractVersion,
        payloadJson,
        payloadBytes,
        payloadHash,
        validationStatus,
        validationError,
        triggerStatus,
        triggerError: validationError,
        triggeredWorkflowRunId: null,
      });

      if (!insertedArtifact) {
        const fetchedArtifact = await db
          .select()
          .from(workflowTriggerArtifacts)
          .where(eq(workflowTriggerArtifacts.sourceHeartbeatRunId, run.id))
          .then((rows) => rows[0] ?? null);
        if (fetchedArtifact) {
          await updateHeartbeatRunTriggerContext(db, run.id, toWorkflowTriggerLineage(fetchedArtifact));
          return {
            status: "duplicate" as const,
            artifact: toWorkflowTriggerLineage(fetchedArtifact),
          };
        }
        throw new Error("Failed to persist workflow trigger artifact");
      }

      let artifactRow = insertedArtifact;
      await updateHeartbeatRunTriggerContext(db, run.id, toWorkflowTriggerLineage(artifactRow));

      await recordBridgeActivity(db, {
        companyId: run.companyId,
        actorType: "system",
        actorId: "workflow-trigger-bridge",
        action: validation.success ? "workflow.trigger_validation_succeeded" : "workflow.trigger_validation_failed",
        entityType: "workflow_trigger_artifact",
        entityId: artifactRow.id,
        runId: run.id,
        details: {
          sourceHeartbeatRunId: run.id,
          contractKey,
          contractVersion,
          payloadBytes,
          payloadHash,
          validationStatus,
          validationError,
        },
      });

      if (!validation.success) {
        return {
          status: "validation_failed" as const,
          artifact: toWorkflowTriggerLineage(artifactRow),
          validationError,
        };
      }

      const targetWorkflows = await selectTargetWorkflow(db, run.companyId, validation.workflowTrigger.contractKey, validation.workflowTrigger.contractVersion);
      if (targetWorkflows.length !== 1) {
        const triggerError = targetWorkflows.length === 0
          ? `No active workflow is configured for contract ${validation.workflowTrigger.contractKey}@${validation.workflowTrigger.contractVersion}.`
          : `Multiple workflows are configured for contract ${validation.workflowTrigger.contractKey}@${validation.workflowTrigger.contractVersion}.`;
        const updatedArtifact = await db.update(workflowTriggerArtifacts).set({
          triggerStatus: "failed",
          triggerError,
          updatedAt: new Date(),
        }).where(eq(workflowTriggerArtifacts.id, artifactRow.id)).returning().then((rows) => rows[0] ?? null);
        artifactRow = updatedArtifact ?? artifactRow;
        await updateHeartbeatRunTriggerContext(db, run.id, toWorkflowTriggerLineage(artifactRow));
        await recordBridgeActivity(db, {
          companyId: run.companyId,
          actorType: "system",
          actorId: "workflow-trigger-bridge",
          action: "workflow.trigger_failed",
          entityType: "workflow_trigger_artifact",
          entityId: artifactRow.id,
          runId: run.id,
          details: {
            sourceHeartbeatRunId: run.id,
            contractKey: validation.workflowTrigger.contractKey,
            contractVersion: validation.workflowTrigger.contractVersion,
            triggerError,
          },
        });
        return {
          status: "trigger_failed" as const,
          artifact: toWorkflowTriggerLineage(artifactRow),
          triggerError,
        };
      }

      const targetWorkflow = targetWorkflows[0]!;
      const finalLineage: WorkflowTriggerLineage = {
        artifactId: artifactRow.id,
        sourceHeartbeatRunId: run.id,
        sourceAgentId: run.agentId,
        sourceHeartbeatRunStatus: run.status,
        targetWorkflowId: targetWorkflow.id,
        contractKey: validation.workflowTrigger.contractKey,
        contractVersion: validation.workflowTrigger.contractVersion,
        payloadHash,
        payloadBytes,
        validationStatus: "passed",
        validationError: null,
        triggerStatus: "triggering",
        triggerError: null,
        triggeredWorkflowRunId: null,
        payload: validation.workflowTrigger.payload,
        createdAt: artifactRow.createdAt,
        updatedAt: artifactRow.updatedAt,
      };

      try {
        const workflowRun = await workflowSvc.runFromTrigger(targetWorkflow.id, {
          workflowTrigger: finalLineage,
        });
        const updatedArtifact = await db.update(workflowTriggerArtifacts).set({
          targetWorkflowId: targetWorkflow.id,
          triggerStatus: "triggered",
          triggeredWorkflowRunId: workflowRun.id,
          triggerError: null,
          updatedAt: new Date(),
        }).where(eq(workflowTriggerArtifacts.id, artifactRow.id)).returning().then((rows) => rows[0] ?? null);
        artifactRow = updatedArtifact ?? artifactRow;
        await updateHeartbeatRunTriggerContext(db, run.id, toWorkflowTriggerLineage(artifactRow));
        await recordBridgeActivity(db, {
          companyId: run.companyId,
          actorType: "system",
          actorId: "workflow-trigger-bridge",
          action: "workflow.triggered",
          entityType: "workflow_trigger_artifact",
          entityId: artifactRow.id,
          runId: run.id,
          details: {
            sourceHeartbeatRunId: run.id,
            targetWorkflowId: targetWorkflow.id,
            triggeredWorkflowRunId: workflowRun.id,
            contractKey: validation.workflowTrigger.contractKey,
            contractVersion: validation.workflowTrigger.contractVersion,
          },
        });
        return {
          status: "triggered" as const,
          artifact: toWorkflowTriggerLineage(artifactRow),
          workflowRun,
        };
      } catch (error) {
        const triggerError = error instanceof Error ? error.message : String(error);
        const updatedArtifact = await db.update(workflowTriggerArtifacts).set({
          targetWorkflowId: targetWorkflow.id,
          triggerStatus: "failed",
          triggerError,
          updatedAt: new Date(),
        }).where(eq(workflowTriggerArtifacts.id, artifactRow.id)).returning().then((rows) => rows[0] ?? null);
        artifactRow = updatedArtifact ?? artifactRow;
        await updateHeartbeatRunTriggerContext(db, run.id, toWorkflowTriggerLineage(artifactRow));
        await recordBridgeActivity(db, {
          companyId: run.companyId,
          actorType: "system",
          actorId: "workflow-trigger-bridge",
          action: "workflow.trigger_failed",
          entityType: "workflow_trigger_artifact",
          entityId: artifactRow.id,
          runId: run.id,
          details: {
            sourceHeartbeatRunId: run.id,
            targetWorkflowId: targetWorkflow.id,
            contractKey: validation.workflowTrigger.contractKey,
            contractVersion: validation.workflowTrigger.contractVersion,
            triggerError,
          },
        });
        logger.error({ err: error, runId: run.id, workflowId: targetWorkflow.id }, "workflow trigger bridge failed");
        return {
          status: "trigger_failed" as const,
          artifact: toWorkflowTriggerLineage(artifactRow),
          triggerError,
        };
      }
    },
  };
}
