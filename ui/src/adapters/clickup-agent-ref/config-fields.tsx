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

function readSelectSchemaValue(props: AdapterConfigFieldsProps, key: string, fallback: string): string {
  const value = readSchemaValue(props, key);
  return value || fallback;
}

export function ClickUpAgentRefConfigFields(props: AdapterConfigFieldsProps) {
  const triggerMode = readSelectSchemaValue(props, "triggerMode", "api_comment_only");

  return (
    <div className="space-y-3">
      <Field label="ClickUp token">
        <DraftInput
          value={props.isCreate ? props.values?.apiKey ?? "" : props.eff("adapterConfig", "authToken", "")}
          onCommit={(value) =>
            props.isCreate
              ? props.set?.({ apiKey: value })
              : props.mark("adapterConfig", "authToken", value || undefined)
          }
          immediate
          className={inputClass}
          placeholder={props.isCreate ? "pk_... or OAuth token" : "Leave blank to keep the existing token"}
          type="password"
        />
      </Field>

      <Field label="Workspace ID">
        <DraftInput
          value={readSchemaValue(props, "workspaceId")}
          onCommit={(value) => writeSchemaValue(props, "workspaceId", value)}
          immediate
          className={inputClass}
          placeholder="90123456"
        />
      </Field>

      <Field label="List ID">
        <DraftInput
          value={readSchemaValue(props, "listId")}
          onCommit={(value) => writeSchemaValue(props, "listId", value)}
          immediate
          className={inputClass}
          placeholder="901234567890"
        />
      </Field>

      <Field label="ClickUp agent name">
        <DraftInput
          value={readSchemaValue(props, "clickupAgentName")}
          onCommit={(value) => writeSchemaValue(props, "clickupAgentName", value)}
          immediate
          className={inputClass}
          placeholder="Customer Support Triage Agent"
        />
      </Field>

      <Field label="ClickUp agent user ID">
        <DraftInput
          value={readSchemaValue(props, "clickupAgentUserId")}
          onCommit={(value) => writeSchemaValue(props, "clickupAgentUserId", value)}
          immediate
          className={inputClass}
          placeholder="123456"
        />
      </Field>

      <Field label="ClickUp agent URL">
        <DraftInput
          value={readSchemaValue(props, "clickupAgentUrl")}
          onCommit={(value) => writeSchemaValue(props, "clickupAgentUrl", value)}
          immediate
          className={inputClass}
          placeholder="https://app.clickup.com/..."
        />
      </Field>

      <Field label="Trigger mode">
        <select
          value={triggerMode}
          onChange={(event) => writeSchemaValue(props, "triggerMode", event.target.value)}
          className={inputClass}
        >
          <option value="api_comment_only">API sync only</option>
          <option value="automation_trigger">Trigger via ClickUp Automation</option>
        </select>
      </Field>

      {triggerMode === "automation_trigger" ? (
        <>
          <Field label="Automation status">
            <DraftInput
              value={readSchemaValue(props, "automationStatus")}
              onCommit={(value) => writeSchemaValue(props, "automationStatus", value)}
              immediate
              className={inputClass}
              placeholder="ai_intake"
            />
          </Field>

          <Field label="Automation tags">
            <DraftInput
              value={readSchemaValue(props, "automationTags")}
              onCommit={(value) => writeSchemaValue(props, "automationTags", value)}
              immediate
              className={inputClass}
              placeholder="bizbox, trigger-risk-witherspoon"
            />
          </Field>

          <p className="text-xs text-muted-foreground">
            Configure a native ClickUp Automation to trigger the Super Agent when tasks are created in this List
            or when the configured status/tags are applied.
          </p>
        </>
      ) : null}

      <Field label="Channel ID">
        <DraftInput
          value={readSchemaValue(props, "channelId")}
          onCommit={(value) => writeSchemaValue(props, "channelId", value)}
          immediate
          className={inputClass}
          placeholder="Optional future chat routing target"
        />
      </Field>

      <Field label="API base URL">
        <DraftInput
          value={readSchemaValue(props, "apiBaseUrl")}
          onCommit={(value) => writeSchemaValue(props, "apiBaseUrl", value)}
          immediate
          className={inputClass}
          placeholder="https://api.clickup.com/api/v2"
        />
      </Field>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={readBooleanSchemaValue(props, "includeContextJson", true)}
          onChange={(event) => writeBooleanSchemaValue(props, "includeContextJson", event.target.checked)}
        />
        Include structured Bizbox context JSON in the task body/comment
      </label>
    </div>
  );
}
