export const WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_KEY = "weekly-retro-context" as const;
export const WORKFLOW_TRIGGER_WEEKLY_RETRO_CONTEXT_CONTRACT_VERSION = "1" as const;

export interface WeeklyRetroWorkflowTriggerEvidenceReference {
  key: string;
  title: string;
  url: string | null;
  note: string | null;
}

export interface WeeklyRetroWorkflowTriggerSection {
  key: string;
  title: string;
  summaryMarkdown: string;
  evidenceRefs: string[];
}

export interface WeeklyRetroWorkflowTriggerPayload {
  generatedAt: string;
  evidenceWindow: {
    startAt: string;
    endAt: string;
  };
  summaryMarkdown: string;
  sections: WeeklyRetroWorkflowTriggerSection[];
  evidence: WeeklyRetroWorkflowTriggerEvidenceReference[];
}

export interface WorkflowTriggerEnvelope {
  contractKey: string;
  contractVersion: string;
  companyId: string;
  sourceHeartbeatRunId: string;
  generatedAt: string;
  payload: unknown;
}

export interface WorkflowTriggerLineage {
  artifactId: string;
  sourceHeartbeatRunId: string;
  sourceAgentId: string;
  sourceHeartbeatRunStatus: string;
  targetWorkflowId: string | null;
  contractKey: string;
  contractVersion: string;
  payloadHash: string;
  payloadBytes: number;
  validationStatus: "passed" | "failed";
  validationError: string | null;
  triggerStatus: "not_triggered" | "triggering" | "triggered" | "failed";
  triggerError: string | null;
  triggeredWorkflowRunId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
