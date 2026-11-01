"use client";

import { CircleAlert, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Provider } from "@/lib/backend";

type Draft = {
  name: string;
  api_type: Provider["api_type"];
  base_url: string;
  api_key: string;
  models: { model_id: string; generative_ui: boolean }[];
};
type Field = "name" | "baseUrl" | "apiKey" | "form";

const blank: Draft = { name: "", api_type: "openai", base_url: "", api_key: "", models: [{ model_id: "", generative_ui: false }] };

// Which field the backend's error code belongs under; any other code reads as a failure of the form.
const FIELD_OF: Record<string, Field> = {
  name_taken: "name",
  blocked_address: "baseUrl",
  invalid_base_url: "baseUrl",
  key_required: "apiKey",
};

/** The error code the backend sent, which the interface translates. */
async function errorCode(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.detail?.code === "string" ? body.detail.code : "generic";
}

/** An icon-only button: its name is the aria-label, shown to everyone else as a tooltip. */
function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="flex items-start gap-2 text-xs text-destructive">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}

function ProviderForm({ provider, onDone }: { provider: Provider | null; onDone: () => void }) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(
    provider
      ? { ...provider, api_key: "", models: provider.models.map(({ model_id, generative_ui }) => ({ model_id, generative_ui })) }
      : blank,
  );
  const [error, setError] = useState<{ field: Field; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const setModel = (index: number, change: Partial<Draft["models"][number]>) =>
    set({ models: draft.models.map((model, i) => (i === index ? { ...model, ...change } : model)) });
  const errorOf = (field: Field) => (error?.field === field ? error.message : undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(provider ? `/api/backend/providers/${provider.id}` : "/api/backend/providers", {
        method: provider ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, models: draft.models.filter((model) => model.model_id.trim()) }),
      });
      if (!response.ok) {
        const code = await errorCode(response);
        setError({ field: FIELD_OF[code] ?? "form", message: t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic") });
        return;
      }
      router.refresh();
      onDone();
    } catch {
      setError({ field: "form", message: t("error.generic") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label={provider ? t("editProvider") : t("addProvider")}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-name">{t("name")}</Label>
            <Input
              id="provider-name"
              required
              value={draft.name}
              aria-invalid={!!errorOf("name")}
              aria-describedby="provider-name-error"
              onChange={(e) => set({ name: e.target.value })}
            />
            <FieldError id="provider-name-error" message={errorOf("name")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-type">{t("apiType")}</Label>
            <Select id="provider-type" value={draft.api_type} onChange={(e) => set({ api_type: e.target.value as Draft["api_type"] })}>
              <option value="openai">{t("apiTypes.openai")}</option>
              <option value="anthropic">{t("apiTypes.anthropic")}</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-url">{t("baseUrl")}</Label>
            <Input
              id="provider-url"
              type="url"
              required
              placeholder={t("baseUrlPlaceholder")}
              value={draft.base_url}
              aria-invalid={!!errorOf("baseUrl")}
              aria-describedby="provider-url-error"
              onChange={(e) => set({ base_url: e.target.value })}
            />
            <FieldError id="provider-url-error" message={errorOf("baseUrl")} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="provider-key">{t("apiKey")}</Label>
            <Input
              id="provider-key"
              type="password"
              autoComplete="off"
              required={!provider}
              aria-invalid={!!errorOf("apiKey")}
              aria-describedby="provider-key-help provider-key-error"
              value={draft.api_key}
              onChange={(e) => set({ api_key: e.target.value })}
            />
            <p id="provider-key-help" className="text-xs text-muted-foreground">
              {provider ? t("apiKeyKeep") : t("apiKeyStored")}
            </p>
            <FieldError id="provider-key-error" message={errorOf("apiKey")} />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("models")}</legend>
            <div className="flex gap-2 text-xs font-medium text-muted-foreground">
              <span id="model-id-heading" className="flex-1">
                {t("modelId")}
              </span>
              <span className="w-24 text-center">{t("generativeUi")}</span>
              <span className="w-8 shrink-0" />
            </div>
            {draft.models.map((model, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-labelledby="model-id-heading"
                  className="font-mono"
                  value={model.model_id}
                  onChange={(e) => setModel(index, { model_id: e.target.value })}
                />
                <div className="flex w-24 shrink-0 justify-center">
                  <input
                    type="checkbox"
                    aria-label={`${t("generativeUi")} ${model.model_id}`}
                    className="size-6 shrink-0 accent-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11"
                    checked={model.generative_ui}
                    onChange={(e) => setModel(index, { generative_ui: e.target.checked })}
                  />
                </div>
                <IconButton
                  label={t("removeModel")}
                  disabled={draft.models.length === 1}
                  onClick={() => set({ models: draft.models.filter((_, i) => i !== index) })}
                >
                  <X aria-hidden />
                </IconButton>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => set({ models: [...draft.models, { model_id: "", generative_ui: false }] })}
            >
              <Plus aria-hidden />
              {t("addModel")}
            </Button>
          </fieldset>
          <FieldError id="provider-form-error" message={errorOf("form")} />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? t("saving") : t("save")}
            </Button>
            <Button type="button" variant="outline" onClick={onDone}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ProvidersSettings({ providers }: { providers: Provider[] }) {
  const t = useTranslations("settings");
  const router = useRouter();
  // "new" opens an empty form, a Provider opens it for editing.
  const [editing, setEditing] = useState<Provider | "new" | null>(null);
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);

  async function remove(provider: Provider) {
    setDeleteFailed(false);
    const response = await fetch(`/api/backend/providers/${provider.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok && response?.status !== 404) return setDeleteFailed(true);
    setDeleting(null);
    router.refresh();
  }

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button disabled={editing !== null} onClick={() => setEditing("new")}>
          <Plus aria-hidden />
          {t("addProvider")}
        </Button>
      </div>

      {editing !== null && (
        <ProviderForm
          key={editing === "new" ? "new" : editing.id}
          provider={editing === "new" ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}

      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table aria-label={t("providers")}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("apiType")}</TableHead>
              <TableHead>{t("baseUrl")}</TableHead>
              <TableHead>{t("models")}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.id} className="pointer-coarse:min-h-11">
                <TableCell className="text-sm font-medium">{provider.name}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{t(`apiTypes.${provider.api_type}`)}</TableCell>
                <TableCell className="max-w-48 truncate font-mono text-xs">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        className="block truncate rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {provider.base_url}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="font-mono">{provider.base_url}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {provider.models
                    .map((model) => (model.generative_ui ? `${model.model_id} (${t("generativeUi")})` : model.model_id))
                    .join(", ")}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconButton label={t("editNamed", { name: provider.name })} onClick={() => setEditing(provider)}>
                      <Pencil aria-hidden />
                    </IconButton>
                    <IconButton
                      label={t("deleteNamed", { name: provider.name })}
                      onClick={() => {
                        setDeleteFailed(false);
                        setDeleting(provider);
                      }}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle", { name: deleting?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("deleteBody")}</DialogDescription>
          </DialogHeader>
          <FieldError id="provider-delete-error" message={deleteFailed ? t("error.deleteFailed") : undefined} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => deleting && remove(deleting)}>
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
