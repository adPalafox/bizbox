import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export function buildClickUpAgentRefConfig(v: CreateConfigValues): Record<string, unknown> {
  const adapterSchemaValues = v.adapterSchemaValues ?? {};
  const config: Record<string, unknown> = {
    timeoutSec:
      typeof adapterSchemaValues.timeoutSec === "number"
        ? adapterSchemaValues.timeoutSec
        : v.timeoutSec ?? 120,
    includeContextJson: adapterSchemaValues.includeContextJson !== false,
  };

  if (v.apiKey?.trim()) config.authToken = v.apiKey.trim();
  if (typeof adapterSchemaValues.workspaceId === "string" && adapterSchemaValues.workspaceId.trim()) {
    config.workspaceId = adapterSchemaValues.workspaceId.trim();
  }
  if (typeof adapterSchemaValues.listId === "string" && adapterSchemaValues.listId.trim()) {
    config.listId = adapterSchemaValues.listId.trim();
  }
  if (typeof adapterSchemaValues.channelId === "string" && adapterSchemaValues.channelId.trim()) {
    config.channelId = adapterSchemaValues.channelId.trim();
  }
  if (typeof adapterSchemaValues.bridgeBotUserId === "string" && adapterSchemaValues.bridgeBotUserId.trim()) {
    config.bridgeBotUserId = adapterSchemaValues.bridgeBotUserId.trim();
  }
  if (
    (typeof adapterSchemaValues.clickupAgentUserId === "number" && Number.isFinite(adapterSchemaValues.clickupAgentUserId)) ||
    (typeof adapterSchemaValues.clickupAgentUserId === "string" && adapterSchemaValues.clickupAgentUserId.trim())
  ) {
    config.clickupAgentUserId = adapterSchemaValues.clickupAgentUserId;
  }
  if (typeof adapterSchemaValues.triggerMode === "string" && adapterSchemaValues.triggerMode.trim()) {
    config.triggerMode = adapterSchemaValues.triggerMode.trim();
  }
  if (typeof adapterSchemaValues.automationStatus === "string" && adapterSchemaValues.automationStatus.trim()) {
    config.automationStatus = adapterSchemaValues.automationStatus.trim();
  }
  if (typeof adapterSchemaValues.automationTags === "string" && adapterSchemaValues.automationTags.trim()) {
    config.automationTags = adapterSchemaValues.automationTags
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return config;
}
