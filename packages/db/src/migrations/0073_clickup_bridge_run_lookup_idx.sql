CREATE INDEX "heartbeat_runs_clickup_bridge_id_idx"
  ON "heartbeat_runs" USING btree (("result_json" ->> 'clickupBridgeId'))
  WHERE ("result_json" ? 'clickupBridgeId');
