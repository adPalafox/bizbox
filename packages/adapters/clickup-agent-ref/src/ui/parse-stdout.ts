import type { TranscriptEntry } from "@paperclipai/adapter-utils";

export function parseClickUpAgentRefStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[clickup-agent-ref]")) {
    return [{ kind: "system", ts, text: trimmed.replace(/^\[clickup-agent-ref\]\s*/, "") }];
  }
  return [{ kind: "stdout", ts, text: line }];
}
