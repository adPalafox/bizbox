import { afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "./execute.js";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { DEFAULT_BIZBOX_AGENT_PROMPT_TEMPLATE } from "@paperclipai/adapter-utils/server-utils";

function makeContext(
  config: Record<string, unknown>,
  overrides: Partial<AdapterExecutionContext> = {},
): AdapterExecutionContext {
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
    ...overrides,
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
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gpt-5", store: true });
    expect(body.input).toContain("Workflow instruction:\nBe precise.");
    expect(body.input).toContain("Summarize the assigned work.");
    expect(body.input).toContain("Bizbox context JSON:");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("Completed the task.");
    expect(result.sessionParams).toEqual({
      previousResponseId: "resp_123",
      promptTemplate: DEFAULT_BIZBOX_AGENT_PROMPT_TEMPLATE,
      workflowInstruction: "Be precise.",
      model: "gpt-5",
      apiBaseUrl: "https://api.openai.com/v1",
      includeContextJson: true,
    });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34, cachedInputTokens: undefined });
  });

  it("uses a custom prompt template with template variables", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "resp_789", output_text: "Done." }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await execute(
      makeContext({
        authToken: "sk-test",
        model: "gpt-5",
        promptTemplate: "Issue {{context.issueId}} assigned to {{agent.name}}.",
      }),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.input).toContain("Issue issue-123 assigned to OpenAI Agent.");
  });

  it("omits raw context json when includeContextJson is disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "resp_999", output_text: "Done." }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await execute(
      makeContext({ authToken: "sk-test", model: "gpt-5", includeContextJson: false }),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.input).not.toContain("Bizbox context JSON:");
  });

  it("does not resume a saved session when the prompt template changed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "resp_234", output_text: "Completed the task." }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await execute(makeContext(
      {
        authToken: "sk-test",
        model: "gpt-5",
        promptTemplate: "new template",
      },
      {
        runtime: {
          sessionId: null,
          sessionParams: {
            previousResponseId: "resp_old",
            promptTemplate: "old template",
            workflowInstruction: "",
            model: "gpt-5",
            apiBaseUrl: "https://api.openai.com/v1",
            includeContextJson: true,
          },
          sessionDisplayId: null,
          taskKey: "issue:123",
        },
      },
    ));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).not.toHaveProperty("previous_response_id");
  });

  it("does not resume a saved session when the workflow instruction changed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "resp_235", output_text: "Completed the task." }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await execute(makeContext(
      {
        authToken: "sk-test",
        model: "gpt-5",
        workflowInstruction: "new instruction",
      },
      {
        runtime: {
          sessionId: null,
          sessionParams: {
            previousResponseId: "resp_old",
            promptTemplate: DEFAULT_BIZBOX_AGENT_PROMPT_TEMPLATE,
            workflowInstruction: "old instruction",
            model: "gpt-5",
            apiBaseUrl: "https://api.openai.com/v1",
            includeContextJson: true,
          },
          sessionDisplayId: null,
          taskKey: "issue:123",
        },
      },
    ));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).not.toHaveProperty("previous_response_id");
  });

  it("resumes a compatible saved session with previous_response_id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "resp_236", output_text: "Completed the task." }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await execute(makeContext(
      {
        authToken: "sk-test",
        model: "gpt-5",
      },
      {
        runtime: {
          sessionId: null,
          sessionParams: {
            previousResponseId: "resp_old",
            promptTemplate: DEFAULT_BIZBOX_AGENT_PROMPT_TEMPLATE,
            workflowInstruction: "",
            model: "gpt-5",
            apiBaseUrl: "https://api.openai.com/v1",
            includeContextJson: true,
          },
          sessionDisplayId: null,
          taskKey: "issue:123",
        },
      },
    ));

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ previous_response_id: "resp_old" });
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

  it("clears the stored session when stale-session retry still returns a non-ok response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "The previous_response_id 'resp_old' was not found.",
            },
          }),
          { status: 404, statusText: "Not Found", headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "upstream still failed",
            },
          }),
          { status: 502, statusText: "Bad Gateway", headers: { "Content-Type": "application/json" } },
        ),
      );

    const result = await execute({
      ...makeContext({ authToken: "sk-test", model: "gpt-5" }),
      runtime: {
        sessionId: null,
        sessionParams: {
          previousResponseId: "resp_old",
          promptTemplate: DEFAULT_BIZBOX_AGENT_PROMPT_TEMPLATE,
          workflowInstruction: "",
          model: "gpt-5",
          apiBaseUrl: "https://api.openai.com/v1",
          includeContextJson: true,
        },
        sessionDisplayId: null,
        taskKey: "issue:123",
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("HTTP_502");
    expect(result.clearSession).toBe(true);
  });
});
