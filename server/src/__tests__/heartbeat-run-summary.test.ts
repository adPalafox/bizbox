import { describe, expect, it } from "vitest";
import {
  summarizeHeartbeatRunResultJson,
  buildHeartbeatRunIssueComment,
  extractHeartbeatRunImportedIssueComments,
  mergeHeartbeatRunResultJson,
} from "../services/heartbeat-run-summary.js";

describe("summarizeHeartbeatRunResultJson", () => {
  it("truncates text fields and preserves cost aliases", () => {
    const summary = summarizeHeartbeatRunResultJson({
      summary: "a".repeat(600),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
      stopReason: "timeout",
      effectiveTimeoutSec: 30,
      timeoutConfigured: true,
      timeoutFired: true,
      nested: { ignored: true },
    });

    expect(summary).toEqual({
      summary: "a".repeat(500),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
      stopReason: "timeout",
      effectiveTimeoutSec: 30,
      timeoutConfigured: true,
      timeoutFired: true,
    });
  });

  it("returns null for non-object and irrelevant payloads", () => {
    expect(summarizeHeartbeatRunResultJson(null)).toBeNull();
    expect(summarizeHeartbeatRunResultJson(["nope"] as unknown as Record<string, unknown>)).toBeNull();
    expect(summarizeHeartbeatRunResultJson({ nested: { only: "ignored" } })).toBeNull();
  });
});

describe("buildHeartbeatRunIssueComment", () => {
  it("uses the final summary text for issue comments on successful runs", () => {
    const comment = buildHeartbeatRunIssueComment({
      summary: "## Summary\n\n- fixed deploy config\n- posted issue update",
    });

    expect(comment).toContain("## Summary");
    expect(comment).toContain("- fixed deploy config");
    expect(comment).not.toContain("Run summary");
  });

  it("falls back to result or message when summary is missing", () => {
    expect(buildHeartbeatRunIssueComment({ result: "done" })).toBe("done");
    expect(buildHeartbeatRunIssueComment({ message: "completed" })).toBe("completed");
  });

  it("returns imported ClickUp replies when no summary text exists", () => {
    expect(
      buildHeartbeatRunIssueComment({
        importedIssueComments: [
          { body: "ClickUp reply from Risk Witherspoon:\n\nLooks risky." },
          { body: "Second imported reply." },
        ],
      }),
    ).toBe("ClickUp reply from Risk Witherspoon:\n\nLooks risky.\n\nSecond imported reply.");
  });

  it("appends imported ClickUp replies after the main summary", () => {
    expect(
      buildHeartbeatRunIssueComment({
        summary: "## Summary\n\nPosted update.",
        importedIssueComments: [{ body: "ClickUp reply from Risk Witherspoon:\n\nLooks risky." }],
      }),
    ).toBe("## Summary\n\nPosted update.\n\n---\n\nClickUp reply from Risk Witherspoon:\n\nLooks risky.");
  });

  it("returns null when there is no usable final text", () => {
    expect(buildHeartbeatRunIssueComment({ costUsd: 1.2 })).toBeNull();
  });
});

describe("mergeHeartbeatRunResultJson", () => {
  it("adds adapter summaries into stored result json for comment posting", () => {
    const merged = mergeHeartbeatRunResultJson(
      { stdout: "raw stdout", stderr: "" },
      "## Summary\n\n1. first thing\n2. second thing",
    );

    expect(merged).toEqual({
      stdout: "raw stdout",
      stderr: "",
      summary: "## Summary\n\n1. first thing\n2. second thing",
    });
    expect(buildHeartbeatRunIssueComment(merged)).toBe("## Summary\n\n1. first thing\n2. second thing");
  });

  it("creates a result payload when only a summary exists", () => {
    expect(mergeHeartbeatRunResultJson(null, "done")).toEqual({ summary: "done" });
  });

  it("does not overwrite an explicit summary already returned by the adapter", () => {
    expect(
      mergeHeartbeatRunResultJson(
        { summary: "adapter result", stdout: "raw stdout" },
        "fallback summary",
      ),
    ).toEqual({
      summary: "adapter result",
      stdout: "raw stdout",
    });
  });
});

describe("extractHeartbeatRunImportedIssueComments", () => {
  it("returns normalized imported issue comment bodies", () => {
    expect(
      extractHeartbeatRunImportedIssueComments({
        importedIssueComments: [
          { body: " ClickUp reply from Risk Witherspoon:\n\nLooks risky. " },
          { body: "" },
          { nope: true },
        ],
      }),
    ).toEqual(["ClickUp reply from Risk Witherspoon:\n\nLooks risky."]);
  });

  it("returns an empty list for missing or invalid payloads", () => {
    expect(extractHeartbeatRunImportedIssueComments(null)).toEqual([]);
    expect(extractHeartbeatRunImportedIssueComments({ importedIssueComments: "nope" })).toEqual([]);
  });
});
