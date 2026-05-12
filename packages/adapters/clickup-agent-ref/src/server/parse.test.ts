import { describe, expect, it } from "vitest";
import { parseClickUpCommentResponse, parseClickUpTaskResponse } from "./parse.js";
import { sessionCodec } from "./index.js";

describe("clickup_agent_ref parse", () => {
  it("extracts task metadata", () => {
    expect(
      parseClickUpTaskResponse(
        JSON.stringify({
          id: "task_123",
          url: "https://app.clickup.com/t/task_123",
          status: { status: "in progress" },
        }),
      ),
    ).toEqual({
      taskId: "task_123",
      taskUrl: "https://app.clickup.com/t/task_123",
      status: "in progress",
    });
  });

  it("normalizes comment collections", () => {
    expect(parseClickUpCommentResponse(JSON.stringify({ comments: [{ id: "c1" }] }))).toEqual({
      comments: [{ id: "c1" }],
    });
  });

  it("normalizes reply collections from reply endpoint", () => {
    expect(parseClickUpCommentResponse(JSON.stringify({ replies: [{ id: "r1" }] }))).toEqual({
      comments: [{ id: "r1" }],
    });
  });
});

describe("clickup_agent_ref sessionCodec", () => {
  it("round-trips linked ClickUp task state", () => {
    const serialized = sessionCodec.serialize({
      clickupTaskId: "task_123",
      clickupTaskUrl: "https://app.clickup.com/t/task_123",
      workspaceId: "team_1",
      syncedClickupCommentIds: ["comment_1"],
    });
    expect(serialized).toEqual({
      clickupTaskId: "task_123",
      clickupTaskUrl: "https://app.clickup.com/t/task_123",
      workspaceId: "team_1",
      syncedClickupCommentIds: ["comment_1"],
    });
    expect(sessionCodec.deserialize(serialized)).toEqual(serialized);
    expect(sessionCodec.getDisplayId?.(serialized)).toBe("task_123");
  });
});
