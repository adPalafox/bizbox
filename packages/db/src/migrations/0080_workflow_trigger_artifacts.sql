CREATE TABLE IF NOT EXISTS "workflow_trigger_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies" ("id") ON DELETE cascade,
  "source_agent_id" uuid NOT NULL REFERENCES "agents" ("id") ON DELETE cascade,
  "source_heartbeat_run_id" uuid NOT NULL REFERENCES "heartbeat_runs" ("id") ON DELETE cascade,
  "source_heartbeat_run_status" text NOT NULL,
  "target_workflow_id" uuid REFERENCES "workflows" ("id") ON DELETE set null,
  "contract_key" text NOT NULL,
  "contract_version" text NOT NULL,
  "payload_json" jsonb NOT NULL,
  "payload_bytes" integer NOT NULL,
  "payload_hash" text NOT NULL,
  "validation_status" text NOT NULL,
  "validation_error" text,
  "trigger_status" text NOT NULL,
  "trigger_error" text,
  "triggered_workflow_run_id" uuid REFERENCES "workflow_runs" ("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_trigger_artifacts_source_heartbeat_run_id_uq"
  ON "workflow_trigger_artifacts" ("source_heartbeat_run_id");

CREATE INDEX IF NOT EXISTS "workflow_trigger_artifacts_company_created_idx"
  ON "workflow_trigger_artifacts" ("company_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "workflow_trigger_artifacts_company_contract_idx"
  ON "workflow_trigger_artifacts" ("company_id", "contract_key", "contract_version");
