import Link from "next/link";

type NavItem = { href: string; label: string };

export function Sidebar({ name, navLabel, items }: { name: string; navLabel: string; items: NavItem[] }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-muted/40 p-4">
      <div className="mb-6 px-3 text-base font-semibold">{name}</div>
      <nav aria-label={navLabel}>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
