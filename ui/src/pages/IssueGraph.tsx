import { type TouchEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type IssueGraphDeliverableNode, type IssueGraphResponse } from "@paperclipai/shared";
import { Activity, ArrowRight, Boxes, Download, FileText, GitBranch, Network, ZoomIn, ZoomOut } from "lucide-react";
import { issuesApi } from "../api/issues";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../components/StatusBadge";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Link, useNavigate, useParams } from "@/lib/router";
import { cn } from "../lib/utils";

const ISSUE_W = 250;
const ISSUE_H = 112;
const AGENT_W = 170;
const AGENT_H = 38;
const DELIVERABLE_W = 180;
const DELIVERABLE_H = 42;
const COL_GAP = 560;
const ROW_GAP = 164;
const PADDING_X = 80;
const PADDING_Y = 72;
const DETAIL_OFFSET_X = 28;
const AGENT_GAP_Y = 10;
const DELIVERABLE_GAP_Y = 8;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.8;

type LayoutRect = {
  id: string;
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type TouchPoint = { x: number; y: number };

function clampZoom(value: number) {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function issueNodeId(issueId: string) {
  return `issue:${issueId}`;
}

function deliverableNodeId(deliverableId: string) {
  return `deliverable:${deliverableId}`;
}

function deliverableHref(deliverable: IssueGraphDeliverableNode, issueIdentifierOrId: string) {
  if (deliverable.deliverableKind === "artifact") {
    return `/deliverables/${deliverable.id}`;
  }
  const documentKey = deliverable.documentKey;
  if (!documentKey) {
    return `/issues/${issueIdentifierOrId}`;
  }
  return `/issues/${issueIdentifierOrId}#document-${encodeURIComponent(documentKey)}`;
}

function edgeAnchor(rect: LayoutRect | undefined, side: "left" | "right" | "top" | "bottom") {
  if (!rect) return { x: 0, y: 0 };
  if (side === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === "right") return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === "top") return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
}

function resolveEdgeRect(
  edgeId: string,
  nodeId: string,
  kind: IssueGraphResponse["edges"][number]["kind"],
  issueRects: Map<string, LayoutRect>,
  detailRects: Map<string, LayoutRect>,
) {
  if (nodeId.startsWith("issue:")) {
    return issueRects.get(nodeId.slice("issue:".length));
  }
  if (kind === "assigned-agent" || kind === "participant-agent") {
    return detailRects.get(edgeId);
  }
  return detailRects.get(nodeId);
}

function buildTreeChildren(graph: IssueGraphResponse) {
  const childMap = new Map<string, string[]>();
  for (const issue of graph.issues) {
    if (!issue.parentId) continue;
    const siblings = childMap.get(issue.parentId) ?? [];
    siblings.push(issue.id);
    childMap.set(issue.parentId, siblings);
  }
  return childMap;
}

function buildDepthMap(rootIssueId: string, childMap: Map<string, string[]>) {
  const depthMap = new Map<string, number>();
  const walk = (issueId: string, depth: number, visited: Set<string>) => {
    if (visited.has(issueId)) return;
    visited.add(issueId);
    depthMap.set(issueId, depth);
    for (const childId of childMap.get(issueId) ?? []) {
      walk(childId, depth + 1, visited);
    }
  };
  walk(rootIssueId, 0, new Set<string>());
  return depthMap;
}

function buildIssueLayout(graph: IssueGraphResponse) {
  const childMap = buildTreeChildren(graph);
  const depthMap = buildDepthMap(graph.rootIssueId, childMap);
  const issueMap = new Map(graph.issues.map((issue) => [issue.id, issue]));
  const issueRects = new Map<string, LayoutRect>();
  const subtreeHeights = new Map<string, number>();

  const issueAgentRoles = new Map<string, { assigned: typeof graph.edges; participant: typeof graph.edges }>();
  const issueDeliverables = new Map<string, IssueGraphDeliverableNode[]>();
  const deliverableById = new Map(graph.deliverables.map((deliverable) => [deliverable.id, deliverable]));
  for (const edge of graph.edges) {
    if (!edge.issueId) continue;
    if (edge.kind === "assigned-agent" || edge.kind === "participant-agent") {
      const current = issueAgentRoles.get(edge.issueId) ?? { assigned: [], participant: [] };
      const bucket = edge.kind === "assigned-agent" ? current.assigned : current.participant;
      if (!bucket.some((candidate) => candidate.id === edge.id)) bucket.push(edge);
      issueAgentRoles.set(edge.issueId, current);
    }
    if (edge.kind === "issue-deliverable" && edge.deliverableId) {
      const current = issueDeliverables.get(edge.issueId) ?? [];
      const deliverable = deliverableById.get(edge.deliverableId);
      if (deliverable) current.push(deliverable);
      issueDeliverables.set(edge.issueId, current);
    }
  }

  const issueFootprintHeight = (issueId: string) => {
    const roles = issueAgentRoles.get(issueId) ?? { assigned: [], participant: [] };
    const deliverables = issueDeliverables.get(issueId) ?? [];
    const uniqueParticipantCount = roles.participant.filter(
      (candidate) => !roles.assigned.some((assigned) => assigned.agentId === candidate.agentId),
    ).length;
    const agentCount = roles.assigned.length + uniqueParticipantCount;
    const agentStackHeight =
      agentCount > 0 ? agentCount * AGENT_H + Math.max(0, agentCount - 1) * AGENT_GAP_Y : 0;
    const deliverableStackHeight =
      deliverables.length > 0
        ? ISSUE_H + 20 + deliverables.length * DELIVERABLE_H + Math.max(0, deliverables.length - 1) * DELIVERABLE_GAP_Y
        : ISSUE_H;
    return Math.max(ISSUE_H, agentStackHeight, deliverableStackHeight, ROW_GAP);
  };

  const measure = (issueId: string, visited: Set<string>): number => {
    if (visited.has(issueId)) {
      return subtreeHeights.get(issueId) ?? issueFootprintHeight(issueId);
    }
    visited.add(issueId);
    const children = childMap.get(issueId) ?? [];
    const ownHeight = issueFootprintHeight(issueId);
    if (children.length === 0) {
      subtreeHeights.set(issueId, ownHeight);
      visited.delete(issueId);
      return ownHeight;
    }
    const childrenHeight = children.reduce((sum, childId) => sum + measure(childId, visited), 0);
    const total = Math.max(ownHeight, childrenHeight);
    subtreeHeights.set(issueId, total);
    visited.delete(issueId);
    return total;
  };

  const position = (issueId: string, startY: number, visited: Set<string>) => {
    if (visited.has(issueId)) return;
    visited.add(issueId);
    const depth = depthMap.get(issueId) ?? 0;
    const footprintHeight = issueFootprintHeight(issueId);
    const subtreeHeight = subtreeHeights.get(issueId) ?? footprintHeight;
    const centeredY = startY + Math.max(0, (subtreeHeight - footprintHeight) / 2);
    issueRects.set(issueId, {
      id: issueId,
      nodeId: issueNodeId(issueId),
      x: PADDING_X + depth * COL_GAP,
      y: PADDING_Y + centeredY,
      width: ISSUE_W,
      height: ISSUE_H,
    });

    let cursorY = startY;
    for (const childId of childMap.get(issueId) ?? []) {
      position(childId, cursorY, visited);
      cursorY += subtreeHeights.get(childId) ?? ROW_GAP;
    }
    visited.delete(issueId);
  };

  measure(graph.rootIssueId, new Set<string>());
  position(graph.rootIssueId, 0, new Set<string>());

  const detailRects = new Map<string, LayoutRect>();
  for (const issue of graph.issues) {
    const issueRect = issueRects.get(issue.id);
    if (!issueRect) continue;
    const roles = issueAgentRoles.get(issue.id) ?? { assigned: [], participant: [] };
    const deliverables = issueDeliverables.get(issue.id) ?? [];
    let agentIndex = 0;

    for (const edge of roles.assigned) {
      if (!edge.agentId) continue;
      detailRects.set(edge.id, {
        id: edge.id,
        nodeId: edge.id,
        x: issueRect.x + ISSUE_W + DETAIL_OFFSET_X,
        y: issueRect.y + agentIndex * (AGENT_H + AGENT_GAP_Y),
        width: AGENT_W,
        height: AGENT_H,
      });
      agentIndex += 1;
    }
    for (const edge of roles.participant.filter((candidate) => !roles.assigned.some((assigned) => assigned.agentId === candidate.agentId))) {
      if (!edge.agentId) continue;
      detailRects.set(edge.id, {
        id: edge.id,
        nodeId: edge.id,
        x: issueRect.x + ISSUE_W + DETAIL_OFFSET_X,
        y: issueRect.y + agentIndex * (AGENT_H + AGENT_GAP_Y),
        width: AGENT_W,
        height: AGENT_H,
      });
      agentIndex += 1;
    }

    deliverables.forEach((deliverable, index) => {
      detailRects.set(deliverableNodeId(deliverable.id), {
        id: deliverable.id,
        nodeId: deliverableNodeId(deliverable.id),
        x: issueRect.x + 14,
        y: issueRect.y + ISSUE_H + 20 + index * (DELIVERABLE_H + DELIVERABLE_GAP_Y),
        width: DELIVERABLE_W,
        height: DELIVERABLE_H,
      });
    });
  }

  const allRects = [...issueRects.values(), ...detailRects.values()];
  const bounds = allRects.reduce(
    (acc, rect) => ({
      width: Math.max(acc.width, rect.x + rect.width + PADDING_X),
      height: Math.max(acc.height, rect.y + rect.height + PADDING_Y),
    }),
    { width: 820, height: 520 },
  );

  return {
    issueMap,
    issueRects,
    detailRects,
    issueAgentRoles,
    issueDeliverables,
    bounds,
  };
}

export function IssueGraph() {
  const { issueId } = useParams<{ issueId: string }>();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const blockerMarkerId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const latestPanRef = useRef(pan);
  const dragRef = useRef<{ active: boolean; start: TouchPoint; pan: TouchPoint }>({
    active: false,
    start: { x: 0, y: 0 },
    pan: { x: 0, y: 0 },
  });
  latestPanRef.current = pan;

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.graph(issueId ?? ""),
    queryFn: () => issuesApi.getGraph(issueId!),
    enabled: !!issueId,
  });

  const layout = useMemo(() => (data ? buildIssueLayout(data) : null), [data]);
  const rootIssue = useMemo(
    () => data?.issues.find((issue) => issue.id === data.rootIssueId) ?? null,
    [data],
  );
  const selectedIssue = useMemo(
    () => data?.issues.find((issue) => issue.id === issueId || issue.identifier === issueId) ?? null,
    [data, issueId],
  );
  const agentMap = useMemo(
    () => new Map(data?.agents.map((agent) => [agent.id, agent]) ?? []),
    [data],
  );

  useEffect(() => {
    setBreadcrumbs(
      selectedIssue
        ? [
            { label: "Issues", href: "/issues" },
            { label: selectedIssue.identifier ?? selectedIssue.title, href: `/issues/${selectedIssue.identifier ?? selectedIssue.id}` },
            { label: "Pipeline" },
          ]
        : [{ label: "Issues", href: "/issues" }, { label: "Pipeline" }],
    );
  }, [selectedIssue, setBreadcrumbs]);

  useEffect(() => {
    if (!layout || !containerRef.current) return;
    const container = containerRef.current;
    const fitX = (container.clientWidth - 40) / layout.bounds.width;
    const fitY = (container.clientHeight - 40) / layout.bounds.height;
    const fitZoom = clampZoom(Math.min(fitX, fitY, 1));
    setZoom(fitZoom);
    setPan({
      x: (container.clientWidth - layout.bounds.width * fitZoom) / 2,
      y: 24,
    });
  }, [layout]);

  const startDrag = useCallback((clientX: number, clientY: number) => {
    dragRef.current = {
      active: true,
      start: { x: clientX, y: clientY },
      pan: latestPanRef.current,
    };
  }, []);

  const onPointerMove = useCallback((clientX: number, clientY: number) => {
    if (!dragRef.current.active) return;
    const dx = clientX - dragRef.current.start.x;
    const dy = clientY - dragRef.current.start.y;
    setPan({
      x: dragRef.current.pan.x + dx,
      y: dragRef.current.pan.y + dy,
    });
  }, []);

  const stopDrag = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const onTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    startDrag(touch.clientX, touch.clientY);
  }, [startDrag]);

  const onTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;
    onPointerMove(touch.clientX, touch.clientY);
  }, [onPointerMove]);

  if (isLoading) return <PageSkeleton variant="org-chart" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data || !layout || !rootIssue) {
    return <EmptyState icon={Network} message="Issue pipeline unavailable." />;
  }

  const selectedIssueLabel = selectedIssue?.identifier ?? selectedIssue?.title ?? issueId ?? rootIssue.identifier ?? rootIssue.id;
  const rootIssueLabel = rootIssue.identifier ?? rootIssue.id;
  const headlineStatus = selectedIssue?.status ?? rootIssue.status;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-xl font-bold">Issue Pipeline</h1>
            <StatusBadge status={headlineStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            Viewing <span className="font-mono">{selectedIssueLabel}</span>
            {selectedIssue?.id !== rootIssue.id && (
              <> within <span className="font-mono">{rootIssueLabel}</span></>
            )}{" "}
            and expanded across all downstream issues.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setZoom((value) => clampZoom(value - 0.1))}>
            <ZoomOut className="mr-1.5 h-3.5 w-3.5" />
            Zoom out
          </Button>
          <Button variant="outline" size="sm" onClick={() => setZoom((value) => clampZoom(value + 0.1))}>
            <ZoomIn className="mr-1.5 h-3.5 w-3.5" />
            Zoom in
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
          <GitBranch className="h-3 w-3" />
          Hierarchy
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
          <Activity className="h-3 w-3" />
          Blocker
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
          <Boxes className="h-3 w-3" />
          Deliverable
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative h-[70vh] overflow-hidden rounded-xl border border-border bg-muted/20"
        style={{ touchAction: "none" }}
        onMouseDown={(event) => startDrag(event.clientX, event.clientY)}
        onMouseMove={(event) => onPointerMove(event.clientX, event.clientY)}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={stopDrag}
        onTouchCancel={stopDrag}
        onWheel={(event) => {
          event.preventDefault();
          const container = containerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const cursorX = event.clientX - rect.left;
          const cursorY = event.clientY - rect.top;
          const delta = event.deltaY > 0 ? -0.1 : 0.1;
          setZoom((prevZoom) => {
            const nextZoom = clampZoom(prevZoom + delta);
            const scale = nextZoom / prevZoom;
            setPan((prevPan) => ({
              x: cursorX - scale * (cursorX - prevPan.x),
              y: cursorY - scale * (cursorY - prevPan.y),
            }));
            return nextZoom;
          });
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: layout.bounds.width,
            height: layout.bounds.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg width={layout.bounds.width} height={layout.bounds.height} className="absolute inset-0 overflow-visible">
            <defs>
              <marker id={blockerMarkerId} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
                <path d="M0 0 L10 5 L0 10 z" className="fill-muted-foreground/60" />
              </marker>
            </defs>
            {data.edges.map((edge) => {
              const resolvedFromRect = resolveEdgeRect(
                edge.id,
                edge.fromId,
                edge.kind,
                layout.issueRects,
                layout.detailRects,
              );
              const resolvedToRect = resolveEdgeRect(
                edge.id,
                edge.toId,
                edge.kind,
                layout.issueRects,
                layout.detailRects,
              );
              if (!resolvedFromRect || !resolvedToRect) return null;
              const start =
                edge.kind === "issue-deliverable"
                  ? edgeAnchor(resolvedFromRect, "bottom")
                  : edgeAnchor(resolvedFromRect, "right");
              const end =
                edge.kind === "issue-deliverable"
                  ? edgeAnchor(resolvedToRect, "top")
                  : edgeAnchor(resolvedToRect, "left");
              const strokeClass =
                edge.kind === "blocker"
                  ? "stroke-amber-500/80"
                  : edge.kind === "hierarchy"
                    ? "stroke-cyan-500/70"
                    : "stroke-border";
              const dashArray = edge.kind === "blocker" ? "7 6" : edge.kind === "participant-agent" ? "4 4" : undefined;
              const controlX = (start.x + end.x) / 2;
              const path =
                edge.kind === "issue-deliverable"
                  ? `M ${start.x} ${start.y} C ${start.x} ${start.y + 26}, ${end.x} ${end.y - 18}, ${end.x} ${end.y}`
                  : `M ${start.x} ${start.y} C ${controlX} ${start.y}, ${controlX} ${end.y}, ${end.x} ${end.y}`;
              return (
                <path
                  key={edge.id}
                  d={path}
                  fill="none"
                  strokeWidth={edge.kind === "hierarchy" ? 2.5 : 1.8}
                  strokeDasharray={dashArray}
                  markerEnd={edge.kind === "blocker" ? `url(#${blockerMarkerId})` : undefined}
                  className={strokeClass}
                  data-edge-kind={edge.kind}
                />
              );
            })}
          </svg>

          {data.issues.map((issue) => {
            const rect = layout.issueRects.get(issue.id);
            if (!rect) return null;
            const isSelectedIssue = issue.id === selectedIssue?.id;
            const roles = layout.issueAgentRoles.get(issue.id) ?? { assigned: [], participant: [] };
            const deliverables = layout.issueDeliverables.get(issue.id) ?? [];
            return (
              <button
                key={issue.id}
                type="button"
                className={cn(
                  "absolute rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40",
                  isSelectedIssue ? "border-primary shadow-md ring-2 ring-primary/30" : "border-border",
                )}
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                onClick={() => navigate(`/issues/${issue.identifier ?? issue.id}`)}
                onMouseDown={(event) => event.stopPropagation()}
                data-node-kind="issue"
                data-selected={isSelectedIssue ? "true" : "false"}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-muted-foreground">{issue.identifier ?? issue.id}</div>
                    <div className="line-clamp-2 text-sm font-semibold text-foreground">{issue.title}</div>
                  </div>
                  <StatusBadge status={issue.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded-full border border-border px-2 py-0.5">
                    {roles.assigned.length + roles.participant.filter((edge) => !roles.assigned.some((assigned) => assigned.agentId === edge.agentId)).length} agents
                  </span>
                  <span className="rounded-full border border-border px-2 py-0.5">{deliverables.length} deliverables</span>
                </div>
              </button>
            );
          })}

          {data.edges
            .filter((edge) => edge.kind === "assigned-agent" || edge.kind === "participant-agent")
            .map((edge) => {
              const rect = layout.detailRects.get(edge.id);
              const agent = edge.agentId ? agentMap.get(edge.agentId) : null;
              if (!rect || !agent) return null;
              const roleLabel = edge.participationRole === "assigned" ? "Assigned" : "Worked";
              return (
                <button
                  key={edge.id}
                  type="button"
                  className="absolute flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 text-left shadow-xs hover:border-primary/40"
                  style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                  onClick={() => navigate(`/agents/${agent.urlKey}`)}
                  onMouseDown={(event) => event.stopPropagation()}
                  data-node-kind="agent"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                    <AgentIcon icon={agent.icon} className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{agent.name}</span>
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{roleLabel}</span>
                  </span>
                </button>
              );
            })}

          {data.deliverables.map((deliverable) => {
            const rect = layout.detailRects.get(deliverableNodeId(deliverable.id));
            if (!rect) return null;
            const issue = layout.issueMap.get(deliverable.issueId);
            if (!issue) return null;
            return (
              <Link
                key={deliverable.id}
                to={deliverableHref(deliverable, issue.identifier ?? issue.id)}
                className={cn(
                  "absolute flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 shadow-xs hover:border-primary/40",
                )}
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                data-node-kind="deliverable"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                  {deliverable.deliverableKind === "artifact" ? (
                    <Download className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{deliverable.title}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{deliverable.deliverableKind}</span>
                  {deliverable.pipelineRootIssueId !== deliverable.issueId ? (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      Part of {deliverable.pipelineRootIssueIdentifier ?? deliverable.pipelineRootIssueTitle} pipeline
                    </span>
                  ) : null}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
