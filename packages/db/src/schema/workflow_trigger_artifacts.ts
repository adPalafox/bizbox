import { desc } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { workflowRuns, workflows } from "./workflows.js";

export const workflowTriggerArtifacts = pgTable(
  "workflow_trigger_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceAgentId: uuid("source_agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    sourceHeartbeatRunId: uuid("source_heartbeat_run_id").notNull().references(() => heartbeatRuns.id, { onDelete: "cascade" }),
    sourceHeartbeatRunStatus: text("source_heartbeat_run_status").notNull(),
    targetWorkflowId: uuid("target_workflow_id").references(() => workflows.id, { onDelete: "set null" }),
    contractKey: text("contract_key").notNull(),
    contractVersion: text("contract_version").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    payloadBytes: integer("payload_bytes").notNull(),
    payloadHash: text("payload_hash").notNull(),
    validationStatus: text("validation_status").$type<"passed" | "failed">().notNull(),
    validationError: text("validation_error"),
    triggerStatus: text("trigger_status").$type<"not_triggered" | "triggering" | "triggered" | "failed">().notNull(),
    triggerError: text("trigger_error"),
    triggeredWorkflowRunId: uuid("triggered_workflow_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceRunUq: uniqueIndex("workflow_trigger_artifacts_source_heartbeat_run_id_uq").on(table.sourceHeartbeatRunId),
    companyCreatedIdx: index("workflow_trigger_artifacts_company_created_idx").on(table.companyId, desc(table.createdAt)),
    companyContractIdx: index("workflow_trigger_artifacts_company_contract_idx").on(
      table.companyId,
      table.contractKey,
      table.contractVersion,
    ),
  }),
);
