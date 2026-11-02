"use client";

import { Check, CircleAlert, Copy, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { OrganizationUser } from "@/lib/backend";

type Created = { email: string; url: string; expires: string };

export function UsersSettings({ users }: { users: OrganizationUser[] }) {
  const t = useTranslations("settings");
  const format = useFormatter();
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<{ field: "invite" | "link"; message: string } | null>(null);
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  /** Ask the backend for a link and show it once; the Admin hands it over, nothing is sent. */
  async function create(path: string, page: "invite" | "reset", body: object | undefined, forEmail: string) {
    const field = page === "invite" ? "invite" : "link";
    setBusy(true);
    setError(null);
    setCopy(null);
    try {
      const response = await fetch(`/api/backend/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body && JSON.stringify(body),
      });
      if (!response.ok) {
        const code = (await response.json().catch(() => null))?.detail?.code;
        return setError({ field, message: code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.linkFailed") });
      }
      const link = (await response.json()) as { token: string; expires_at: string };
      setCreated({ email: forEmail, url: `${window.location.origin}/${page}/${link.token}`, expires: format.dateTime(new Date(link.expires_at), { dateStyle: "medium", timeStyle: "short" }) });
      if (page === "invite") setEmail("");
    } catch {
      setError({ field, message: t("error.linkFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      // No clipboard (plain HTTP) or refused: the link is selectable, so the Admin can copy it by hand.
      setCopy("failed");
    }
  }

  const inviteError = error?.field === "invite" ? error.message : undefined;

  return (
    <TooltipProvider>
      <h2 className="text-xl font-medium">{t("users")}</h2>
      <form
        className="flex flex-col gap-1"
        aria-label={t("inviteTitle")}
        onSubmit={(event) => {
          event.preventDefault();
          void create("invitations", "invite", { email }, email);
        }}
      >
        <Label htmlFor="invite-email">{t("inviteEmail")}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="invite-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!inviteError} aria-describedby={inviteError ? "invite-help invite-error" : "invite-help"} />
          <Button type="submit" variant="outline" disabled={busy} className="shrink-0">
            {busy ? t("inviting") : t("invite")}
          </Button>
        </div>
        <p id="invite-help" className="text-xs text-muted-foreground">{t("inviteHelp")}</p>
        {inviteError && (
          <p id="invite-error" role="alert" className="flex items-start gap-2 text-xs text-destructive">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {inviteError}
          </p>
        )}
      </form>

      {error?.field === "link" && (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error.message}
        </p>
      )}

      {created && (
        <Card size="sm">
          <CardContent className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="created-link">{t("linkFor", { email: created.email })}</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("linkDismiss")} onClick={() => setCreated(null)}>
                    <X aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("linkDismiss")}</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="created-link" readOnly className="font-mono" value={created.url} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" className="shrink-0" onClick={() => void copyLink(created.url)}>
                {copy === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copy === "copied" ? t("linkCopied") : t("linkCopy")}
              </Button>
            </div>
            <div role="status">
              {copy === "failed" && (
                <p className="flex items-start gap-2 text-xs text-destructive">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {t("copyFailed")}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("linkExpires", { date: created.expires })}</p>
          </CardContent>
        </Card>
      )}

      <Table aria-label={t("users")}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("email")}</TableHead>
            <TableHead>{t("role")}</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id} className="pointer-coarse:min-h-11">
              <TableCell className="text-sm font-medium">{user.email}</TableCell>
              <TableCell className="text-sm">{t(`roles.${user.role}`)}</TableCell>
              <TableCell>
                <div className="flex justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={t("resetNamed", { name: user.email })}
                        onClick={() => void create(`users/${user.id}/password-reset`, "reset", undefined, user.email)}
                      >
                        <KeyRound aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("resetNamed", { name: user.email })}</TooltipContent>
                  </Tooltip>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
