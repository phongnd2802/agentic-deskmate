"use client";

import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm() {
  const t = useTranslations("signIn");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/backend/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        router.replace("/chat");
        router.refresh();
        return;
      }
      if (response.status === 401) setError(t("invalid"));
      else setError(t("error"));
    } catch {
      setError(t("error"));
    } finally {
      setSubmitting(false);
    }
  }

  const errorProps = { "aria-invalid": error !== null, "aria-describedby": error ? "sign-in-error" : undefined };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card size="sm" className="w-full max-w-sm">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-lg">{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="space-y-2">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                {...errorProps}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                {...errorProps}
              />
            </div>
            {error ? (
              <p id="sign-in-error" className="flex items-center gap-1 text-xs text-destructive" role="alert">
                <CircleAlert aria-hidden className="size-4 shrink-0" />
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t("submitting") : t("submit")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("noRegistration")}</p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
