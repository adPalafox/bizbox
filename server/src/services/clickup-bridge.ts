import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { buildClickUpContextBody } from "@paperclipai/adapter-clickup-agent-ref/server";
import { agents, clickupBridges, clickupOutboundEvents } from "@paperclipai/db";
import { parseObject } from "@paperclipai/adapter-utils/server-utils";
import { issueService } from "./issues.js";
import { agentThreadService } from "./agent-threads.js";
import { logActivity } from "./activity-log.js";

type BridgeSource = { sourceType: "issue" | "agent_thread"; sourceId: string; taskKey: string };
type TriggerMode = "api_comment_only" | "automation_trigger";

const MAX_OUTBOUND_ATTEMPTS = 5;
const MAX_POLL_FAILURES = 10;
const MAX_IMPORTED_IDS = 1000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asScalarString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function asNumber(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Number(n) : fallback;
}

export function resolveBridgeSource(context: Record<string, unknown>): BridgeSource {
  const wake = parseObject(context.paperclipWake);
  const wakeIssue = parseObject(wake.issue);
  const issueId = asString(wakeIssue.id);
  if (issueId) return { sourceType: "issue", sourceId: issueId, taskKey: `issue:${issueId}` };
  const agentThreadId = asString(context.agentThreadId);
  if (agentThreadId) return { sourceType: "agent_thread", sourceId: agentThreadId, taskKey: `agent-thread:${agentThreadId}` };
  throw new Error("clickup_agent_ref requires paperclipWake.issue.id or agentThreadId");
}

function resolveConfig(config: Record<string, unknown>): {
  listId: string;
  apiBaseUrl: string;
  authToken: string;
  bridgeBotUserId: string;
  clickupAgentName?: string;
  clickupAgentUrl?: string;
  includeContextJson: boolean;
  mode: TriggerMode;
  statusToTriggerAgent: string | null;
  timeoutSec: number;
} {
  const parsed = parseObject(config);
  const listId = asString(parsed.listId);
  const apiBaseUrl = asString(parsed.apiBaseUrl) || "https://api.clickup.com/api/v2";
  const authToken = asString(parsed.authToken);
  const bridgeBotUserId = asScalarString(parsed.bridgeBotUserId) || asScalarString(parsed.clickupAgentUserId);
  const clickupAgentName = asString(parsed.clickupAgentName) || undefined;
  const clickupAgentUrl = asString(parsed.clickupAgentUrl) || undefined;
  const includeContextJson = parsed.includeContextJson !== false;
  const mode: TriggerMode = asString(parsed.triggerMode) === "automation_trigger" ? "automation_trigger" : "api_comment_only";
  const statusToTriggerAgent = asString(parsed.statusToTriggerAgent) || asString(parsed.automationStatus) || null;
  const timeoutSec = Math.min(30, Math.max(10, asNumber(parsed.timeoutSec, 20)));
  if (!listId || !authToken || !bridgeBotUserId) {
    throw new Error("clickup_agent_ref requires listId, authToken, bridgeBotUserId (or clickupAgentUserId)");
  }
  return {
    listId,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    authToken,
    bridgeBotUserId,
    clickupAgentName,
    clickupAgentUrl,
    includeContextJson,
    mode,
    statusToTriggerAgent,
    timeoutSec,
  };
}

function nextPollAt(now = Date.now(), lastOutboundAt?: Date | null, lastImportedAt?: Date | null): Date {
  const activityAt = Math.max(lastOutboundAt?.getTime() ?? 0, lastImportedAt?.getTime() ?? 0);
  const ageMs = activityAt > 0 ? now - activityAt : 0;
  if (ageMs <= 10 * 60_000) return new Date(now + 5_000);
  if (ageMs <= 60 * 60_000) return new Date(now + 15_000);
  return new Date(now + 60_000);
}

function appendImportedId(existing: unknown, id: string): string[] {
  const items = Array.isArray(existing) ? existing.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
  if (!items.includes(id)) items.push(id);
  return items.slice(-MAX_IMPORTED_IDS);
}

