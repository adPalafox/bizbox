import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { clickupBridges } from "./clickup_bridges.js";

export const clickupOutboundEvents = pgTable(
  "clickup_outbound_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bridgeId: uuid("bridge_id").notNull().references(() => clickupBridges.id),
    kind: text("kind").notNull().$type<"create_task" | "append_comment" | "update_task">(),
    status: text("status").notNull().$type<"pending" | "processing" | "succeeded" | "failed">().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("clickup_outbound_events_status_idx").on(table.status, table.nextAttemptAt, table.updatedAt),
    bridgeIdx: index("clickup_outbound_events_bridge_idx").on(table.bridgeId, table.createdAt),
    createTaskPendingUniqueIdx: uniqueIndex("clickup_outbound_events_create_task_active_uq")
      .on(table.bridgeId, table.kind)
      .where(sql`${table.kind} = 'create_task' and ${table.status} in ('pending', 'processing')`),
  }),
);
