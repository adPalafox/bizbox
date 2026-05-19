import type { CompanyMember, CompanyUserDirectoryEntry } from "@/api/access";
import type { InlineEntityOption } from "@/components/InlineEntitySelector";
import type { MentionOption } from "@/components/MarkdownEditor";
import type { Agent, DeliverableListItem, Issue, Project } from "@paperclipai/shared";

export interface CompanyUserProfile {
  label: string;
  image: string | null;
}

type CompanyUserRecord = Pick<CompanyMember, "principalId" | "status" | "user">
  | CompanyUserDirectoryEntry;

function fallbackUserLabel(userId: string): string {
  if (userId === "local-board") return "Board";
  return userId.slice(0, 5);
}

function baseMemberLabel(member: Pick<CompanyUserRecord, "principalId" | "user">): string {
  const name = member.user?.name?.trim();
  if (name) return name;
  const email = member.user?.email?.trim();
  if (email) return email;
  return fallbackUserLabel(member.principalId);
}

function activeUniqueMembers(members: CompanyUserRecord[] | null | undefined) {
  const byId = new Map<string, CompanyUserRecord>();
  for (const member of members ?? []) {
    if (member.status !== "active") continue;
    if (!byId.has(member.principalId)) {
      byId.set(member.principalId, member);
    }
  }
  return [...byId.values()].sort((left, right) => baseMemberLabel(left).localeCompare(baseMemberLabel(right)));
}

export function buildCompanyUserLabelMap(members: CompanyUserRecord[] | null | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  for (const member of members ?? []) {
    labels.set(member.principalId, baseMemberLabel(member));
  }
  return labels;
}

export function buildCompanyUserProfileMap(
  members: CompanyUserRecord[] | null | undefined,
): Map<string, CompanyUserProfile> {
  const profiles = new Map<string, CompanyUserProfile>();
  for (const member of members ?? []) {
    profiles.set(member.principalId, {
      label: baseMemberLabel(member),
      image: member.user?.image ?? null,
    });
  }
  return profiles;
}

export function buildCompanyUserInlineOptions(
  members: CompanyUserRecord[] | null | undefined,
  options?: { excludeUserIds?: Iterable<string | null | undefined> },
): InlineEntityOption[] {
  const exclude = new Set(
    [...(options?.excludeUserIds ?? [])].filter((value): value is string => Boolean(value)),
  );

  return activeUniqueMembers(members)
    .filter((member) => !exclude.has(member.principalId))
    .map((member) => ({
      id: `user:${member.principalId}`,
      label: baseMemberLabel(member),
      searchText: [member.user?.name, member.user?.email, member.principalId].filter(Boolean).join(" "),
    }));
}

export function buildCompanyUserMentionOptions(
  members: CompanyUserRecord[] | null | undefined,
): MentionOption[] {
  return activeUniqueMembers(members).map((member) => ({
    id: `user:${member.principalId}`,
    name: baseMemberLabel(member),
    kind: "user",
    userId: member.principalId,
  }));
}

export function buildMarkdownMentionOptions(args: {
  agents?: Array<Pick<Agent, "id" | "name" | "status" | "icon">> | null | undefined;
  issues?: Array<Pick<Issue, "id" | "identifier" | "title">> | null | undefined;
  deliverables?: Array<Pick<DeliverableListItem, "id" | "title" | "originalFilename" | "childIssue" | "rootIssue">> | null | undefined;
  projects?: Array<Pick<Project, "id" | "name" | "color">> | null | undefined;
  members?: CompanyUserRecord[] | null | undefined;
  includeUsers?: boolean;
}): MentionOption[] {
  const options: MentionOption[] = [
    ...(args.includeUsers ? buildCompanyUserMentionOptions(args.members) : []),
    ...[...(args.agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((agent) => ({
        id: `agent:${agent.id}`,
        name: agent.name,
        kind: "agent" as const,
        agentId: agent.id,
        agentIcon: agent.icon,
      })),
    ...[...(args.issues ?? [])]
      .filter((issue) => Boolean(issue.identifier))
      .sort((left, right) => (left.identifier ?? left.title).localeCompare(right.identifier ?? right.title))
      .map((issue) => ({
        id: `issue:${issue.id}`,
        name: issue.title,
        kind: "issue" as const,
        issueId: issue.id,
        issueIdentifier: issue.identifier ?? issue.id,
        searchText: [issue.identifier, issue.title].filter(Boolean).join(" "),
      })),
    ...[...(args.deliverables ?? [])]
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((deliverable) => {
        const contextIssue = deliverable.rootIssue ?? deliverable.childIssue;
        const contextIdentifier = contextIssue.identifier ?? contextIssue.title;
        return {
          id: `deliverable:${deliverable.id}`,
          name: deliverable.title,
          kind: "deliverable" as const,
          deliverableId: deliverable.id,
          deliverableContextLabel: contextIdentifier
            ? `${contextIdentifier} ${contextIssue.title}`.trim()
            : contextIssue.title,
          deliverableFilename: deliverable.originalFilename ?? null,
          searchText: [
            deliverable.title,
            deliverable.originalFilename,
            contextIssue.identifier,
            contextIssue.title,
          ].filter(Boolean).join(" "),
        };
      }),
    ...[...(args.projects ?? [])]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((project) => ({
        id: `project:${project.id}`,
        name: project.name,
        kind: "project" as const,
        projectId: project.id,
        projectColor: project.color,
      })),
  ];

  return options;
}
