import type { UIAdapterModule } from "../types";
import { buildClickUpAgentRefConfig, parseClickUpAgentRefStdoutLine } from "@paperclipai/adapter-clickup-agent-ref/ui";
import { ClickUpAgentRefConfigFields } from "./config-fields";

export const clickUpAgentRefUIAdapter: UIAdapterModule = {
  type: "clickup_agent_ref",
  label: "ClickUp Agent Reference",
  parseStdoutLine: parseClickUpAgentRefStdoutLine,
  ConfigFields: ClickUpAgentRefConfigFields,
  buildAdapterConfig: buildClickUpAgentRefConfig,
};
