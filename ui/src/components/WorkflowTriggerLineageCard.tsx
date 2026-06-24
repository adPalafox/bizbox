import type { ReactNode } from "react";
import { CopyText } from "./CopyText";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { WorkflowTriggerLineage } from "@paperclipai/shared";

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const toneClassName = {
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    slate: "border-border/60 bg-background/40 text-muted-foreground",
  }[tone];

  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", toneClassName)}>
      {label}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground break-words">{children}</div>
    </div>
  );
}

export function WorkflowTriggerLineageCard({
  trigger,
  title = "Workflow trigger",
  className,
}: {
  trigger: WorkflowTriggerLineage;
  title?: string;
  className?: string;
}) {
  const validationTone =
    trigger.validationStatus === "passed"
      ? "emerald"
      : "rose";
  const triggerTone =
    trigger.triggerStatus === "triggered"
      ? "emerald"
      : trigger.triggerStatus === "triggering"
        ? "amber"
        : trigger.triggerStatus === "failed"
          ? "rose"
          : "slate";

  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">
            Artifact {trigger.artifactId.slice(0, 8)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={trigger.validationStatus} tone={validationTone} />
          <StatusPill label={trigger.triggerStatus.replaceAll("_", " ")} tone={triggerTone} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Artifact record">
          <CopyText text={trigger.artifactId} className="font-mono text-xs" />
        </Field>
        <Field label="Contract">
          <span className="font-mono text-xs">{trigger.contractKey}@{trigger.contractVersion}</span>
        </Field>
        <Field label="Source run">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/agents/${trigger.sourceAgentId}/runs/${trigger.sourceHeartbeatRunId}`} className="font-mono text-xs hover:underline">
              {trigger.sourceHeartbeatRunId.slice(0, 8)}
            </Link>
            <CopyText text={trigger.sourceHeartbeatRunId} className="text-xs text-muted-foreground" />
          </div>
        </Field>
        <Field label="Target workflow">
          {trigger.targetWorkflowId ? (
            <Link to={`/workflows/${trigger.targetWorkflowId}`} className="font-mono text-xs hover:underline">
              {trigger.targetWorkflowId.slice(0, 8)}
            </Link>
          ) : (
            <span className="text-muted-foreground">Not resolved</span>
          )}
        </Field>
        <Field label="Triggered run">
          {trigger.triggeredWorkflowRunId ? (
            <CopyText text={trigger.triggeredWorkflowRunId} className="font-mono text-xs" />
          ) : (
            <span className="text-muted-foreground">Not started</span>
          )}
        </Field>
        <Field label="Payload hash">
          <CopyText text={trigger.payloadHash} className="font-mono text-xs" />
        </Field>
        <Field label="Payload bytes">
          <span className="font-mono text-xs">{trigger.payloadBytes.toLocaleString()}</span>
        </Field>
      </div>

      {trigger.validationError ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
          {trigger.validationError}
        </div>
      ) : null}

      {trigger.triggerError ? (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
          {trigger.triggerError}
        </div>
      ) : null}
    </div>
  );
}
