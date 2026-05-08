import type { UsageSummary } from "@paperclipai/adapter-utils";

type OpenAiResponseEnvelope = {
  id?: unknown;
  output_text?: unknown;
  error?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    input_tokens_details?: {
      cached_tokens?: unknown;
    };
  };
};

export type OpenAiParsedResponse = {
  responseId: string | null;
  summary: string;
  usage?: UsageSummary;
  errorMessage: string | null;
};

function extractText(payload: OpenAiResponseEnvelope): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }
  const errorRecord = payload.error;
  if (
    errorRecord &&
    typeof errorRecord === "object" &&
    typeof (errorRecord as { message?: unknown }).message === "string"
  ) {
    return String((errorRecord as { message?: unknown }).message).trim();
  }
  return "OpenAI completed without returning output_text.";
}

function extractErrorMessage(payload: OpenAiResponseEnvelope): string | null {
  const errorRecord = payload.error;
  if (
    errorRecord &&
    typeof errorRecord === "object" &&
    typeof (errorRecord as { message?: unknown }).message === "string"
  ) {
    const message = String((errorRecord as { message?: unknown }).message).trim();
    return message.length > 0 ? message : null;
  }
  return null;
}

function extractUsage(payload: OpenAiResponseEnvelope): UsageSummary | undefined {
  const usage = payload.usage;
  if (!usage) return undefined;
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  const cachedInputTokens =
    typeof usage.input_tokens_details?.cached_tokens === "number"
      ? usage.input_tokens_details.cached_tokens
      : undefined;
  if (inputTokens <= 0 && outputTokens <= 0 && !cachedInputTokens) return undefined;
  return { inputTokens, outputTokens, cachedInputTokens };
}

export function parseOpenAiAgentResponse(rawText: string): OpenAiParsedResponse {
  const payload = JSON.parse(rawText) as OpenAiResponseEnvelope;
  return {
    responseId: typeof payload.id === "string" && payload.id.trim().length > 0 ? payload.id.trim() : null,
    summary: extractText(payload),
    usage: extractUsage(payload),
    errorMessage: extractErrorMessage(payload),
  };
}

export function isOpenAiAgentUnknownSessionError(rawText: string): boolean {
  try {
    const { errorMessage } = parseOpenAiAgentResponse(rawText);
    const normalized = (errorMessage ?? rawText).toLowerCase();
    return (
      normalized.includes("previous_response_id") &&
      (normalized.includes("not found")
        || normalized.includes("unknown")
        || normalized.includes("does not exist")
        || normalized.includes("invalid"))
    );
  } catch {
    const normalized = rawText.toLowerCase();
    return normalized.includes("previous_response_id") && normalized.includes("not found");
  }
}
