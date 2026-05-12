CREATE TABLE "clickup_bridges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_id" text NOT NULL,
  "task_key" text NOT NULL,
  "clickup_list_id" text NOT NULL,
  "clickup_task_id" text,
  "clickup_task_url" text,
  "mode" text DEFAULT 'api_comment_only' NOT NULL,
  "status" text DEFAULT 'pending_clickup_task' NOT NULL,
  "imported_comment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "last_imported_comment_id" text,
  "last_polled_at" timestamp with time zone,
  "next_poll_at" timestamp with time zone,
  "last_outbound_at" timestamp with time zone,
  "consecutive_poll_failures" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clickup_bridges" ADD CONSTRAINT "clickup_bridges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clickup_bridges" ADD CONSTRAINT "clickup_bridges_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "clickup_bridges_source_list_uq" ON "clickup_bridges" USING btree ("company_id","source_type","source_id","clickup_list_id");
--> statement-breakpoint
CREATE INDEX "clickup_bridges_company_status_idx" ON "clickup_bridges" USING btree ("company_id","status","next_poll_at");
--> statement-breakpoint
CREATE TABLE "clickup_outbound_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bridge_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_error" text,
  "next_attempt_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clickup_outbound_events" ADD CONSTRAINT "clickup_outbound_events_bridge_id_clickup_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."clickup_bridges"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "clickup_outbound_events_status_idx" ON "clickup_outbound_events" USING btree ("status","next_attempt_at","updated_at");
--> statement-breakpoint
CREATE INDEX "clickup_outbound_events_bridge_idx" ON "clickup_outbound_events" USING btree ("bridge_id","created_at");
--> statement-breakpoint
CREATE INDEX "heartbeat_runs_clickup_bridge_id_idx"
  ON "heartbeat_runs" USING btree (("result_json" ->> 'clickupBridgeId'))
  WHERE ("result_json" ? 'clickupBridgeId');
--> statement-breakpoint
CREATE UNIQUE INDEX "clickup_outbound_events_create_task_active_uq"
  ON "clickup_outbound_events" USING btree ("bridge_id", "kind")
  WHERE ("kind" = 'create_task' and "status" in ('pending', 'processing'));
