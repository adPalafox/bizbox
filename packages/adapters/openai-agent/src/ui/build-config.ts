import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { DEFAULT_OPENAI_MODEL } from "../index.js";

export function buildOpenAiAgentConfig(v: CreateConfigValues): Record<string, unknown> {
  const adapterSchemaValues = v.adapterSchemaValues ?? {};
  const config: Record<string, unknown> = {
    promptTemplate: v.promptTemplate.trim(),
    model:
      typeof adapterSchemaValues.model === "string" && adapterSchemaValues.model.trim().length > 0
        ? adapterSchemaValues.model.trim()
        : v.model.trim() || DEFAULT_OPENAI_MODEL,
    timeoutSec:
      typeof adapterSchemaValues.timeoutSec === "number"
        ? adapterSchemaValues.timeoutSec
        : v.timeoutSec ?? 600,
    includeContextJson: adapterSchemaValues.includeContextJson !== false,
  };
  if (!config.promptTemplate) {
    delete config.promptTemplate;
  }

  if (v.apiKey?.trim()) config.authToken = v.apiKey.trim();
  if (typeof adapterSchemaValues.apiBaseUrl === "string" && adapterSchemaValues.apiBaseUrl.trim()) {
    config.apiBaseUrl = adapterSchemaValues.apiBaseUrl.trim();
  }
  if (typeof adapterSchemaValues.reasoningEffort === "string" && adapterSchemaValues.reasoningEffort.trim()) {
    config.reasoningEffort = adapterSchemaValues.reasoningEffort.trim();
  }
  if (typeof adapterSchemaValues.workflowInstruction === "string" && adapterSchemaValues.workflowInstruction.trim()) {
    config.workflowInstruction = adapterSchemaValues.workflowInstruction.trim();
  }
  if (typeof adapterSchemaValues.studioUrl === "string" && adapterSchemaValues.studioUrl.trim()) {
    config.studioUrl = adapterSchemaValues.studioUrl.trim();
  }
  if (typeof adapterSchemaValues.storeResponses === "boolean") {
    config.storeResponses = adapterSchemaValues.storeResponses;
  }

  return config;
}
