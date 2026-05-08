import { describe, expect, it } from "vitest";
import { DEFAULT_OPENAI_MODEL } from "../index.js";
import { buildOpenAiAgentConfig } from "./build-config.js";

describe("buildOpenAiAgentConfig", () => {
  it("maps adapter schema values into adapter config", () => {
    const config = buildOpenAiAgentConfig({
      adapterType: "openai_agent",
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
      apiKey: "sk-test",
      timeoutSec: 600,
      bootstrapPrompt: "",
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
      adapterSchemaValues: {
        workflowInstruction: "Review the issue and respond.",
        reasoningEffort: "medium",
        storeResponses: false,
        includeContextJson: true,
      },
    });

    expect(config).toMatchObject({
      authToken: "sk-test",
      model: DEFAULT_OPENAI_MODEL,
      workflowInstruction: "Review the issue and respond.",
      reasoningEffort: "medium",
      storeResponses: false,
      includeContextJson: true,
    });
  });
});
