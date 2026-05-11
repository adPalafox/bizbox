import { describe, expect, it } from "vitest";
import { buildClickUpAgentRefConfig } from "./build-config.js";

describe("buildClickUpAgentRefConfig", () => {
  it("maps create values into ClickUp adapter config", () => {
    const config = buildClickUpAgentRefConfig({
      adapterType: "clickup_agent_ref",
      cwd: "",
      promptTemplate: "",
      model: "",
      thinkingEffort: "",
      chrome: false,
      dangerouslySkipPermissions: false,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "",
      args: "",
      extraArgs: "",
      envVars: "",
      envBindings: {},
      url: "",
      apiKey: "token",
      timeoutSec: 120,
      bootstrapPrompt: "",
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        workspaceId: "team_1",
        listId: "list_1",
        clickupAgentUserId: "123456",
        triggerMode: "automation_trigger",
        automationStatus: "ai_intake",
        automationTags: "bizbox, trigger-support-triage",
      },
    });

    expect(config).toMatchObject({
      authToken: "token",
      workspaceId: "team_1",
      listId: "list_1",
      clickupAgentUserId: "123456",
      triggerMode: "automation_trigger",
      automationStatus: "ai_intake",
      automationTags: ["bizbox", "trigger-support-triage"],
      includeContextJson: true,
    });
  });
});
