import type { CSSProperties } from "react";
import {
  parseAgentMentionHref,
  parseDeliverableReferenceHref,
  parseIssueReferenceHref,
  parseProjectMentionHref,
  parseSkillMentionHref,
  parseUserMentionHref,
} from "@paperclipai/shared";
import { getAgentIcon } from "./agent-icons";
import { hexToRgb, pickTextColorForPillBg } from "./color-contrast";

export type ParsedMentionChip =
  | {
      kind: "agent";
      agentId: string;
      icon: string | null;
    }
  | {
      kind: "issue";
      identifier: string;
    }
  | {
      kind: "deliverable";
      deliverableId: string;
    }
  | {
      kind: "project";
      projectId: string;
      color: string | null;
    }
  | {
      kind: "user";
      userId: string;
    }
  | {
      kind: "skill";
      skillId: string;
      slug: string | null;
    };

const iconMaskCache = new Map<string, string>();

export function parseMentionChipHref(href: string): ParsedMentionChip | null {
  const issue = parseIssueReferenceHref(href);
  if (issue) {
    return {
      kind: "issue",
      identifier: issue.identifier,
    };
  }

  const deliverable = parseDeliverableReferenceHref(href);
  if (deliverable) {
    return {
      kind: "deliverable",
      deliverableId: deliverable.deliverableId,
    };
  }

  const agent = parseAgentMentionHref(href);
  if (agent) {
    return {
      kind: "agent",
      agentId: agent.agentId,
      icon: agent.icon,
    };
  }

  const project = parseProjectMentionHref(href);
  if (project) {
    return {
      kind: "project",
      projectId: project.projectId,
      color: project.color,
    };
  }

  const user = parseUserMentionHref(href);
  if (user) {
    return {
      kind: "user",
      userId: user.userId,
    };
  }

  const skill = parseSkillMentionHref(href);
  if (skill) {
    return {
      kind: "skill",
      skillId: skill.skillId,
      slug: skill.slug,
    };
  }

  return null;
}

export function mentionChipInlineStyle(mention: ParsedMentionChip): CSSProperties | undefined {
  const style: CSSProperties & Record<string, string> = {};

  if (mention.kind === "project" && mention.color) {
    const projectStyle = projectMentionColors(mention.color);
    Object.assign(style, projectStyle);
    style["--paperclip-mention-project-color"] = mention.color;
  }

  const iconMask = mention.kind === "agent"
    ? buildAgentIconMask(mention.icon)
    : buildMentionKindIconMask(mention.kind);
  if (iconMask) {
    style["--paperclip-mention-icon-mask"] = iconMask;
  }

  return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined;
}

export function applyMentionChipDecoration(element: HTMLElement, mention: ParsedMentionChip) {
  clearMentionChipDecoration(element);
  element.dataset.mentionKind = mention.kind;
  element.setAttribute("contenteditable", "false");
  element.classList.add("paperclip-mention-chip", `paperclip-mention-chip--${mention.kind}`);
  if (mention.kind === "project") {
    element.classList.add("paperclip-project-mention-chip");
  }

  const style = mentionChipInlineStyle(mention);
  if (!style) return;
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === "string") {
      if (key.startsWith("--")) {
        element.style.setProperty(key, value);
      } else {
        (element.style as CSSStyleDeclaration & Record<string, string>)[key] = value;
      }
    }
  }
}

export function clearMentionChipDecoration(element: HTMLElement) {
  delete element.dataset.mentionKind;
  element.classList.remove(
    "paperclip-mention-chip",
    "paperclip-mention-chip--agent",
    "paperclip-mention-chip--issue",
    "paperclip-mention-chip--deliverable",
    "paperclip-mention-chip--project",
    "paperclip-mention-chip--user",
    "paperclip-mention-chip--skill",
    "paperclip-project-mention-chip",
  );
  element.removeAttribute("contenteditable");
  element.style.removeProperty("border-color");
  element.style.removeProperty("background-color");
  element.style.removeProperty("color");
  element.style.removeProperty("--paperclip-mention-project-color");
  element.style.removeProperty("--paperclip-mention-icon-mask");
}

function projectMentionColors(color: string): Pick<CSSProperties, "borderColor" | "backgroundColor" | "color"> {
  const rgb = hexToRgb(color);
  if (!rgb) return {};
  return {
    borderColor: color,
    backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`,
    color: pickTextColorForPillBg(color),
  };
}

function buildAgentIconMask(iconName: string | null): string | null {
  const cacheKey = iconName ?? "__default__";
  const cached = iconMaskCache.get(cacheKey);
  if (cached) return cached;

  const Icon = getAgentIcon(iconName);
  const iconNode = resolveLucideIconNode(Icon);
  if (!Array.isArray(iconNode) || iconNode.length === 0) return null;

  const body = iconNode.map(([tag, attrs]) => {
    const attrString = Object.entries(attrs)
      .filter(([key]) => key !== "key")
      .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
      .join(" ");
    return `<${tag}${attrString ? ` ${attrString}` : ""}></${tag}>`;
  }).join("");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  iconMaskCache.set(cacheKey, url);
  return url;
}

function buildMentionKindIconMask(kind: Exclude<ParsedMentionChip["kind"], "agent">): string | null {
  const cacheKey = `kind:${kind}`;
  const cached = iconMaskCache.get(cacheKey);
  if (cached) return cached;

  const body = mentionKindIconSvg[kind];
  if (!body) return null;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${body}</svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  iconMaskCache.set(cacheKey, url);
  return url;
}

const mentionKindIconSvg: Record<Exclude<ParsedMentionChip["kind"], "agent">, string> = {
  issue: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="2"></circle>',
  deliverable: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path>',
  project: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5.379a1.5 1.5 0 0 1 1.06.44l1.121 1.12A1.5 1.5 0 0 0 13.121 8H19.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"></path>',
  user: '<path d="M19 21a7 7 0 0 0-14 0"></path><circle cx="12" cy="8" r="4"></circle>',
  skill: '<path d="M3 7l9-4 9 4-9 4z"></path><path d="M3 17l9 4 9-4"></path><path d="M3 12l9 4 9-4"></path>',
};

function resolveLucideIconNode(
  icon: unknown,
): Array<[string, Record<string, string>]> | null {
  const staticIconNode = (
    icon as {
      iconNode?: Array<[string, Record<string, string>]>;
    }
  ).iconNode;
  if (Array.isArray(staticIconNode) && staticIconNode.length > 0) {
    return staticIconNode;
  }

  const render = (
    icon as {
      render?: (props: Record<string, unknown>, ref: unknown) => {
        props?: { iconNode?: Array<[string, Record<string, string>]> };
      } | null;
    }
  ).render;
  const rendered = typeof render === "function" ? render({}, null) : null;
  const renderedIconNode = rendered?.props?.iconNode;
  return Array.isArray(renderedIconNode) && renderedIconNode.length > 0
    ? renderedIconNode
    : null;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
