import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, Panel } from "@/components/dashboard/ui";
import { DEFAULT_AGENT, validateAgent, type AgentConfig } from "@/lib/dashboard/agent";
import { useWorkspace } from "@/lib/dashboard/workspace";
import { RetentionWorkflow } from "@/components/dashboard/retention";

export const Route = createFileRoute("/_authenticated/dashboard/agent-studio")({
  head: () => ({
    meta: [
      { title: "AI Agent Studio · RETAIN.AI" },
      {
        name: "description",
        content:
          "Configure your retention agent's personality, brand voice, offer limits and escalation rules.",
      },
      { property: "og:title", content: "AI Agent Studio · RETAIN.AI" },
      { property: "og:description", content: "Configure your retention agent." },
    ],
  }),
  component: AgentStudio,
});

function AgentStudio() {
  const { merchantId } = useWorkspace();
  const key = `retain.agentDraft.${merchantId}`;
  const [cfg, setCfg] = useState<AgentConfig>(DEFAULT_AGENT);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        setCfg({ ...DEFAULT_AGENT, ...JSON.parse(raw) });
        setSaved(true);
      }
    } catch {
      /* ignore corrupt draft */
    }
  }, [key]);
  const errors = validateAgent(cfg);
  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
  };
  function save() {
    if (Object.keys(errors).length) return;
    localStorage.setItem(key, JSON.stringify(cfg));
    setSaved(true);
    toast.success("Draft saved on this device", {
      description: "It will not be used by the agent until backend validation is live.",
    });
  }
  return (
    <>
      <PageHeader
        title="AI Agent Studio"
        description="Shape how your agent talks to customers who want to cancel."
        actions={
          <>
            <span className="text-xs text-muted-foreground">
              {saved ? "Draft saved" : "Unsaved changes"}
            </span>
            <Button onClick={save} disabled={Object.keys(errors).length > 0 || saved}>
              Save draft
            </Button>
          </>
        }
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 px-4 py-3 text-xs text-warning">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        These settings are a draft stored in this browser only. They do not authorize any discount,
        refund or payment. Every financial action will be validated on the server in a later phase.
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Identity" description="Who customers talk to">
          <div className="space-y-4">
            <Field id="name" label="Agent name" error={errors.name}>
              <Input
                id="name"
                value={cfg.name}
                maxLength={40}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field id="personality" label="Personality">
              <Select
                value={cfg.personality}
                onValueChange={(v) => set("personality", v as AgentConfig["personality"])}
              >
                <SelectTrigger id="personality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Warm & empathetic", "Calm & concise", "Upbeat & friendly", "Professional"].map(
                    (p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="website"
              label="Merchant website"
              error={errors.website}
              hint="Used later to learn your products and policies."
            >
              <Input
                id="website"
                type="url"
                placeholder="https://yourstore.com"
                value={cfg.website}
                onChange={(e) => set("website", e.target.value)}
              />
            </Field>
            <Field id="voice" label="Brand voice" error={errors.brandVoice}>
              <Textarea
                id="voice"
                rows={4}
                maxLength={600}
                value={cfg.brandVoice}
                onChange={(e) => set("brandVoice", e.target.value)}
                placeholder="e.g. Friendly, never pushy. Use first names. Avoid jargon."
              />
            </Field>
          </div>
        </Panel>
        <Panel title="Offer guardrails" description="Limits the agent must stay within">
          <div className="space-y-6">
            <SliderField
              label="Maximum automated discount"
              value={cfg.maxDiscount}
              suffix="%"
              max={50}
              step={5}
              onChange={(v) => set("maxDiscount", v)}
            />
            <SliderField
              label="Maximum offers per session"
              value={cfg.maxOffers}
              max={5}
              min={1}
              onChange={(v) => set("maxOffers", v)}
            />
            <SliderField
              label="Escalate when customer value exceeds"
              value={cfg.escalateAbove}
              prefix="$"
              max={1000}
              step={50}
              onChange={(v) => set("escalateAbove", v)}
            />
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="approval">Require human approval</Label>
                <p className="text-xs text-muted-foreground">
                  Any offer above the discount limit waits for you in the Escalation Center.
                </p>
              </div>
              <Switch
                id="approval"
                checked={cfg.requireApproval}
                onCheckedChange={(v) => set("requireApproval", v)}
              />
            </div>
          </div>
        </Panel>
      </div>
      <RetentionWorkflow merchantId={merchantId} />
    </>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
function SliderField({
  label,
  value,
  onChange,
  max,
  min = 0,
  step = 1,
  prefix = "",
  suffix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max: number;
  min?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div>
      <div className="mb-3 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-violet">
          {prefix}
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v ?? value)}
        aria-label={label}
      />
    </div>
  );
}
