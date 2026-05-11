export const type = "clickup_agent_ref";
export const label = "ClickUp Agent Reference";

export const models: { id: string; label: string }[] = [];

export const agentConfigurationDoc = `# clickup_agent_ref adapter configuration

Adapter: clickup_agent_ref

Use when:
- You want a Bizbox agent record to represent a ClickUp-side agent or automation owner.
- You want Bizbox heartbeats to push work into ClickUp task surfaces rather than executing local code.
- You want a durable Bizbox-side reference to the external ClickUp agent, list, and workspace.

Don't use when:
- You expect Bizbox to directly invoke a public ClickUp AI agent execution API. ClickUp does not expose a stable public runtime API for that flow.
- You want direct LLM execution through OpenAI. Use openai_agent instead.

Core fields:
- authToken (string, required at runtime): ClickUp OAuth or personal access token. You can also persist authTokenRef as a Bizbox secret reference.
- workspaceId (string, required): ClickUp workspace id for operator clarity and environment validation.
- listId (string, required): ClickUp list id where Bizbox issues should be materialized as tasks.

Optional fields:
- clickupAgentUserId (number, optional): ClickUp user id to assign on task creation and @mention in task comments
- triggerMode (string, optional): api_comment_only (default) or automation_trigger.
- automationStatus (string, optional): task status to set so a ClickUp Automation can trigger the Super Agent.
- automationTags (array|string, optional): tags to set on the task so a ClickUp Automation can trigger the Super Agent.
- channelId (string, optional): stored for future chat routing; currently informational only
- timeoutSec (number, optional): request timeout in seconds. Default: 120
- includeContextJson (boolean, optional): append full Bizbox context JSON to the task description/comment. Default: true

Execution behavior:
- First run for a task creates a ClickUp task in the configured list.
- Later runs reuse the stored ClickUp task id from sessionParams and append a task comment.
- If triggerMode=automation_trigger, the adapter stays API-only and optionally applies automationStatus and automationTags so native ClickUp Automations can trigger the Super Agent.
- The adapter returns a summary and stored sessionParams so Bizbox continues referencing the same ClickUp task.

Security notes:
- Prefer authTokenRef for long-lived environments.
- This adapter is a bridge/reference adapter; it relies on native ClickUp triggers and Automations rather than direct public AI-agent execution APIs.
`;
