import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY,
  WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION,
  validateWorkflowTrigger,
} from "./workflow-trigger.js";

function buildTrigger(overrides: Partial<{
  companyId: string;
  sourceHeartbeatRunId: string;
  contractKey: string;
  contractVersion: string;
  payload: Record<string, unknown>;
}> = {}) {
  return {
    companyId: overrides.companyId ?? "11111111-1111-4111-8111-111111111111",
    sourceHeartbeatRunId: overrides.sourceHeartbeatRunId ?? "22222222-2222-4222-8222-222222222222",
    contractKey: overrides.contractKey ?? WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY,
    contractVersion: overrides.contractVersion ?? WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION,
    generatedAt: "2026-06-24T00:00:00.000Z",
    payload: overrides.payload ?? {
      generatedAt: "2026-06-24T00:00:00.000Z",
      evidenceWindow: {
        startAt: "2026-06-17T00:00:00.000Z",
        endAt: "2026-06-24T00:00:00.000Z",
      },
      summaryMarkdown: "Weekly retro summary",
      sections: [
        {
          key: "wins",
          title: "Wins",
          summaryMarkdown: "What went well.",
          evidenceRefs: ["doc-1"],
        },
      ],
      evidence: [
        {
          key: "doc-1",
          title: "Evidence one",
          url: "https://example.com/evidence",
          note: "Curated from source material.",
        },
      ],
    },
  };
}

describe("workflow trigger validation", () => {
  it("accepts a valid weekly retro trigger", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger(),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.workflowTrigger.contractKey).toBe(WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY);
    expect(result.workflowTrigger.contractVersion).toBe(WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION);
    expect(result.workflowTrigger.payload.summaryMarkdown).toBe("Weekly retro summary");
  });

  it("rejects an invalid weekly retro payload", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({
        payload: {
          generatedAt: "2026-06-24T00:00:00.000Z",
          evidenceWindow: {
            startAt: "2026-06-17T00:00:00.000Z",
            endAt: "2026-06-24T00:00:00.000Z",
          },
        },
      }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("invalid_payload");
  });

  it("rejects a contract-version mismatch", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({ contractVersion: "2" }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("unknown_contract");
  });

  it("rejects a company mismatch", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger({ companyId: "33333333-3333-4333-8333-333333333333" }),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("company_mismatch");
  });

  it("rejects payloads that exceed the size limit", () => {
    const result = validateWorkflowTrigger({
      workflowTrigger: buildTrigger(),
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceHeartbeatRunId: "22222222-2222-4222-8222-222222222222",
      maxBytes: 10,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe("size_limit");
  });
});
