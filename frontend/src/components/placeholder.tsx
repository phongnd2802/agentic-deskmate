import Link from "next/link";

import { Button } from "@/components/ui/button";

export function Placeholder({ title, description, note, back }: { title: string; description: string; note: string; back: string }) {
  return (
    <section className="mx-auto max-w-xl space-y-4 p-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">{note}</p>
      <Button asChild variant="outline">
        <Link href="/chat">{back}</Link>
      </Button>
    </section>
  );
}
