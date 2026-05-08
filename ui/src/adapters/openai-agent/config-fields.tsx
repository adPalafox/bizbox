import type { AdapterConfigFieldsProps } from "../types";
import { Field, DraftInput } from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

type SchemaValues = Record<string, unknown>;

function readSchemaValue(props: AdapterConfigFieldsProps, key: string): string {
  if (props.isCreate) {
    const values = (props.values?.adapterSchemaValues ?? {}) as SchemaValues;
    const value = values[key];
    return typeof value === "string" ? value : "";
  }
  return props.eff("adapterConfig", key, String(props.config[key] ?? ""));
}

function writeSchemaValue(props: AdapterConfigFieldsProps, key: string, value: string): void {
  if (props.isCreate) {
    props.set?.({
      adapterSchemaValues: {
        ...(props.values?.adapterSchemaValues ?? {}),
        [key]: value,
      },
    });
    return;
  }
  props.mark("adapterConfig", key, value || undefined);
}

function readBooleanSchemaValue(props: AdapterConfigFieldsProps, key: string, fallback: boolean): boolean {
  if (props.isCreate) {
    const values = (props.values?.adapterSchemaValues ?? {}) as SchemaValues;
    return typeof values[key] === "boolean" ? (values[key] as boolean) : fallback;
  }
  return props.eff("adapterConfig", key, fallback);
}

function writeBooleanSchemaValue(props: AdapterConfigFieldsProps, key: string, value: boolean): void {
  if (props.isCreate) {
    props.set?.({
      adapterSchemaValues: {
        ...(props.values?.adapterSchemaValues ?? {}),
        [key]: value,
      },
    });
    return;
  }
  props.mark("adapterConfig", key, value);
}

export function OpenAiAgentConfigFields(props: AdapterConfigFieldsProps) {
  return (
    <div className="space-y-3">
      <Field label="OpenAI API key">
        <DraftInput
          value={props.isCreate ? props.values?.apiKey ?? "" : props.eff("adapterConfig", "authToken", "")}
          onCommit={(value) =>
            props.isCreate
              ? props.set?.({ apiKey: value })
              : props.mark("adapterConfig", "authToken", value || undefined)
          }
          immediate
          className={inputClass}
          placeholder={props.isCreate ? "sk-..." : "Leave blank to keep the existing token"}
          type="password"
        />
      </Field>

      <Field label="Model">
        <DraftInput
          value={props.isCreate ? props.values?.model ?? "gpt-5" : props.eff("adapterConfig", "model", "gpt-5")}
          onCommit={(value) =>
            props.isCreate
              ? props.set?.({ model: value })
              : props.mark("adapterConfig", "model", value || undefined)
          }
          immediate
          className={inputClass}
          placeholder="gpt-5"
        />
      </Field>

      <Field label="Workflow instruction">
        <DraftInput
          value={readSchemaValue(props, "workflowInstruction")}
          onCommit={(value) => writeSchemaValue(props, "workflowInstruction", value)}
          immediate
          className={inputClass}
          placeholder="Stable instruction sent on every OpenAI run"
        />
      </Field>

      <Field label="Reasoning effort">
        <DraftInput
          value={readSchemaValue(props, "reasoningEffort")}
          onCommit={(value) => writeSchemaValue(props, "reasoningEffort", value)}
          immediate
          className={inputClass}
          placeholder="low | medium | high"
        />
      </Field>

      <Field label="Studio URL">
        <DraftInput
          value={readSchemaValue(props, "studioUrl")}
          onCommit={(value) => writeSchemaValue(props, "studioUrl", value)}
          immediate
          className={inputClass}
          placeholder="https://chatgpt.com/agents/..."
        />
      </Field>

      <Field label="API base URL">
        <DraftInput
          value={readSchemaValue(props, "apiBaseUrl")}
          onCommit={(value) => writeSchemaValue(props, "apiBaseUrl", value)}
          immediate
          className={inputClass}
          placeholder="https://api.openai.com/v1"
        />
      </Field>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={readBooleanSchemaValue(props, "includeContextJson", true)}
          onChange={(event) => writeBooleanSchemaValue(props, "includeContextJson", event.target.checked)}
        />
        Include structured Bizbox context JSON in the request body
      </label>
    </div>
  );
}
