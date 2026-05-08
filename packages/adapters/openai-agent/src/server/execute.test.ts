import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "./execute.js";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

function makeContext(config: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "OpenAI Agent",
      adapterType: "openai_agent",
      adapterConfig: config,
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: "issue:123",
    },
    config,
    context: {
      prompt: "Summarize the assigned work.",
      issueId: "issue-123",
    },
    onLog: async () => {},
    onMeta: async () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openai_agent execute", () => {
  it("returns a config error when authToken is missing", async () => {
    const result = await execute(makeContext({ model: "gpt-5" }));
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("CONFIG_ERROR");
  });

  it("posts to /responses and stores previous response id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_123",
          output_text: "Completed the task.",
          usage: { input_tokens: 12, output_tokens: 34 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await execute(
      makeContext({ authToken: "sk-test", model: "gpt-5", workflowInstruction: "Be precise." }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-5", store: true });
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("Completed the task.");
    expect(result.sessionParams).toEqual({ previousResponseId: "resp_123" });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34, cachedInputTokens: undefined });
  });

  it("omits store when storeResponses is disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_456",
          output_text: "Completed the task.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await execute(
      makeContext({ authToken: "sk-test", model: "gpt-5", storeResponses: false }),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "gpt-5" });
    expect(JSON.parse(String(init.body))).not.toHaveProperty("store");
    expect(result.exitCode).toBe(0);
  });
});
