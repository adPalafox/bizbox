export const type = "openai_agent";
export const label = "OpenAI Agent";

export const DEFAULT_OPENAI_MODEL = "gpt-5";

export const models: { id: string; label: string }[] = [
  { id: "gpt-5", label: "GPT-5" },
  { id: "gpt-5-mini", label: "GPT-5 Mini" },
  { id: "gpt-4.1", label: "GPT-4.1" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
];

export const agentConfigurationDoc = `# openai_agent adapter configuration

Adapter: openai_agent

Use when:
- You want Bizbox to execute work through OpenAI's API directly.
- You want a normal Bizbox agent record whose heartbeat runs through the OpenAI Responses API.
- You may want to keep a human reference link back to ChatGPT Agent Studio, but execution still happens through the API.

Don't use when:
- You need local CLI execution with local files and shell tools (use codex_local, claude_local, cursor, or opencode_local).
- You want to reference a ClickUp-side agent without direct API execution (use clickup_agent_ref).

Core fields:
- authToken (string, required at runtime): OpenAI API key. You can also persist authTokenRef as a Bizbox secret reference.
- model (string, optional): OpenAI model id. Default: ${DEFAULT_OPENAI_MODEL}

Optional fields:
- apiBaseUrl (string, optional): override the OpenAI-compatible API base. Default: https://api.openai.com/v1
- promptTemplate (string, optional): Bizbox heartbeat prompt template. Defaults to the shared Bizbox execution contract prompt.
- reasoningEffort (string, optional): low, medium, or high for reasoning-capable models
- workflowInstruction (string, optional): stable system instruction prepended to each run
- studioUrl (string, optional): human reference link to a related ChatGPT Agent Studio page
- storeResponses (boolean, optional): when true, include \`store: true\` in Responses API requests. Default: true
- includeContextJson (boolean, optional): append structured Bizbox context JSON to the prompt. Default: true
- timeoutSec (number, optional): request timeout in seconds. Default: 600

Session behavior:
- The adapter stores the previous response id when available and passes it back as previous_response_id on later runs.
- Bizbox only reuses a stored previous response id when the prompt/instruction envelope still matches the saved session metadata.
- This keeps issue-scoped or agent-scoped OpenAI conversations resumable without requiring a local session store.

Security notes:
- Prefer authTokenRef over inline authToken in long-lived environments.
- Bizbox resolves authTokenRef at runtime using the company secret store.
`;
