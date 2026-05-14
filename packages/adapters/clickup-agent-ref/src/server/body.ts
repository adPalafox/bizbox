import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

export type ClickUpContextBodyConfig = {
  clickupAgentName?: string;
  clickupAgentUrl?: string;
  includeContextJson: boolean;
};

export function buildClickUpContextBody(
  rawContext: Record<string, unknown>,
  config: ClickUpContextBodyConfig,
): string {
  const context = parseObject(rawContext);
  const issue = parseObject(context.issue);
  const wake = parseObject(context.paperclipWake);
  const wakeIssue = parseObject(wake.issue);
  const continuationSummary = parseObject(context.paperclipContinuationSummary);
  const comments = Array.isArray(wake.comments) ? wake.comments : [];
  const segments: string[] = [];

  const identifier =
    asString(issue.identifier, "").trim()
    || asString(wakeIssue.identifier, "").trim();
  const title =
    asString(issue.title, "").trim()
    || asString(wakeIssue.title, "").trim()
    || asString(context.issueTitle, "").trim();
  const status =
    asString(issue.status, "").trim()
    || asString(wakeIssue.status, "").trim();
  const priority =
    asString(issue.priority, "").trim()
    || asString(wakeIssue.priority, "").trim();
  const description =
    asString(issue.description, "").trim()
    || asString(wakeIssue.description, "").trim();

  if (config.clickupAgentName) {
    segments.push(`Target ClickUp agent: ${config.clickupAgentName}`);
  }
  if (config.clickupAgentUrl) {
    segments.push(`ClickUp agent URL: ${config.clickupAgentUrl}`);
  }

  const issueLines = [
    identifier ? `Issue: ${identifier}` : null,
    title ? `Title: ${title}` : null,
    status ? `Status: ${status}` : null,
    priority ? `Priority: ${priority}` : null,
  ].filter((line): line is string => Boolean(line));
  if (issueLines.length > 0) {
    segments.push(issueLines.join("\n"));
  }
  if (description) {
    segments.push(`Issue description:\n${description}`);
  }

  const promptFields = [context.prompt, context.instructions, context.wakeText]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (promptFields.length > 0) {
    segments.push(promptFields.join("\n\n"));
  }

  const topLevelWakeReason = asString(context.wakeReason, "").trim();
  const nestedWakeReason = asString(wake.reason, "").trim();
  const effectiveWakeReason = topLevelWakeReason || nestedWakeReason;
  if (effectiveWakeReason) {
    segments.push(`Wake reason: ${effectiveWakeReason}`);
  }

  if (comments.length > 0) {
    const commentLines = comments
      .map((entry) => {
        const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
        const body = typeof record?.body === "string" ? record.body.trim() : "";
        if (!body) return null;
        return `- ${body}`;
      })
      .filter((line): line is string => Boolean(line));
    if (commentLines.length > 0) {
      segments.push(`Recent Bizbox comments:\n${commentLines.join("\n")}`);
    }
  }

  const continuationBody = asString(continuationSummary.body, "").trim();
  if (continuationBody) {
    segments.push(`Continuation summary:\n${continuationBody}`);
  }

  if (config.includeContextJson) {
    segments.push(`Bizbox context JSON:\n${JSON.stringify(context, null, 2)}`);
  }

  return segments.join("\n\n").trim() || "Work synchronized from Bizbox.";
}
