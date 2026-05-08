import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { isOpenAiAgentUnknownSessionError, parseOpenAiAgentResponse } from "./parse.js";

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const previousResponseId =
      typeof (raw as { previousResponseId?: unknown }).previousResponseId === "string"
        ? (raw as { previousResponseId: string }).previousResponseId.trim()
        : "";
    return previousResponseId ? { previousResponseId } : null;
  },
  serialize(params) {
    if (!params || typeof params !== "object") return null;
    const previousResponseId =
      typeof params.previousResponseId === "string" ? params.previousResponseId.trim() : "";
    return previousResponseId ? { previousResponseId } : null;
  },
  getDisplayId(params) {
    if (!params || typeof params !== "object") return null;
    const previousResponseId =
      typeof params.previousResponseId === "string" ? params.previousResponseId.trim() : "";
    return previousResponseId || null;
  },
};
