import { describe, expect, it } from "vitest";
import { testEnvironment } from "./test.js";

describe("clickup_agent_ref testEnvironment", () => {
  it("fails automation_trigger validation when agent name is missing", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "clickup_agent_ref",
      config: {
        authToken: "token",
        workspaceId: "team_1",
        listId: "list_1",
        triggerMode: "automation_trigger",
      },
    });

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "clickup_agent_ref_trigger_agent_missing", level: "error" }),
      ]),
    );
  });

  it("warns when automation_trigger has no explicit status or tags", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "clickup_agent_ref",
      config: {
        authToken: "token",
        workspaceId: "team_1",
        listId: "list_1",
        triggerMode: "automation_trigger",
        clickupAgentName: "Risk Witherspoon",
      },
    });

    expect(result.status).toBe("warn");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "clickup_agent_ref_automation_signal_absent", level: "warn" }),
      ]),
    );
  });
});
