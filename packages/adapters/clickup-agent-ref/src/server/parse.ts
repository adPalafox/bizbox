export type ParsedClickUpTaskResponse = {
  taskId: string | null;
  taskUrl: string | null;
  status: string | null;
};

export type ParsedClickUpCommentResponse = {
  comments: unknown[];
};

export function parseClickUpTaskResponse(rawText: string): ParsedClickUpTaskResponse {
  const payload = JSON.parse(rawText) as {
    id?: unknown;
    url?: unknown;
    status?: { status?: unknown };
  };
  return {
    taskId: typeof payload.id === "string" && payload.id.trim().length > 0 ? payload.id.trim() : null,
    taskUrl: typeof payload.url === "string" && payload.url.trim().length > 0 ? payload.url.trim() : null,
    status:
      typeof payload.status?.status === "string" && payload.status.status.trim().length > 0
        ? payload.status.status.trim()
        : null,
  };
}

export function parseClickUpCommentResponse(rawText: string): ParsedClickUpCommentResponse {
  const payload = JSON.parse(rawText) as { comments?: unknown };
  return {
    comments: Array.isArray(payload.comments) ? payload.comments : [],
  };
}
