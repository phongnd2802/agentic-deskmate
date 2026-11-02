"use client";

import { CircleAlert, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

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
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Ask the backend for a link and show it once; the Admin hands it over, nothing is sent. */
  async function create(path: string, page: "invite" | "reset", body: object | undefined, forEmail: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/backend/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body && JSON.stringify(body),
      });
      if (!response.ok) {
        const code = (await response.json().catch(() => null))?.detail?.code;
        return setError(code && t.has(`error.${code}`) ? t(`error.${code}`) : t("error.linkFailed"));
      }
      const link = (await response.json()) as { token: string; expires_at: string };
      setCreated({ email: forEmail, url: `${window.location.origin}/${page}/${link.token}`, expires: new Date(link.expires_at).toLocaleString() });
      if (page === "invite") setEmail("");
    } catch {
      setError(t("error.linkFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TooltipProvider>
      <h2 className="text-lg font-medium">{t("users")}</h2>
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
          <Input id="invite-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby="invite-help" />
          <Button type="submit" disabled={busy} className="shrink-0">
            {busy ? t("inviting") : t("invite")}
          </Button>
        </div>
        <p id="invite-help" className="text-xs text-muted-foreground">{t("inviteHelp")}</p>
      </form>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {created && (
        <Card size="sm">
          <CardContent className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="created-link">{t("linkFor", { email: created.email })}</Label>
              <Button type="button" variant="ghost" size="icon" aria-label={t("linkDismiss")} onClick={() => setCreated(null)}>
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="created-link" readOnly className="font-mono" value={created.url} onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" className="shrink-0" onClick={() => void navigator.clipboard?.writeText(created.url)}>
                {t("linkCopy")}
              </Button>
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