function extractCommentIdFromCreateResponse(rawText: string): string | null {
  try {
    const json = parseObject(JSON.parse(rawText));
    const id = asScalarString(json.id);
    return id || null;
  } catch {
    return null;
  }
}

function nextRetryAt(attempt: number, now = Date.now()): Date {
  const seq = [5, 10, 20, 40, 80];
  const sec = seq[Math.min(Math.max(attempt - 1, 0), seq.length - 1)] ?? 80;
  return new Date(now + sec * 1000);
}

function buildTaskName(context: Record<string, unknown>, taskKey: string): string {
  const issue = parseObject(context.issue);
  const wake = parseObject(context.paperclipWake);
  const wakeIssue = parseObject(wake.issue);
  const title =
    asString(issue.title)
    || asString(wakeIssue.title)
    || asString(context.issueTitle);
  const identifier =
    asString(issue.identifier)
    || asString(wakeIssue.identifier);
  if (title && identifier) return `${identifier} - ${title}`;
  return title || identifier || taskKey;
}

export function isUserCommentForImport(raw: unknown, bridgeBotUserId: string): { id: string; text: string; createdAt: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = asScalarString(row.id);
  const text = asString(row.comment_text);
  const author = row.user && typeof row.user === "object" ? (row.user as Record<string, unknown>) : null;
  const authorId = author ? asScalarString(author.id) : "";
  const isSystem = typeof row.comment === "object" && row.comment !== null && !Array.isArray(row.comment);
  const createdAt = Number(asScalarString(row.date) || 0);
  if (!id || !text || !authorId) return null;
  if (authorId === bridgeBotUserId) return null;
  if (isSystem) return null;
  return { id, text, createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now() };
}

