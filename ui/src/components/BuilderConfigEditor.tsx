import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { builderApi } from "@/api/builder";
import { listUIAdapters, getUIAdapter } from "@/adapters";
import { AgentConfigForm } from "@/components/AgentConfigForm";
import { Button } from "@/components/ui/button";
import type { BuilderProviderSettings } from "@paperclipai/shared";
import { useToastActions } from "@/context/ToastContext";

const QUERY_KEY = ["builder"] as const;

function getAvailableBuilderAdapters(supportedAdapterTypes: string[]) {
  const supported = new Set(supportedAdapterTypes);
  return listUIAdapters().filter((adapter) => supported.has(adapter.type));
}

function getAdapterStatusText(adapterType: string): string {
  switch (adapterType) {
    case "claude_local":
    case "opencode_local":
      return "Experimental - core workflow tested";
    case "codex_local":
    case "cursor_local":
    case "gemini_local":
    case "pi_local":
      return "Untested - verify in your environment";
    default:
      return "Compatibility unknown";
  }
}

function settingsToFormValues(settings: BuilderProviderSettings | null): CreateConfigValues {
  const config = settings?.adapterConfig ?? {};
  return {
    adapterType: settings?.adapterType ?? "claude_local",
    model: (config.model as string) ?? "",
    instructionsFilePath: (config.instructionsFilePath as string) ?? "",
    cwd: (config.cwd as string) ?? "",
    thinkingEffort: (config.effort as string) ?? "",
    chrome: (config.chrome as boolean) ?? false,
    dangerouslySkipPermissions: (config.dangerouslySkipPermissions as boolean) ?? false,
    timeoutSec: (config.timeoutSec as number) ?? 0,
    promptTemplate: (config.promptTemplate as string) ?? "",
    bootstrapPrompt: (config.bootstrapPromptTemplate as string) ?? "",
    command: (config.command as string) ?? "",
    extraArgs: Array.isArray(config.extraArgs) ? config.extraArgs.join(", ") : "",
    args: Array.isArray(config.args) ? config.args.join(", ") : "",
    envBindings: (config.env as Record<string, unknown>) ?? {},
    envVars: "",
    search: (config.search as boolean) ?? false,
    fastMode: (config.fastMode as boolean) ?? false,
    dangerouslyBypassSandbox: (config.dangerouslyBypassSandbox as boolean) ?? false,
    url: (config.url as string) ?? "",
    accessToken: (config.accessToken as string) ?? undefined,
    apiKey: (config.apiKey as string) ?? undefined,
    workspaceStrategyType: (config.workspaceStrategyType as string) ?? undefined,
    workspaceBaseRef: (config.workspaceBaseRef as string) ?? undefined,
    workspaceBranchTemplate: (config.workspaceBranchTemplate as string) ?? undefined,
    worktreeParentDir: (config.worktreeParentDir as string) ?? undefined,
    payloadTemplateJson: (config.payloadTemplateJson as string) ?? undefined,
    runtimeServicesJson: (config.runtimeServicesJson as string) ?? undefined,
    artifactOutputsJson: (config.artifactOutputsJson as string) ?? undefined,
    maxTurnsPerRun: (config.maxTurnsPerRun as number) ?? 10,
    heartbeatEnabled: false,
    intervalSec: 300,
  };
}

export function BuilderConfigEditor({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const toast = useToastActions();
  const [formValues, setFormValues] = useState<CreateConfigValues | null>(null);

  const toolsQuery = useQuery({
    queryKey: [...QUERY_KEY, "tools", companyId] as const,
    queryFn: () => builderApi.getTools(companyId),
  });

  const settingsQuery = useQuery({
    queryKey: [...QUERY_KEY, "settings", companyId] as const,
    queryFn: () => builderApi.getSettings(companyId),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setFormValues(settingsToFormValues(settingsQuery.data.settings));
    }
  }, [settingsQuery.data]);

  const availableAdapters = useMemo(
    () => getAvailableBuilderAdapters(toolsQuery.data?.supportedAdapterTypes ?? []),
    [toolsQuery.data?.supportedAdapterTypes],
  );

  const uiAdapter = useMemo(() => {
    if (!formValues?.adapterType) return null;
    return getUIAdapter(formValues.adapterType);
  }, [formValues?.adapterType]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!formValues || !uiAdapter) return null;
      if (!formValues.model?.trim()) {
        throw new Error("Please select a model before saving.");
      }

      return builderApi.updateSettings(companyId, {
        adapterType: formValues.adapterType,
        adapterConfig: uiAdapter.buildAdapterConfig(formValues),
      });
    },
    onSuccess: async () => {
      toast.pushToast({ title: "Builder settings saved", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "settings", companyId] });
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, "sessions", companyId] });
    },
    onError: (err) => {
      toast.pushToast({
        title: "Failed to save Builder settings",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  if (!formValues || !toolsQuery.data) {
    return <div className="text-sm text-muted-foreground">Loading Builder settings...</div>;
  }

  const selectedAdapter = availableAdapters.find((adapter) => adapter.type === formValues.adapterType);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        All Builder sessions use the current company Builder settings on their next turn.
      </div>

      <label className="block text-sm">
        <span className="font-medium text-foreground">Adapter type</span>
        <select
          className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={formValues.adapterType}
          onChange={(event) => {
            const nextAdapterType = event.target.value;
            setFormValues({
              ...settingsToFormValues(null),
              adapterType: nextAdapterType,
            });
          }}
        >
          {availableAdapters.map((adapter) => (
            <option key={adapter.type} value={adapter.type}>
              {adapter.label}
            </option>
          ))}
        </select>
        {selectedAdapter ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {getAdapterStatusText(selectedAdapter.type)}
          </div>
        ) : null}
      </label>

      <div className="rounded-xl border border-border/70 bg-card p-4">
        <AgentConfigForm
          mode="create"
          values={formValues}
          onChange={(patch) => setFormValues((previous) => (previous ? { ...previous, ...patch } : null))}
          hideInlineSave
          showAdapterTypeField={false}
          showAdapterTestEnvironmentButton={false}
          showCreateRunPolicySection={false}
          hideInstructionsFile
        />
      </div>

      {!formValues.model?.trim() ? (
        <div className="text-sm text-amber-600 dark:text-amber-400">
          Select a model before saving.
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Builder settings"}
        </Button>
      </div>
    </div>
  );
}
