"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The page a signed-out person reaches from an Invitation or password reset link. */
export function AccessLinkForm({
  kind,
  token,
  email,
  organization,
  problem,
}: {
  kind: "invitations" | "password-resets";
  token: string;
  email?: string;
  organization?: string;
  /** The error code from the backend when the link cannot be used. */
  problem?: string;
}) {
  const t = useTranslations("accessLink");
  const invitation = kind === "invitations";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(problem ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const message = (code: string) => (t.has(`error.${code}`) ? t(`error.${code}`) : t("error.generic"));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/backend/${kind}/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) return setDone(true);
      const body = await response.json().catch(() => null);
      setError(message(typeof body?.detail?.code === "string" ? body.detail.code : "generic"));
    } catch {
      setError(message("generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card size="sm" className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-lg">
            {problem ? t("problemTitle") : invitation ? t("invitationTitle", { organization: organization ?? "" }) : t("resetTitle")}
          </CardTitle>
          {!problem && !done && (
            <CardDescription>{invitation ? t("invitationDescription", { email: email ?? "" }) : t("resetDescription", { email: email ?? "" })}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {problem ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {message(problem)}
            </p>
          ) : done ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="flex items-start gap-2 text-sm text-success">
                <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
                {invitation ? t("doneInvitation", { email: email ?? "" }) : t("doneReset", { email: email ?? "" })}
              </p>
              <Button asChild>
                <Link href="/sign-in">{t("signIn")}</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-password">{t("password")}</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-invalid={error !== null}
                  aria-describedby={error ? "new-password-help new-password-error" : "new-password-help"}
                />
                <p id="new-password-help" className="text-xs text-muted-foreground">{t("passwordHelp")}</p>
              </div>
              {error ? (
                <p id="new-password-error" className="flex items-start gap-2 text-xs text-destructive" role="alert">
                  <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? t("submitting") : t("submit")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
