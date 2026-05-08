import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { parseClickUpCommentResponse, parseClickUpTaskResponse } from "./parse.js";

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const clickupTaskId = typeof record.clickupTaskId === "string" ? record.clickupTaskId.trim() : "";
    const clickupTaskUrl = typeof record.clickupTaskUrl === "string" ? record.clickupTaskUrl.trim() : "";
    const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId.trim() : "";
    const syncedClickupCommentIds = Array.isArray(record.syncedClickupCommentIds)
      ? record.syncedClickupCommentIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    if (!clickupTaskId) return null;
    return {
      clickupTaskId,
      ...(clickupTaskUrl ? { clickupTaskUrl } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(syncedClickupCommentIds.length > 0 ? { syncedClickupCommentIds } : {}),
    };
  },
  serialize(params) {
    if (!params || typeof params !== "object") return null;
    return this.deserialize(params);
  },
  getDisplayId(params) {
    if (!params || typeof params !== "object") return null;
    const clickupTaskId = typeof params.clickupTaskId === "string" ? params.clickupTaskId.trim() : "";
    return clickupTaskId || null;
  },
};
