import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { asNumber, asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { buildClickUpContextBody } from "./body.js";
import { parseClickUpCommentResponse, parseClickUpTaskResponse } from "./parse.js";

type ClickUpTriggerMode = "api_comment_only" | "automation_trigger";

type ClickUpAgentRefConfig = {
  apiBaseUrl: string;
  authToken: string;
  workspaceId: string;
  listId: string;
  channelId?: string;
  clickupAgentName?: string;
  clickupAgentUserId?: number;
  clickupAgentUrl?: string;
  triggerMode: ClickUpTriggerMode;
  automationStatus?: string;
  automationTags: string[];
  includeContextJson: boolean;
  timeoutSec: number;
};

type ClickUpCommentUser = {
  id?: unknown;
  username?: unknown;
};

type ClickUpCommentEntry = {
  id: string;
  body: string;
  createdAt: number;
  authorName: string | null;
  isReply: boolean;
};

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function normalizeBaseUrl(raw: string): string {
  const candidate = raw.trim() || "https://api.clickup.com/api/v2";
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`clickup_agent_ref adapter: invalid apiBaseUrl '${candidate}'.`);
  }
  if (parsed.protocol === "http:" && !isLoopback(parsed.hostname)) {
    throw new Error("clickup_agent_ref adapter: plaintext HTTP is not permitted for remote hosts.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function asScalarString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return "";
}

function resolveConfig(ctx: AdapterExecutionContext): ClickUpAgentRefConfig {
  const raw = parseObject(ctx.config);
  const authToken = asString(raw.authToken, "").trim();
  const workspaceId = asString(raw.workspaceId, "").trim();
  const listId = asString(raw.listId, "").trim();
  if (!authToken) {
    throw new Error("clickup_agent_ref adapter requires authToken or authTokenRef in adapterConfig.");
  }
  if (!workspaceId) {
    throw new Error("clickup_agent_ref adapter requires workspaceId in adapterConfig.");
  }
  if (!listId) {
    throw new Error("clickup_agent_ref adapter requires listId in adapterConfig.");
  }
  return {
    apiBaseUrl: normalizeBaseUrl(asString(raw.apiBaseUrl, "https://api.clickup.com/api/v2")),
    authToken,
    workspaceId,
    listId,
    channelId: asString(raw.channelId, "").trim() || undefined,
    clickupAgentName: asString(raw.clickupAgentName, "").trim() || undefined,
    clickupAgentUserId: (() => {
      const value = raw.clickupAgentUserId;
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
      }
      if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(parsed)) return parsed;
      }
      return undefined;
    })(),
    clickupAgentUrl: asString(raw.clickupAgentUrl, "").trim() || undefined,
    triggerMode: asString(raw.triggerMode, "").trim() === "automation_trigger" ? "automation_trigger" : "api_comment_only",
    automationStatus: asString(raw.automationStatus, "").trim() || undefined,
    automationTags: (() => {
      const value = raw.automationTags;
      if (Array.isArray(value)) {
        return value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
      if (typeof value === "string" && value.trim().length > 0) {
        return value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
      return [];
    })(),
    includeContextJson: raw.includeContextJson !== false,
    timeoutSec: Math.max(1, asNumber(raw.timeoutSec, 120)),
  };
}

function buildTitle(ctx: AdapterExecutionContext): string {
  const rawContext = parseObject(ctx.context);
  const issue = parseObject(rawContext.issue);
  const wake = parseObject(rawContext.paperclipWake);
  const wakeIssue = parseObject(wake.issue);
  const title =
    asString(issue.title, "").trim()
    || asString(wakeIssue.title, "").trim()
    || asString(rawContext.issueTitle, "").trim();
  const identifier =
    asString(issue.identifier, "").trim()
    || asString(wakeIssue.identifier, "").trim();
  if (title && identifier) return `${identifier} - ${title}`;
  return title || identifier || `Bizbox work item ${ctx.runtime.taskKey ?? ctx.runId}`;
}

function buildBody(ctx: AdapterExecutionContext, config: ClickUpAgentRefConfig): string {
  return buildClickUpContextBody(ctx.context, {
    clickupAgentName: config.clickupAgentName,
    clickupAgentUrl: config.clickupAgentUrl,
    includeContextJson: config.includeContextJson,
  });
}

