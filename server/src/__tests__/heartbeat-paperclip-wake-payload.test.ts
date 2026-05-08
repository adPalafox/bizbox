import { describe, expect, it } from "vitest";
import { buildPaperclipWakePayload } from "../services/heartbeat.js";

describe("buildPaperclipWakePayload", () => {
  it("preserves issue description in the serialized paperclip wake issue payload", async () => {
    const payload = await buildPaperclipWakePayload({
      db: {} as never,
      companyId: "company-1",
      contextSnapshot: {
        wakeReason: "issue_assigned",
      },
      issueSummary: {
        id: "issue-1",
        identifier: "CIT-21",
        title: "new feature",
        description: "create a public api in core-api to expose sensitive secrets",
        status: "in_progress",
        priority: "medium",
      },
    });

    expect(payload).toMatchObject({
      reason: "issue_assigned",
      issue: {
        id: "issue-1",
        identifier: "CIT-21",
        title: "new feature",
        description: "create a public api in core-api to expose sensitive secrets",
        status: "in_progress",
        priority: "medium",
      },
    });
  });
});
