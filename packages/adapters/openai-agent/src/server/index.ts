import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { isOpenAiAgentUnknownSessionError, parseOpenAiAgentResponse } from "./parse.js";

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const previousResponseId =
      typeof record.previousResponseId === "string"
        ? record.previousResponseId.trim()
        : "";
    if (!previousResponseId) return null;

    const session: Record<string, unknown> = { previousResponseId };
    for (const key of ["promptTemplate", "workflowInstruction", "model", "apiBaseUrl"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        session[key] = value.trim();
      }
    }
    if (typeof record.includeContextJson === "boolean") {
      session.includeContextJson = record.includeContextJson;
    }
    return session;
  },
  serialize(params) {
    return this.deserialize(params);
  },
  getDisplayId(params) {
    if (!params || typeof params !== "object") return null;
    const previousResponseId =
      typeof params.previousResponseId === "string" ? params.previousResponseId.trim() : "";
    return previousResponseId || null;
  },
};
