export function buildDeliverableReferenceHref(deliverableId: string): string {
  return `/deliverables/${deliverableId.trim()}`;
}

export function parseDeliverableReferenceHref(href: string): { deliverableId: string } | null {
  const raw = href.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = raw.startsWith("/")
      ? new URL(raw, "https://paperclip.invalid")
      : new URL(raw);
  } catch {
    return null;
  }

  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index]?.toLowerCase() !== "deliverables") continue;
    const deliverableId = (segments[index + 1] ?? "").trim();
    if (deliverableId) {
      return { deliverableId };
    }
  }

  return null;
}
