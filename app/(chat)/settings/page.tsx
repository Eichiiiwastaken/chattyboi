"use client";

import {
  AlertTriangleIcon,
  BarChart3Icon,
  ChevronDownIcon,
  Copy,
  LeafIcon,
  MonitorIcon,
  MoonIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StarIcon,
  SunIcon,
  SunsetIcon,
  WavesIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { ModelPickerContent } from "@/components/chat/model-picker";
import { UsageDashboard } from "@/components/settings/usage-dashboard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MODELS_API_PATH } from "@/lib/ai/model-api";
import type { ChatModel, ModelCapabilities } from "@/lib/ai/models";

function ModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${MODELS_API_PATH}`,
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { revalidateOnFocus: false }
  );

  const dynamicModels: ChatModel[] | undefined = modelsData?.models;
  const capabilities: Record<string, ModelCapabilities> | undefined =
    modelsData?.capabilities ?? modelsData;
  const activeModels = dynamicModels ?? [];

  const selectedModel =
    activeModels.find((m: ChatModel) => m.id === selectedModelId) ??
    activeModels.find((m: ChatModel) => m.id === selectedModelId) ??
    activeModels[0];

  if (!selectedModel) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-amber-950 text-[13px] dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0">
          <p className="font-medium">No configured models</p>
          <p className="mt-0.5 text-amber-900/75 text-[12px] leading-5 dark:text-amber-100/75">
            Add OPENCODE_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, or
            AI_GATEWAY_API_KEY.
          </p>
        </div>
      </div>
    );
  }

  const provider = selectedModel.provider || selectedModel.id.split("/")[0];

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-8 w-full justify-between gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          variant="ghost"
        >
          {provider && <ModelSelectorLogo provider={provider} />}
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent
        className="w-[390px] overflow-visible"
        commandProps={{
          className: "overflow-visible p-0",
          shouldFilter: false,
        }}
      >
        <ModelPickerContent
          capabilities={capabilities}
          models={activeModels}
          onSelectModel={(modelId) => {
            onModelChange(modelId);
            setOpen(false);
          }}
          selectedModelId={selectedModel.id}
        />
      </ModelSelectorContent>
    </ModelSelector>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [origin, setOrigin] = useState("");
  const [activeTab, setActiveTab] = useState<"preferences" | "usage">(
    "preferences"
  );
  const { data: settings, mutate } = useSWR<{
    defaultSearchModel: string | null;
    webSearchEnabled: boolean;
    statsForNerds: boolean;
  }>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/settings`,
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false }
  );

  const [isSaving, setIsSaving] = useState(false);
  const [_, copyToClipboard] = useCopyToClipboard();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const updateSetting = useCallback(
    async (patch: {
      defaultSearchModel?: string;
      webSearchEnabled?: boolean;
      statsForNerds?: boolean;
    }) => {
      setIsSaving(true);
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/settings`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          }
        );
        if (!res.ok) {
          throw new Error("Failed to save settings");
        }
        const updated = await res.json();
        mutate(updated, false);
        toast.success("Settings saved");
      } catch {
        toast.error("Failed to save settings");
      } finally {
        setIsSaving(false);
      }
    },
    [mutate]
  );

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex items-center border-b border-border/40 px-4 py-3">
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>
      <div className="border-b border-border/40 px-4">
        <div className="mx-auto flex w-full max-w-6xl gap-1">
          <button
            className={`relative flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors ${activeTab === "preferences" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("preferences")}
            type="button"
          >
            <SlidersHorizontalIcon className="size-3.5" />
            Preferences
            {activeTab === "preferences" && (
              <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
            )}
          </button>
          <button
            className={`relative flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors ${activeTab === "usage" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab("usage")}
            type="button"
          >
            <BarChart3Icon className="size-3.5" />
            Usage
            {activeTab === "usage" && (
              <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
            )}
          </button>
        </div>
      </div>
      <div
        className={`mx-auto w-full flex-1 p-6 ${activeTab === "usage" ? "max-w-6xl" : "max-w-xl"}`}
      >
        {activeTab === "preferences" ? (
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Chat Preferences
              </h2>

              <div className="space-y-6 rounded-xl border border-border/40 bg-card/50 p-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[13px]" htmlFor="web-search-default">
                      Enable web search by default
                    </Label>
                    <Switch
                      checked={settings?.webSearchEnabled ?? false}
                      disabled={!settings || isSaving}
                      id="web-search-default"
                      onCheckedChange={(checked) =>
                        updateSetting({ webSearchEnabled: checked })
                      }
                    />
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    When starting a new chat, web search will be enabled
                    automatically.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[13px]" htmlFor="stats-for-nerds">
                      Show stats for nerds
                    </Label>
                    <Switch
                      checked={settings?.statsForNerds ?? false}
                      disabled={!settings || isSaving}
                      id="stats-for-nerds"
                      onCheckedChange={(checked) =>
                        updateSetting({ statsForNerds: checked })
                      }
                    />
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    Display token usage, latency, and model info under assistant
                    messages.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Appearance
              </h2>
              <div className="space-y-4 rounded-xl border border-border/40 bg-card/50 p-5">
                <div>
                  <Label className="text-[13px]">Theme</Label>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Choose the atmosphere that feels best to chat in.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      value: "system",
                      label: "System",
                      icon: MonitorIcon,
                      preview: "bg-gradient-to-br from-white to-neutral-900",
                    },
                    {
                      value: "light",
                      label: "Light",
                      icon: SunIcon,
                      preview: "bg-[#f7f7f6]",
                    },
                    {
                      value: "dark",
                      label: "Dark",
                      icon: MoonIcon,
                      preview: "bg-[#171717]",
                    },
                    {
                      value: "rose",
                      label: "Rosé",
                      icon: SparklesIcon,
                      preview:
                        "bg-[radial-gradient(circle_at_top_right,#71304e,#21141e_65%)]",
                    },
                    {
                      value: "ocean",
                      label: "Ocean",
                      icon: WavesIcon,
                      preview:
                        "bg-[radial-gradient(circle_at_top_right,#16899b,#0b1924_65%)]",
                    },
                    {
                      value: "forest",
                      label: "Forest",
                      icon: LeafIcon,
                      preview:
                        "bg-[radial-gradient(circle_at_top_right,#398b4d,#101b16_65%)]",
                    },
                    {
                      value: "sunset",
                      label: "Sunset",
                      icon: SunsetIcon,
                      preview:
                        "bg-[radial-gradient(circle_at_top_right,#c84f35,#21140f_65%)]",
                    },
                    {
                      value: "midnight",
                      label: "Midnight",
                      icon: StarIcon,
                      preview:
                        "bg-[radial-gradient(circle_at_top_right,#5664a8,#131522_65%)]",
                    },
                  ].map((option) => {
                    const Icon = option.icon;
                    const isSelected = (theme ?? "system") === option.value;

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={`group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                          isSelected
                            ? "border-primary/45 bg-primary/8 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground"
                        }`}
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        type="button"
                      >
                        <span
                          className={`relative flex size-9 shrink-0 items-center justify-center rounded-md border border-white/10 shadow-inner ${option.preview}`}
                        >
                          <Icon className="size-3.5 text-white drop-shadow-sm" />
                        </span>
                        <span className="text-[13px] font-medium">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Default Model for Bang URLs
              </h2>
              <div className="space-y-3 rounded-xl border border-border/40 bg-card/50 p-5">
                <div className="space-y-2">
                  <Label className="text-[13px]">
                    Default model used when starting a chat from a bang URL
                  </Label>
                  <ModelSelectorCompact
                    onModelChange={(modelId) =>
                      updateSetting({ defaultSearchModel: modelId })
                    }
                    selectedModelId={
                      settings?.defaultSearchModel ?? "opencodego/kimi-k2.6"
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Bang URLs
              </h2>
              <div className="space-y-3 rounded-xl border border-border/40 bg-card/50 p-5">
                <p className="text-[12px] text-muted-foreground">
                  Use these URLs as custom search engines or DuckDuckGo bangs to
                  start a chat from anywhere. The default model above applies
                  when a chat starts from either URL.
                </p>
                <div className="space-y-2">
                  <Label className="text-[13px]">Chat (no search)</Label>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
                      {`${origin}/?q=%s`}
                    </code>
                    <Button
                      onClick={async () => {
                        await copyToClipboard(
                          `${window.location.origin}/?q=%s`
                        );
                        toast.success("Copied to clipboard");
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px]">Chat with web search</Label>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
                      {`${origin}/?q=%s&search=true`}
                    </code>
                    <Button
                      onClick={async () => {
                        await copyToClipboard(
                          `${window.location.origin}/?q=%s&search=true`
                        );
                        toast.success("Copied to clipboard");
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px]">Chat with deep research</Label>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
                      {`${origin}/?q=%s&research=deep`}
                    </code>
                    <Button
                      onClick={async () => {
                        await copyToClipboard(
                          `${window.location.origin}/?q=%s&research=deep`
                        );
                        toast.success("Copied to clipboard");
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <UsageDashboard />
        )}
      </div>
    </div>
  );
}
