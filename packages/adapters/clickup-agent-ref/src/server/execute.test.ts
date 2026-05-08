import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "./execute.js";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

function makeContext(
  config: Record<string, unknown>,
  sessionParams: Record<string, unknown> | null = null,
): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "ClickUp Agent",
      adapterType: "clickup_agent_ref",
      adapterConfig: config,
    },
    runtime: {
      sessionId: null,
      sessionParams,
      sessionDisplayId: null,
      taskKey: "issue:123",
    },
    config,
    context: {
      issue: { title: "Investigate customer bug" },
      prompt: "Summarize next steps for the external ClickUp workflow.",
    },
    onLog: async () => {},
    onMeta: async () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clickup_agent_ref execute", () => {
  it("creates a task on first run", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "task_123", url: "https://app.clickup.com/t/task_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await execute(
      makeContext({
        authToken: "token",
        workspaceId: "team_1",
        listId: "list_1",
        clickupAgentUserId: 123456,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.clickup.com/api/v2/list/list_1/task");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      assignees: [123456],
      name: "Investigate customer bug",
      description: expect.stringContaining("Summarize next steps for the external ClickUp workflow."),
    });
    expect(result.exitCode).toBe(0);
    expect(result.sessionParams).toEqual({
      clickupTaskId: "task_123",
      clickupTaskUrl: "https://app.clickup.com/t/task_123",
      workspaceId: "team_1",
    });
  });

  it("creates a task with automation status and tags when automation_trigger is enabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "task_123", url: "https://app.clickup.com/t/task_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await execute(
      makeContext({
        authToken: "token",
        workspaceId: "team_1",
        listId: "list_1",
        clickupAgentName: "Risk Witherspoon",
        triggerMode: "automation_trigger",
        automationStatus: "ai_intake",
        automationTags: ["bizbox", "trigger-risk-witherspoon"],
      }),
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      status: "ai_intake",
      tags: ["bizbox", "trigger-risk-witherspoon"],
    });
    expect(result.exitCode).toBe(0);
  });

  it("builds task title and description from nested paperclip wake context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "task_123", url: "https://app.clickup.com/t/task_123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await execute({
      ...makeContext({
        authToken: "token",
        workspaceId: "team_1",
        listId: "list_1",
        clickupAgentName: "Risk Witherspoon",
      }),
      context: {
        wakeReason: "issue_assigned",
        paperclipWake: {
          issue: {
            id: "issue-19",
            identifier: "CIT-19",
            title: "test clickup 2",
            status: "in_progress",
            priority: "medium",
          },
          comments: [],
        },
        paperclipContinuationSummary: {
          body: "Objective:\nProvide a risk lens for this work item.",
        },
      },
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload.name).toBe("CIT-19 - test clickup 2");
    expect(payload.description).toContain("Target ClickUp agent: Risk Witherspoon");
    expect(payload.description).toContain("Issue: CIT-19");
    expect(payload.description).toContain("Title: test clickup 2");
    expect(payload.description).toContain("Status: in_progress");
    expect(payload.description).toContain("Priority: medium");
    expect(payload.description).toContain("Wake reason: issue_assigned");
    expect(payload.description).toContain("Continuation summary:");
    expect(result.exitCode).toBe(0);
  });

  it("appends a comment when a ClickUp task is already linked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comment_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await execute(
      makeContext(
        { authToken: "token", workspaceId: "team_1", listId: "list_1" },
        { clickupTaskId: "task_123" },
      ),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.clickup.com/api/v2/task/task_123/comment");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.clickup.com/api/v2/task/task_123");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      description: expect.stringContaining("Investigate customer bug"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("Updated ClickUp task task_123");
  });

  it("prefixes plain-text comments with an @mention for ClickUp AI agents when no numeric user id is configured", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comment_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await execute(
      makeContext(
        {
          authToken: "token",
          workspaceId: "team_1",
          listId: "list_1",
          clickupAgentName: "Risk Witherspoon",
        },
        { clickupTaskId: "task_123" },
      ),
    );

    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload).toMatchObject({
      comment_text: expect.stringContaining("@Risk Witherspoon"),
      notify_all: false,
    });
    expect(result.exitCode).toBe(0);
  });

  it("tags the configured ClickUp user in task comments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comment_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await execute(
      makeContext(
        {
          authToken: "token",
          workspaceId: "team_1",
          listId: "list_1",
          clickupAgentName: "Risk Witherspoon",
          clickupAgentUserId: 123456,
        },
        { clickupTaskId: "task_123" },
      ),
    );

    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload.assignee).toBe(123456);
    expect(payload.notify_all).toBe(false);
    expect(payload.comment?.[0]).toEqual({ text: "Requesting review from Risk Witherspoon: " });
    expect(payload.comment?.[1]).toEqual({ type: "tag", user: { id: 123456 } });
    expect(result.exitCode).toBe(0);
  });

  it("updates the task with automation status and tags after commenting in automation_trigger mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ comments: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comment_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await execute(
      makeContext({
        authToken: "token",
        workspaceId: "team_1",
        listId: "list_1",
        clickupAgentName: "Risk Witherspoon",
        triggerMode: "automation_trigger",
        automationStatus: "ai_intake",
        automationTags: ["bizbox", "trigger-risk-witherspoon"],
      }, { clickupTaskId: "task_123" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.clickup.com/api/v2/task/task_123");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      status: "ai_intake",
      tags: ["bizbox", "trigger-risk-witherspoon"],
    });
    expect(result.exitCode).toBe(0);
  });

  it("imports new ClickUp agent replies into the run result and tracks them in session state", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          comments: [
            {
              id: "comment_parent",
              comment_text: "@Risk Witherspoon",
              user: { id: 300858277, username: "Dennis Leon" },
              date: "1777872282123",
              reply_count: 1,
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          comments: [
            {
              id: "reply_1",
              comment_text: "That API would leak secrets. Do not ship this.",
              user: { id: -16805283, username: "Risk Witherspoon" },
              date: "1777872300000",
            },
          ],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "comment_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "task_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const result = await execute(
      makeContext(
        {
          authToken: "token",
          workspaceId: "team_1",
          listId: "list_1",
          clickupAgentName: "Risk Witherspoon",
        },
        { clickupTaskId: "task_123", syncedClickupCommentIds: ["already_seen"] },
      ),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.clickup.com/api/v2/task/task_123/comment");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.clickup.com/api/v2/comment/comment_parent/reply");
    expect(result.resultJson).toMatchObject({
      clickupTaskId: "task_123",
      importedIssueComments: [
        {
          externalId: "reply_1",
          source: "clickup",
          authorName: "Risk Witherspoon",
          isReply: true,
          body: expect.stringContaining("That API would leak secrets. Do not ship this."),
        },
      ],
    });
    expect(result.sessionParams).toMatchObject({
      clickupTaskId: "task_123",
      syncedClickupCommentIds: expect.arrayContaining(["already_seen", "reply_1"]),
    });
  });
});