export function buildCommentPayload(body: string, config: ClickUpAgentRefConfig): Record<string, unknown> {
  if (config.triggerMode === "automation_trigger") {
    return { comment_text: body, notify_all: false };
  }
  if (!config.clickupAgentUserId) {
    if (config.clickupAgentName) {
      return {
        comment_text: `@${config.clickupAgentName}\n\n${body}`,
        notify_all: false,
      };
    }
    return { comment_text: body, notify_all: false };
  }

  const prefix = config.clickupAgentName
    ? `Requesting review from ${config.clickupAgentName}: `
    : "Requesting review: ";

  return {
    comment: [
      { text: prefix },
      {
        type: "tag",
        user: {
          id: config.clickupAgentUserId,
        },
      },
      { text: `\n\n${body}` },
    ],
    notify_all: false,
    assignee: config.clickupAgentUserId,
  };
}

function readStoredTaskId(ctx: AdapterExecutionContext): string | null {
  const session = ctx.runtime.sessionParams;
  if (!session || typeof session !== "object") return null;
  const value = session.clickupTaskId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStoredSyncedCommentIds(ctx: AdapterExecutionContext): Set<string> {
  const session = ctx.runtime.sessionParams;
  if (!session || typeof session !== "object") return new Set();
  const raw = session.syncedClickupCommentIds;
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function buildHeaders(config: ClickUpAgentRefConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: config.authToken,
  };
}

async function requestJson(
  url: string,
  init: RequestInit,
  timeoutSec: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function buildTaskFields(body: string, config: ClickUpAgentRefConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    description: body,
  };
  if (config.triggerMode !== "automation_trigger") return fields;
  if (config.automationStatus) fields.status = config.automationStatus;
  if (config.automationTags.length > 0) fields.tags = config.automationTags;
  return fields;
}

async function syncTaskDetails(
  ctx: AdapterExecutionContext,
  config: ClickUpAgentRefConfig,
  headers: Record<string, string>,
  taskId: string,
  body: string,
): Promise<void> {
  const taskFields = buildTaskFields(body, config);
  await ctx.onLog(
    "stdout",
    `[clickup-agent-ref] sync task details to task=${taskId} status=${config.automationStatus ?? "unchanged"} tags=${config.automationTags.join(",") || "unchanged"}\n`,
  );
  const updateResult = await requestJson(
    `${config.apiBaseUrl}/task/${taskId}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify(taskFields),
    },
    config.timeoutSec,
  );
  if (!updateResult.response.ok) {
    throw new Error(
      `Automation signal failed: HTTP ${updateResult.response.status}: ${updateResult.response.statusText}${updateResult.text ? ` — ${updateResult.text.slice(0, 500)}` : ""}`,
    );
  }
}

function normalizeCommentText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function renderCommentRichText(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const text = raw
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const row = part as Record<string, unknown>;
      if (typeof row.text === "string" && row.text.length > 0) return row.text;
      const user = row.user && typeof row.user === "object" ? (row.user as Record<string, unknown>) : null;
      const username = typeof user?.username === "string" ? user.username.trim() : "";
      if (row.type === "tag") return username ? `@${username}` : "@user";
      return "";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : null;
}

function normalizeCommentAuthorName(raw: unknown): string | null {
  const user = raw && typeof raw === "object" ? (raw as ClickUpCommentUser) : null;
  const username = typeof user?.username === "string" ? user.username.trim() : "";
  return username.length > 0 ? username : null;
}

function normalizeCommentUserId(raw: unknown): number | null {
  const user = raw && typeof raw === "object" ? (raw as ClickUpCommentUser) : null;
  const value = user?.id;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeCommentDate(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.trunc(raw);
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function isConfiguredAgentComment(
  config: ClickUpAgentRefConfig,
  user: unknown,
): boolean {
  const commentUserId = normalizeCommentUserId(user);
  if (config.clickupAgentUserId) {
    return commentUserId === config.clickupAgentUserId;
  }

  const authorName = normalizeCommentAuthorName(user);
  return Boolean(
    authorName &&
    config.clickupAgentName &&
    authorName.localeCompare(config.clickupAgentName, undefined, { sensitivity: "accent" }) === 0,
  );
}

function toImportedComment(
  raw: unknown,
  config: ClickUpAgentRefConfig,
  isReply: boolean,
): ClickUpCommentEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asScalarString(record.id);
  const body = normalizeCommentText(record.comment_text) ?? renderCommentRichText(record.comment);
  const createdAt = normalizeCommentDate(record.date);
  if (!id || !body || createdAt == null) return null;
  if (!isConfiguredAgentComment(config, record.user)) return null;
  return {
    id,
    body,
    createdAt,
    authorName: normalizeCommentAuthorName(record.user),
    isReply,
  };
}

function formatImportedIssueComment(comment: ClickUpCommentEntry): string {
  const sourceLabel = comment.isReply ? "ClickUp reply" : "ClickUp comment";
  const authorLabel = comment.authorName ? ` from ${comment.authorName}` : "";
  const timestamp = new Date(comment.createdAt).toISOString();
  return `${sourceLabel}${authorLabel} at ${timestamp}:\n\n${comment.body}`;
}

async function fetchAgentRepliesForComment(
  config: ClickUpAgentRefConfig,
  headers: Record<string, string>,
  commentId: string,
): Promise<ClickUpCommentEntry[]> {
  const repliesResult = await requestJson(
    `${config.apiBaseUrl}/comment/${commentId}/reply`,
    {
      method: "GET",
      headers,
    },
    config.timeoutSec,
  );

  if (!repliesResult.response.ok) {
    throw new Error(
      `HTTP ${repliesResult.response.status}: ${repliesResult.response.statusText}${repliesResult.text ? ` — ${repliesResult.text.slice(0, 500)}` : ""}`,
    );
  }

  return parseClickUpCommentResponse(repliesResult.text).comments
    .map((reply) => toImportedComment(reply, config, true))
    .filter((reply): reply is ClickUpCommentEntry => reply !== null);
}

async function fetchNewAgentComments(
  ctx: AdapterExecutionContext,
  config: ClickUpAgentRefConfig,
  headers: Record<string, string>,
  taskId: string,
): Promise<{ importedComments: ClickUpCommentEntry[]; syncedCommentIds: string[] }> {
  const syncedIds = readStoredSyncedCommentIds(ctx);
  if (!config.clickupAgentName && !config.clickupAgentUserId) {
    return { importedComments: [], syncedCommentIds: Array.from(syncedIds) };
  }
  const taskCommentsResult = await requestJson(
    `${config.apiBaseUrl}/task/${taskId}/comment`,
    {
      method: "GET",
      headers,
    },
    config.timeoutSec,
  );

  if (!taskCommentsResult.response.ok) {
    throw new Error(
      `HTTP ${taskCommentsResult.response.status}: ${taskCommentsResult.response.statusText}${taskCommentsResult.text ? ` — ${taskCommentsResult.text.slice(0, 500)}` : ""}`,
    );
  }

  const rawComments = parseClickUpCommentResponse(taskCommentsResult.text).comments;

  const imported: ClickUpCommentEntry[] = [];
  for (const rawComment of rawComments) {
    const topLevel = toImportedComment(rawComment, config, false);
    if (topLevel && !syncedIds.has(topLevel.id)) {
      imported.push(topLevel);
      syncedIds.add(topLevel.id);
    }

    const record = rawComment && typeof rawComment === "object" ? (rawComment as Record<string, unknown>) : null;
    const commentId = asScalarString(record?.id) || null;
    const replyCount =
      typeof record?.reply_count === "number" && Number.isFinite(record.reply_count)
        ? record.reply_count
        : typeof record?.reply_count === "string" && record.reply_count.trim().length > 0
          ? Number.parseInt(record.reply_count.trim(), 10)
          : 0;
    if (!commentId || !replyCount || replyCount < 1) continue;

    const replies = await fetchAgentRepliesForComment(config, headers, commentId);
    for (const reply of replies) {
      if (syncedIds.has(reply.id)) continue;
      imported.push(reply);
      syncedIds.add(reply.id);
    }
  }

  imported.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return {
    importedComments: imported,
    syncedCommentIds: Array.from(syncedIds).slice(-500),
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  let config: ClickUpAgentRefConfig;
  try {
    config = resolveConfig(ctx);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `[clickup-agent-ref] ERROR: ${errorMessage}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage,
      errorCode: "CONFIG_ERROR",
    };
  }

  const title = buildTitle(ctx);
  const body = buildBody(ctx, config);
  const existingTaskId = readStoredTaskId(ctx);
  const headers = buildHeaders(config);

  await ctx.onMeta?.({
    adapterType: "clickup_agent_ref",
    command: existingTaskId
      ? `POST ${config.apiBaseUrl}/task/${existingTaskId}/comment`
      : `POST ${config.apiBaseUrl}/list/${config.listId}/task`,
    prompt: body,
    context: ctx.context,
  });

  try {
    if (!existingTaskId) {
      await ctx.onLog("stdout", `[clickup-agent-ref] create task in list=${config.listId}\n`);
      const createResult = await requestJson(
        `${config.apiBaseUrl}/list/${config.listId}/task`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: title,
            notify_all: false,
            ...(config.clickupAgentUserId ? { assignees: [config.clickupAgentUserId] } : {}),
            ...buildTaskFields(body, config),
          }),
        },
        config.timeoutSec,
      );

      if (!createResult.response.ok) {
        const errorMessage = `HTTP ${createResult.response.status}: ${createResult.response.statusText}${createResult.text ? ` — ${createResult.text.slice(0, 500)}` : ""}`;
        await ctx.onLog("stderr", `[clickup-agent-ref] ERROR: ${errorMessage}\n`);
        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage,
          errorCode: `HTTP_${createResult.response.status}`,
        };
      }

      let task: ReturnType<typeof parseClickUpTaskResponse>;
      try {
        task = parseClickUpTaskResponse(createResult.text);
      } catch (parseErr) {
        const parseMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const errorMessage = `Task created but response parse failed (task may be orphaned): ${parseMsg}`;
        await ctx.onLog("stderr", `[clickup-agent-ref] ERROR: ${errorMessage}\n`);
        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage,
          errorCode: "PARSE_ERROR",
        };
      }

      const taskId = task.taskId;
      const taskUrl = task.taskUrl ?? config.clickupAgentUrl ?? null;
      const summary = taskId
        ? `Created ClickUp task ${taskId}${config.clickupAgentName ? ` for ${config.clickupAgentName}` : ""}.`
        : `Created ClickUp task${config.clickupAgentName ? ` for ${config.clickupAgentName}` : ""}.`;
      await ctx.onLog("stdout", `${summary}\n`);
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        summary,
        provider: "clickup",
        biller: "clickup",
        billingType: "fixed",
        sessionParams: taskId
          ? {
              clickupTaskId: taskId,
              clickupTaskUrl: taskUrl,
              workspaceId: config.workspaceId,
            }
          : ctx.runtime.sessionParams,
        sessionDisplayId: taskId,
        resultJson: taskId ? { clickupTaskId: taskId, clickupTaskUrl: taskUrl } : null,
      };
    }

    let commentSync: { importedComments: ClickUpCommentEntry[]; syncedCommentIds: string[] } = {
      importedComments: [],
      syncedCommentIds: Array.from(readStoredSyncedCommentIds(ctx)),
    };
    try {
      commentSync = await fetchNewAgentComments(ctx, config, headers, existingTaskId);
    } catch (err) {
      const syncErrorMessage = err instanceof Error ? err.message : String(err);
      await ctx.onLog("stderr", `[clickup-agent-ref] WARN: failed to sync inbound ClickUp comments: ${syncErrorMessage}\n`);
    }
    await ctx.onLog("stdout", `[clickup-agent-ref] append comment to task=${existingTaskId}\n`);
    const commentResult = await requestJson(
      `${config.apiBaseUrl}/task/${existingTaskId}/comment`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(buildCommentPayload(body, config)),
      },
      config.timeoutSec,
    );

    if (!commentResult.response.ok) {
      const errorMessage = `HTTP ${commentResult.response.status}: ${commentResult.response.statusText}${commentResult.text ? ` — ${commentResult.text.slice(0, 500)}` : ""}`;
      await ctx.onLog("stderr", `[clickup-agent-ref] ERROR: ${errorMessage}\n`);
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage,
        errorCode: `HTTP_${commentResult.response.status}`,
      };
    }

    let summary = `Updated ClickUp task ${existingTaskId}${config.clickupAgentName ? ` for ${config.clickupAgentName}` : ""}.`;
    try {
      await syncTaskDetails(ctx, config, headers, existingTaskId, body);
    } catch (err) {
      const syncErrorMessage = err instanceof Error ? err.message : String(err);
      await ctx.onLog("stderr", `[clickup-agent-ref] WARN: failed to sync task details: ${syncErrorMessage}\n`);
      summary += " Task detail sync failed; comment still posted.";
    }
    await ctx.onLog("stdout", `${summary}\n`);
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary,
      provider: "clickup",
      biller: "clickup",
      billingType: "fixed",
      sessionParams: {
        ...(ctx.runtime.sessionParams ?? {}),
        clickupTaskId: existingTaskId,
        workspaceId: config.workspaceId,
        syncedClickupCommentIds: commentSync.syncedCommentIds,
      },
      sessionDisplayId: existingTaskId,
      resultJson: {
        clickupTaskId: existingTaskId,
        importedIssueComments: commentSync.importedComments.map((comment) => ({
          externalId: comment.id,
          source: "clickup",
          body: formatImportedIssueComment(comment),
          authorName: comment.authorName,
          createdAt: new Date(comment.createdAt).toISOString(),
          isReply: comment.isReply,
        })),
      },
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const errorMessage = isTimeout
      ? `Request timed out after ${config.timeoutSec}s`
      : `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`;
    await ctx.onLog("stderr", `[clickup-agent-ref] ERROR: ${errorMessage}\n`);
    return {
      exitCode: 1,
      signal: null,
      timedOut: isTimeout,
      errorMessage,
      errorCode: isTimeout ? "TIMEOUT" : "HTTP_ERROR",
    };
  }
}