async function clickupRequest(url: string, init: RequestInit, timeoutSec: number): Promise<{ ok: boolean; status: number; text: string }> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), timeoutSec * 1000);
  try {
    const res = await fetch(url, { ...init, signal: c.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

export function clickupBridgeService(db: Db) {
  const issuesSvc = issueService(db);
  const agentThreadsSvc = agentThreadService(db);

  return {
    async closeActiveBridges(reason: string, companyId?: string) {
      const filters = [
        or(eq(clickupBridges.status, "waiting_for_agent_reply"), eq(clickupBridges.status, "agent_replied")),
        ...(companyId ? [eq(clickupBridges.companyId, companyId)] : []),
      ];
      return db
        .update(clickupBridges)
        .set({
          status: "closed",
          nextPollAt: null,
          lastError: reason,
          updatedAt: new Date(),
        })
        .where(and(...filters))
        .returning({ id: clickupBridges.id });
    },

    async enqueueFromWake(input: { companyId: string; agentId: string; context: Record<string, unknown>; config: Record<string, unknown> }) {
      const source = resolveBridgeSource(input.context);
      const cfg = resolveConfig(input.config);
      const taskName = buildTaskName(input.context, source.taskKey);
      const body = buildClickUpContextBody(input.context, {
        clickupAgentName: cfg.clickupAgentName,
        clickupAgentUrl: cfg.clickupAgentUrl,
        includeContextJson: cfg.includeContextJson,
      });
      const now = new Date();
      const [upsertedBridge] = await db
        .insert(clickupBridges)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          taskKey: source.taskKey,
          clickupListId: cfg.listId,
          mode: cfg.mode,
          status: "pending_clickup_task",
          nextPollAt: now,
        })
        .onConflictDoUpdate({
          target: [clickupBridges.companyId, clickupBridges.sourceType, clickupBridges.sourceId, clickupBridges.clickupListId],
          set: { updatedAt: now, lastError: null },
        })
        .returning();

      let bridge = upsertedBridge!;

      if (bridge.status === "failed") {
        throw new Error("clickup bridge failed; manual retry required");
      }

      if (bridge.status === "closed") {
        const [reopened] = await db
          .update(clickupBridges)
          .set({
            status: bridge.clickupTaskId ? "agent_replied" : "pending_clickup_task",
            nextPollAt: bridge.clickupTaskId ? null : now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(clickupBridges.id, bridge.id))
          .returning();
        bridge = reopened ?? bridge;
      }

      const eventKind = bridge.clickupTaskId ? "append_comment" : "create_task";
      if (eventKind === "create_task") {
        const existingCreateEvent = await db
          .select({ id: clickupOutboundEvents.id })
          .from(clickupOutboundEvents)
          .where(
            and(
              eq(clickupOutboundEvents.bridgeId, bridge.id),
              eq(clickupOutboundEvents.kind, "create_task"),
              or(eq(clickupOutboundEvents.status, "pending"), eq(clickupOutboundEvents.status, "processing")),
            ),
          )
          .limit(1);
        if (existingCreateEvent.length === 0) {
          await db.insert(clickupOutboundEvents).values({
            bridgeId: bridge.id,
            kind: eventKind,
            status: "pending",
            payload: {
              body,
              taskName,
            },
          });
        }
      } else {
        await db.insert(clickupOutboundEvents).values({
          bridgeId: bridge.id,
          kind: eventKind,
          status: "pending",
          payload: {
            body,
            taskName,
          },
        });
      }

      return { bridgeId: bridge.id, clickupTaskId: bridge.clickupTaskId ?? null };
    },

    async processOutbound(limit = 20) {
      const now = new Date();
      const events = await db
        .select()
        .from(clickupOutboundEvents)
        .where(
          and(
            or(eq(clickupOutboundEvents.status, "pending"), eq(clickupOutboundEvents.status, "failed")),
            lt(clickupOutboundEvents.attempts, MAX_OUTBOUND_ATTEMPTS),
            or(isNull(clickupOutboundEvents.nextAttemptAt), lte(clickupOutboundEvents.nextAttemptAt, now)),
          ),
        )
        .limit(limit);

      for (const event of events) {
        if (event.attempts >= MAX_OUTBOUND_ATTEMPTS) continue;
        await db.update(clickupOutboundEvents).set({ status: "processing", updatedAt: new Date() }).where(eq(clickupOutboundEvents.id, event.id));

        const [bridge] = await db.select().from(clickupBridges).where(eq(clickupBridges.id, event.bridgeId));
        if (!bridge || bridge.status === "failed" || bridge.status === "closed") continue;

        const [agent] = await db.select().from(agents).where(eq(agents.id, bridge.agentId));
        const cfg = resolveConfig(parseObject(agent?.adapterConfig));
        const headers = { "Content-Type": "application/json", Authorization: cfg.authToken };
        const payload = parseObject(event.payload);
        const body = asString(payload.body);
        const taskName = asString(payload.taskName) || bridge.taskKey;

        try {
          if (!bridge.clickupTaskId) {
            const res = await clickupRequest(
              `${cfg.apiBaseUrl}/list/${cfg.listId}/task`,
              { method: "POST", headers, body: JSON.stringify({ name: taskName, description: body, notify_all: false }) },
              cfg.timeoutSec,
            );
            if (!res.ok) throw new Error(`clickup create task failed: ${res.status}`);
            const json = parseObject(JSON.parse(res.text));
            const taskId = asString(json.id);
            if (!taskId) throw new Error("clickup create task missing id");

            const firstComment = await clickupRequest(
              `${cfg.apiBaseUrl}/task/${taskId}/comment`,
              { method: "POST", headers, body: JSON.stringify({ comment_text: body, notify_all: false }) },
              cfg.timeoutSec,
            );
            if (!firstComment.ok) throw new Error(`clickup first comment failed: ${firstComment.status}`);
            const firstCommentId = extractCommentIdFromCreateResponse(firstComment.text);

            await db.update(clickupBridges).set({
              clickupTaskId: taskId,
              clickupTaskUrl: asString(json.url) || null,
              status: "waiting_for_agent_reply",
              importedCommentIds: firstCommentId ? appendImportedId(bridge.importedCommentIds, firstCommentId) : bridge.importedCommentIds,
              lastOutboundAt: new Date(),
              nextPollAt: new Date(Date.now() + 2_000),
              lastError: null,
              updatedAt: new Date(),
            }).where(eq(clickupBridges.id, bridge.id));
          } else {
            const post = await clickupRequest(
              `${cfg.apiBaseUrl}/task/${bridge.clickupTaskId}/comment`,
              { method: "POST", headers, body: JSON.stringify({ comment_text: body, notify_all: false }) },
              cfg.timeoutSec,
            );
            if (!post.ok) throw new Error(`clickup append comment failed: ${post.status}`);
            const postedCommentId = extractCommentIdFromCreateResponse(post.text);
            if (bridge.mode === "automation_trigger" && cfg.statusToTriggerAgent) {
              await clickupRequest(
                `${cfg.apiBaseUrl}/task/${bridge.clickupTaskId}`,
                { method: "PUT", headers, body: JSON.stringify({ status: cfg.statusToTriggerAgent }) },
                cfg.timeoutSec,
              );
            }
            await db.update(clickupBridges).set({
              status: "waiting_for_agent_reply",
              importedCommentIds: postedCommentId ? appendImportedId(bridge.importedCommentIds, postedCommentId) : bridge.importedCommentIds,
              lastOutboundAt: new Date(),
              nextPollAt: new Date(Date.now() + 2_000),
              lastError: null,
              updatedAt: new Date(),
            }).where(eq(clickupBridges.id, bridge.id));
          }

          await db.update(clickupOutboundEvents).set({
            status: "succeeded",
            attempts: event.attempts + 1,
            lastError: null,
            updatedAt: new Date(),
          }).where(eq(clickupOutboundEvents.id, event.id));
        } catch (err) {
          const attempts = event.attempts + 1;
          const msg = err instanceof Error ? err.message : String(err);
          const terminal = attempts >= MAX_OUTBOUND_ATTEMPTS;
          await db.update(clickupOutboundEvents).set({
            status: terminal ? "failed" : "pending",
            attempts,
            lastError: msg,
            nextAttemptAt: terminal ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : nextRetryAt(attempts),
            updatedAt: new Date(),
          }).where(eq(clickupOutboundEvents.id, event.id));
          await db.update(clickupBridges).set({
            status: terminal ? "failed" : bridge.status,
            lastError: msg,
            updatedAt: new Date(),
          }).where(eq(clickupBridges.id, bridge.id));
        }
      }
    },

    async pollInbound(limit = 50) {
      const now = new Date();
      const bridges = await db
        .select()
        .from(clickupBridges)
        .where(
          and(
            eq(clickupBridges.status, "waiting_for_agent_reply"),
            or(isNull(clickupBridges.nextPollAt), lte(clickupBridges.nextPollAt, now)),
          ),
        )
        .limit(limit);

      for (const bridge of bridges) {
        if (!bridge.clickupTaskId) continue;
        const [agent] = await db.select().from(agents).where(eq(agents.id, bridge.agentId));
        const cfg = resolveConfig(parseObject(agent?.adapterConfig));
        const claimUntil = new Date(Date.now() + Math.max(cfg.timeoutSec, 10) * 1000);
        const [claimedBridge] = await db
          .update(clickupBridges)
          .set({
            nextPollAt: claimUntil,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(clickupBridges.id, bridge.id),
              eq(clickupBridges.status, "waiting_for_agent_reply"),
              or(isNull(clickupBridges.nextPollAt), lte(clickupBridges.nextPollAt, now)),
            ),
          )
          .returning({ id: clickupBridges.id });
        if (!claimedBridge) continue;
        const headers = { "Content-Type": "application/json", Authorization: cfg.authToken };

        try {
          const res = await clickupRequest(`${cfg.apiBaseUrl}/task/${bridge.clickupTaskId}/comment`, { method: "GET", headers }, cfg.timeoutSec);
          if (!res.ok) throw new Error(`clickup poll failed: ${res.status}`);

          const payload = parseObject(JSON.parse(res.text));
          const comments = Array.isArray(payload.comments) ? payload.comments : [];
          const imported = new Set(Array.isArray(bridge.importedCommentIds) ? bridge.importedCommentIds : []);

          const replyRows: unknown[] = [];
          for (const top of comments) {
            const topRecord = top && typeof top === "object" ? (top as Record<string, unknown>) : null;
            const topId = asString(topRecord?.id);
            if (!topId) continue;
            const replyRes = await clickupRequest(`${cfg.apiBaseUrl}/comment/${topId}/reply`, { method: "GET", headers }, cfg.timeoutSec);
            if (!replyRes.ok) continue;
            const replyPayload = parseObject(JSON.parse(replyRes.text));
            const rows = Array.isArray(replyPayload.comments)
              ? replyPayload.comments
              : Array.isArray(replyPayload.replies)
                ? replyPayload.replies
                : [];
            replyRows.push(...rows);
          }

          const candidatesById = new Map<string, { id: string; text: string; createdAt: number }>();
          for (const item of [...comments, ...replyRows]
            .map((c) => isUserCommentForImport(c, cfg.bridgeBotUserId))
            .filter((c): c is { id: string; text: string; createdAt: number } => c !== null)
            .filter((c) => !imported.has(c.id))) {
            const existing = candidatesById.get(item.id);
            if (!existing || item.createdAt < existing.createdAt) {
              candidatesById.set(item.id, item);
            }
          }
          const candidates = [...candidatesById.values()]
            .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

          for (const item of candidates) {
            if (bridge.sourceType === "issue") {
              const comment = await issuesSvc.addComment(bridge.sourceId, item.text, { agentId: bridge.agentId });
              const issue = await issuesSvc.getById(bridge.sourceId);
              if (issue) {
                await logActivity(db, {
                  companyId: bridge.companyId,
                  actorType: "agent",
                  actorId: bridge.agentId,
                  agentId: bridge.agentId,
                  action: "issue.comment_added",
                  entityType: "issue",
                  entityId: bridge.sourceId,
                  details: {
                    commentId: comment.id,
                    bodySnippet: comment.body.slice(0, 120),
                    identifier: issue.identifier,
                    issueTitle: issue.title,
                    source: "clickup_bridge",
                    clickupCommentId: item.id,
                    clickupTaskId: bridge.clickupTaskId,
                  },
                });
              }
            } else {
              await agentThreadsSvc.postAssistantMessage({
                companyId: bridge.companyId,
                threadId: bridge.sourceId,
                authorAgentId: bridge.agentId,
                body: item.text,
              });
            }
            imported.add(item.id);
          }

          await db.update(clickupBridges).set({
            importedCommentIds: Array.from(imported).slice(-MAX_IMPORTED_IDS),
            lastImportedCommentId: candidates[candidates.length - 1]?.id ?? bridge.lastImportedCommentId,
            lastPolledAt: new Date(),
            nextPollAt: candidates.length > 0 ? null : nextPollAt(Date.now(), bridge.lastOutboundAt, bridge.lastPolledAt),
            consecutivePollFailures: 0,
            status: candidates.length > 0 ? "agent_replied" : bridge.status,
            lastError: null,
            updatedAt: new Date(),
          }).where(eq(clickupBridges.id, bridge.id));
        } catch (err) {
          const failures = (bridge.consecutivePollFailures ?? 0) + 1;
          await db.update(clickupBridges).set({
            consecutivePollFailures: failures,
            status: failures >= MAX_POLL_FAILURES ? "failed" : bridge.status,
            lastError: err instanceof Error ? err.message : String(err),
            lastPolledAt: new Date(),
            nextPollAt: nextRetryAt(Math.min(failures, 5)),
            updatedAt: new Date(),
          }).where(eq(clickupBridges.id, bridge.id));
        }
      }
    },

    async retryBridge(bridgeId: string) {
      const [bridge] = await db.select().from(clickupBridges).where(eq(clickupBridges.id, bridgeId));
      if (!bridge) return null;
      const status = bridge.clickupTaskId ? "waiting_for_agent_reply" : "pending_clickup_task";
      await db.update(clickupBridges).set({
        status,
        lastError: null,
        consecutivePollFailures: 0,
        nextPollAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(clickupBridges.id, bridgeId));
      return { id: bridgeId, status };
    },
  };
}
