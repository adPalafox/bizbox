import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { isOpenAiAgentUnknownSessionError, parseOpenAiAgentResponse } from "./parse.js";
import { DEFAULT_OPENAI_MODEL } from "../index.js";

type OpenAiAgentConfig = {
  apiBaseUrl: string;
  authToken: string;
  model: string;
  reasoningEffort?: "low" | "medium" | "high";
  workflowInstruction?: string;
  studioUrl?: string;
  storeResponses: boolean;
  includeContextJson: boolean;
  timeoutSec: number;
};

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeBaseUrl(raw: string): string {
  const candidate = raw.trim() || "https://api.openai.com/v1";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`openai_agent adapter: invalid apiBaseUrl '${candidate}'.`);
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    throw new Error("openai_agent adapter: plaintext HTTP is not permitted for remote hosts.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function resolveConfig(ctx: AdapterExecutionContext): OpenAiAgentConfig {
  const raw = parseObject(ctx.config);
  const authToken = asString(raw.authToken, "").trim();
  if (!authToken) {
    throw new Error(
      "openai_agent adapter requires authToken or authTokenRef in adapterConfig.",
    );
  }

  const reasoningEffortRaw = asString(raw.reasoningEffort, "").trim().toLowerCase();
  const reasoningEffort =
    reasoningEffortRaw === "low" || reasoningEffortRaw === "medium" || reasoningEffortRaw === "high"
      ? (reasoningEffortRaw as "low" | "medium" | "high")
      : undefined;

  const timeoutSec = Math.max(1, asNumber(raw.timeoutSec, 600));
  return {
    apiBaseUrl: normalizeBaseUrl(asString(raw.apiBaseUrl, "https://api.openai.com/v1")),
    authToken,
    model: asString(raw.model, DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
    reasoningEffort,
    workflowInstruction: asString(raw.workflowInstruction, "").trim() || undefined,
    studioUrl: asString(raw.studioUrl, "").trim() || undefined,
    storeResponses: raw.storeResponses !== false,
    includeContextJson: raw.includeContextJson !== false,
    timeoutSec,
  };
}

function readPreviousResponseId(ctx: AdapterExecutionContext): string | null {
  const session = ctx.runtime.sessionParams;
  if (!session || typeof session !== "object") return null;
  const value = session.previousResponseId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildPrompt(ctx: AdapterExecutionContext, config: OpenAiAgentConfig): string {
  const sections: string[] = [];
  if (config.workflowInstruction) {
    sections.push(`Workflow instruction:\n${config.workflowInstruction}`);
  }

  const rawContext = parseObject(ctx.context);
  const promptFields = [rawContext.prompt, rawContext.instructions, rawContext.wakeText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (promptFields.length > 0) {
    sections.push(promptFields.join("\n\n"));
  }

  if (config.includeContextJson) {
    sections.push(`Bizbox context JSON:\n${JSON.stringify(ctx.context, null, 2)}`);
  }

  return sections.join("\n\n").trim() || "Proceed with the assigned Bizbox work.";
}

async function sendRequest(
  ctx: AdapterExecutionContext,
  config: OpenAiAgentConfig,
  prompt: string,
  previousResponseId: string | null,
) {
  const body: Record<string, unknown> = {
    model: config.model,
    input: prompt,
    ...(config.storeResponses ? { store: true } : {}),
  };
  if (previousResponseId) body.previous_response_id = previousResponseId;
  if (config.reasoningEffort) {
    body.reasoning = { effort: config.reasoningEffort };
  }

  await ctx.onLog("stdout", `[openai-agent] POST ${config.apiBaseUrl}/responses\n`);
  await ctx.onLog(
    "stdout",
    `[openai-agent] model=${config.model} previous_response_id=${previousResponseId ?? "none"}\n`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutSec * 1000);
  try {
    const response = await fetch(`${config.apiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.authToken}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await response.text();
    return { response, rawText };
  } finally {
    clearTimeout(timer);
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  let config: OpenAiAgentConfig;
  try {
    config = resolveConfig(ctx);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `[openai-agent] ERROR: ${errorMessage}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage,
      errorCode: "CONFIG_ERROR",
    };
  }

  const prompt = buildPrompt(ctx, config);
  const previousResponseId = readPreviousResponseId(ctx);
  if (config.studioUrl) {
    await ctx.onLog("stdout", `[openai-agent] studio=${config.studioUrl}\n`);
  }

  await ctx.onMeta?.({
    adapterType: "openai_agent",
    command: `POST ${config.apiBaseUrl}/responses`,
    prompt,
    context: ctx.context,
  });
  let response: Response;
  let rawText = "";
  try {
    ({ response, rawText } = await sendRequest(ctx, config, prompt, previousResponseId));
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const errorMessage = isTimeout
      ? `Request timed out after ${config.timeoutSec}s`
      : `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`;
    await ctx.onLog("stderr", `[openai-agent] ERROR: ${errorMessage}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage,
      errorCode: isTimeout ? "TIMEOUT" : "HTTP_ERROR",
    };
  }
  if (!response.ok) {
    if (previousResponseId && isOpenAiAgentUnknownSessionError(rawText)) {
      await ctx.onLog(
        "stderr",
        "[openai-agent] WARN: previous_response_id is no longer valid; retrying with a fresh session\n",
      );
      try {
        ({ response, rawText } = await sendRequest(ctx, config, prompt, null));
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        const errorMessage = isTimeout
          ? `Request timed out after ${config.timeoutSec}s`
          : `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`;
        await ctx.onLog("stderr", `[openai-agent] ERROR: ${errorMessage}\n`);
        return {
          exitCode: 1,
          signal: null,
          timedOut: isTimeout,
          errorMessage,
          errorCode: isTimeout ? "TIMEOUT" : "HTTP_ERROR",
          clearSession: true,
        };
      }
    }
  }

  if (!response.ok) {
    const errorMessage = `HTTP ${response.status}: ${response.statusText}${rawText ? ` — ${rawText.slice(0, 500)}` : ""}`;
    await ctx.onLog("stderr", `[openai-agent] ERROR: ${errorMessage}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage,
      errorCode: `HTTP_${response.status}`,
    };
  }

  try {
    const parsed = parseOpenAiAgentResponse(rawText);
    await ctx.onLog("stdout", `[openai-agent] response_id=${parsed.responseId ?? "none"}\n`);
    await ctx.onLog("stdout", `${parsed.summary}\n`);
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: parsed.summary,
      usage: parsed.usage,
      provider: "openai",
      biller: "openai",
      billingType: "metered_api",
      model: config.model,
      sessionParams: parsed.responseId
        ? { previousResponseId: parsed.responseId }
        : ctx.runtime.sessionParams,
      sessionDisplayId: parsed.responseId,
      resultJson: parsed.responseId ? { responseId: parsed.responseId } : null,
      clearSession: previousResponseId ? previousResponseId !== parsed.responseId && parsed.responseId != null : false,
    };
  } catch {
    const errorMessage = "Failed to parse OpenAI response JSON.";
    await ctx.onLog("stderr", `[openai-agent] ERROR: ${errorMessage}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage,
      errorCode: "PARSE_ERROR",
    };
  }
}
