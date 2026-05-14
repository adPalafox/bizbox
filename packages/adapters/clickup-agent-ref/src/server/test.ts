import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";

function summarizeStatus(
  checks: AdapterEnvironmentCheck[],
): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const token = asString(config.authToken, "").trim();
  const workspaceId = asString(config.workspaceId, "").trim();
  const listId = asString(config.listId, "").trim();
  const apiBaseUrl = asString(config.apiBaseUrl, "https://api.clickup.com/api/v2").trim();
  const triggerMode = asString(config.triggerMode, "api_comment_only").trim();
  const clickupAgentName = asString(config.clickupAgentName, "").trim();
  const automationStatus = asString(config.automationStatus, "").trim();
  const automationTags = (() => {
    const raw = config.automationTags;
    if (Array.isArray(raw)) {
      return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    }
    return [];
  })();

  if (!token) {
    checks.push({
      code: "clickup_agent_ref_auth_missing",
      level: "error",
      message: "No ClickUp token configured.",
      hint: "Set adapterConfig.authToken or adapterConfig.authTokenRef.",
    });
  } else {
    checks.push({
      code: "clickup_agent_ref_auth_present",
      level: "info",
      message: "ClickUp token configured.",
    });
  }

  if (!workspaceId) {
    checks.push({
      code: "clickup_agent_ref_workspace_missing",
      level: "error",
      message: "No workspaceId configured.",
    });
  }
  if (!listId) {
    checks.push({
      code: "clickup_agent_ref_list_missing",
      level: "error",
      message: "No listId configured.",
    });
  }

  try {
    const parsed = new URL(apiBaseUrl);
    checks.push({
      code: "clickup_agent_ref_url_ok",
      level: "info",
      message: `API base URL configured: ${parsed.origin}`,
    });
    if (parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      checks.push({
        code: "clickup_agent_ref_url_plaintext",
        level: "error",
        message: "Plaintext HTTP is not permitted for remote ClickUp endpoints.",
      });
    }
  } catch {
    checks.push({
      code: "clickup_agent_ref_url_invalid",
      level: "error",
      message: `Invalid apiBaseUrl: ${apiBaseUrl}`,
    });
  }

  if (triggerMode === "automation_trigger") {
    if (!clickupAgentName) {
      checks.push({
        code: "clickup_agent_ref_trigger_agent_missing",
        level: "error",
        message: "Automation trigger requires a ClickUp agent name.",
        hint: "Set adapterConfig.clickupAgentName to the ClickUp AI agent display name.",
      });
    }
    if (automationStatus || automationTags.length > 0) {
      checks.push({
        code: "clickup_agent_ref_automation_signal_present",
        level: "info",
        message: `Automation signal configured${automationStatus ? ` status=${automationStatus}` : ""}${automationTags.length > 0 ? ` tags=${automationTags.join(",")}` : ""}.`,
      });
    } else {
      checks.push({
        code: "clickup_agent_ref_automation_signal_absent",
        level: "warn",
        message: "Automation trigger mode is enabled but no explicit status or tags are configured.",
        hint: "This is valid if your ClickUp Automation fires on task creation in the configured list. Otherwise set automationStatus or automationTags.",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
