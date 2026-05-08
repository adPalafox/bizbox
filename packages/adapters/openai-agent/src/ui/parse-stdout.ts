import type { TranscriptEntry } from "@paperclipai/adapter-utils";

export function parseOpenAiAgentStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[openai-agent]")) {
    return [{ kind: "system", ts, text: trimmed.replace(/^\[openai-agent\]\s*/, "") }];
  }
  return [{ kind: "stdout", ts, text: line }];
}
