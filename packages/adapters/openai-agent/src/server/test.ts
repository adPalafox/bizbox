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
  const apiBaseUrl = asString(config.apiBaseUrl, "https://api.openai.com/v1").trim();

  if (!token) {
    checks.push({
      code: "openai_agent_auth_missing",
      level: "error",
      message: "No OpenAI API key configured.",
      hint: "Set adapterConfig.authToken or adapterConfig.authTokenRef.",
    });
  } else {
    checks.push({
      code: "openai_agent_auth_present",
      level: "info",
      message: "OpenAI API key configured.",
    });
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(apiBaseUrl);
    checks.push({
      code: "openai_agent_url_ok",
      level: "info",
      message: `API base URL configured: ${parsed.origin}`,
    });
  } catch {
    checks.push({
      code: "openai_agent_url_invalid",
      level: "error",
      message: `Invalid apiBaseUrl: ${apiBaseUrl}`,
    });
  }

  if (parsed && parsed.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    checks.push({
      code: "openai_agent_url_plaintext",
      level: "error",
      message: "Plaintext HTTP is not permitted for remote OpenAI endpoints.",
      hint: "Use https:// unless you are testing against a local loopback server.",
    });
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
