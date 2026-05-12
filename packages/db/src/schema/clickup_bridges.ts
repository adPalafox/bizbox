import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index, integer } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const clickupBridges = pgTable(
  "clickup_bridges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    sourceType: text("source_type").notNull().$type<"issue" | "agent_thread">(),
    sourceId: text("source_id").notNull(),
    taskKey: text("task_key").notNull(),
    clickupListId: text("clickup_list_id").notNull(),
    clickupTaskId: text("clickup_task_id"),
    clickupTaskUrl: text("clickup_task_url"),
    mode: text("mode").notNull().$type<"api_comment_only" | "automation_trigger">().default("api_comment_only"),
    status: text("status")
      .notNull()
      .$type<"pending_clickup_task" | "waiting_for_agent_reply" | "agent_replied" | "failed" | "closed">()
      .default("pending_clickup_task"),
    importedCommentIds: jsonb("imported_comment_ids").$type<string[]>().notNull().default([]),
    lastImportedCommentId: text("last_imported_comment_id"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    consecutivePollFailures: integer("consecutive_poll_failures").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceUniq: uniqueIndex("clickup_bridges_source_list_uq").on(
      table.companyId,
      table.sourceType,
      table.sourceId,
      table.clickupListId,
    ),
    activeIdx: index("clickup_bridges_company_status_idx").on(table.companyId, table.status, table.nextPollAt),
  }),
);
