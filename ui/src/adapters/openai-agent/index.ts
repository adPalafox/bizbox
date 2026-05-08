import type { UIAdapterModule } from "../types";
import { buildOpenAiAgentConfig, parseOpenAiAgentStdoutLine } from "@paperclipai/adapter-openai-agent/ui";
import { OpenAiAgentConfigFields } from "./config-fields";

export const openAiAgentUIAdapter: UIAdapterModule = {
  type: "openai_agent",
  label: "OpenAI Agent",
  parseStdoutLine: parseOpenAiAgentStdoutLine,
  ConfigFields: OpenAiAgentConfigFields,
  buildAdapterConfig: buildOpenAiAgentConfig,
};
