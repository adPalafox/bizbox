import { describe, expect, it } from "vitest";
import { isOpenAiAgentUnknownSessionError, parseOpenAiAgentResponse } from "./parse.js";
import { sessionCodec } from "./index.js";

describe("openai_agent parse", () => {
  it("extracts response id, summary, and usage", () => {
    expect(
      parseOpenAiAgentResponse(
        JSON.stringify({
          id: "resp_123",
          output_text: "Completed the task.",
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            input_tokens_details: { cached_tokens: 5 },
          },
        }),
      ),
    ).toEqual({
      responseId: "resp_123",
      summary: "Completed the task.",
      usage: { inputTokens: 12, outputTokens: 34, cachedInputTokens: 5 },
      errorMessage: null,
    });
  });

  it("detects stale previous_response_id failures", () => {
    expect(
      isOpenAiAgentUnknownSessionError(
        JSON.stringify({
          error: {
            message: "The previous_response_id 'resp_old' was not found.",
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("openai_agent sessionCodec", () => {
  it("round-trips previousResponseId and session compatibility metadata", () => {
    const serialized = sessionCodec.serialize({
      previousResponseId: "resp_123",
      promptTemplate: "Hello {{context.issueId}}",
      workflowInstruction: "Be precise.",
      model: "gpt-5",
      apiBaseUrl: "https://api.openai.com/v1",
      includeContextJson: true,
    });
    expect(serialized).toEqual({
      previousResponseId: "resp_123",
      promptTemplate: "Hello {{context.issueId}}",
      workflowInstruction: "Be precise.",
      model: "gpt-5",
      apiBaseUrl: "https://api.openai.com/v1",
      includeContextJson: true,
    });
    expect(sessionCodec.deserialize(serialized)).toEqual({
      previousResponseId: "resp_123",
      promptTemplate: "Hello {{context.issueId}}",
      workflowInstruction: "Be precise.",
      model: "gpt-5",
      apiBaseUrl: "https://api.openai.com/v1",
      includeContextJson: true,
    });
    expect(sessionCodec.getDisplayId?.(serialized)).toBe("resp_123");
  });
});
