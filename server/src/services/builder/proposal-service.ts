import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { logActivity } from "../activity-log.js";
import { builderProposalStore } from "./proposal-store.js";
import { isMutationTool, type MutationTool } from "./tools/mutation-tool.js";
import { getBuilderToolCatalog } from "./tool-registry.js";
import type { BuilderActor, BuilderTool } from "./types.js";
import type { ApplierContext } from "./applier-types.js";

/**
 * Proposal lifecycle service — list / get / apply / reject builder proposals.
 *
 * Apply dispatches to the originating mutation tool's `apply()` method (the
 * tool is looked up in the catalog by `kind === tool.name`), which calls the
 * relevant core service. This preserves the rule that **tools call services**
 * even when execution is deferred.
 */

export function proposalService(db: Db) {
  const store = builderProposalStore(db);

  function findApplier(kind: string, catalog: Map<string, BuilderTool>): MutationTool | null {
    for (const tool of catalog.values()) {
      if (isMutationTool(tool) && tool.proposalKind === kind) return tool;
    }
    return null;
  }

  return {
    list: store.list,
    get: store.getById,
    pendingCount: store.pendingCount,

    apply: async (
      companyId: string,
      proposalId: string,
      decidedByUserId: string | null,
    ) => {
      const proposal = await store.getById(companyId, proposalId);
      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status !== "pending" && proposal.status !== "approved") {
        throw new Error(`Proposal is ${proposal.status}; cannot apply`);
      }

      const catalog = getBuilderToolCatalog(db);
      const tool = findApplier(proposal.kind, catalog);
      if (!tool) {
        const reason = `No registered applier for kind "${proposal.kind}"`;
        await store.markFailed(proposalId, decidedByUserId, reason);
        throw new Error(reason);
      }

      const proposer: BuilderActor = { type: "user", id: decidedByUserId };
      const ctx: ApplierContext = {
        db,
        companyId,
        decidedByUserId,
        proposer,
      };

      try {
        // Wrap tool.apply() and markApplied() in a transaction to prevent orphaned entities
        const { applied, result } = await db.transaction(async (tx) => {
          // Tool appliers use ctx.db which is the outer db, not tx
          // This means the entity creation is part of the transaction scope
          const result = await tool.apply(proposal.payload, { ...ctx, db: tx as any });
          const applied = await store.markApplied(proposalId, decidedByUserId, null);
          if (!applied) {
            // Another concurrent apply already won — treat as idempotent success by
            // re-fetching the now-applied proposal so the caller gets a real value.
            const current = await store.getById(companyId, proposalId);
            return { applied: current, result };
          }
          return { applied, result };
        });
        
        if (!applied) {
          // Concurrent race case - return the re-fetched proposal
          return applied;
        }
        
        // Best-effort activity log — never fail the apply because of logging
        await logActivity(db, {
          companyId,
          actorType: "user",
          actorId: decidedByUserId ?? "board",
          action: "builder.proposal.applied",
          entityType: result.entityType ?? "builder_proposal",
          entityId: result.entityId ?? proposalId,
          details: {
            proposalId,
            kind: proposal.kind,
            sessionId: proposal.sessionId,
            summary: result.summary,
            ...(result.details ?? {}),
          },
        }).catch((logErr) =>
          logger.warn({ logErr, proposalId }, "builder apply: activity log failed"),
        );
        return applied;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Apply failed";
        logger.warn(
          { proposalId, kind: proposal.kind, err },
          "builder proposal apply failed",
        );
        await store.markFailed(proposalId, decidedByUserId, reason);
        throw err;
      }
    },

    reject: async (
      companyId: string,
      proposalId: string,
      decidedByUserId: string | null,
    ) => {
      const proposal = await store.getById(companyId, proposalId);
      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status !== "pending" && proposal.status !== "approved") {
        throw new Error(`Proposal is ${proposal.status}; cannot reject`);
      }
      const rejected = await store.markRejected(proposalId, decidedByUserId);
      if (!rejected) {
        // Race: another request already rejected this proposal — return the current state
        const current = await store.getById(companyId, proposalId);
        return current;
      }
      // Best-effort activity log — never fail the reject because of logging
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: decidedByUserId ?? "board",
        action: "builder.proposal.rejected",
        entityType: "builder_proposal",
        entityId: proposalId,
        details: { proposalId, kind: proposal.kind, sessionId: proposal.sessionId },
      }).catch((logErr) =>
        logger.warn({ logErr, proposalId }, "builder reject: activity log failed"),
      );
      return rejected;
    },
  };
}
