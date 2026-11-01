"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ReactNode };

export function Sidebar({ name, navLabel, items }: { name: string; navLabel: string; items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground">
      <div className="mb-2 flex h-8 items-center px-2 text-sm font-semibold">{name}</div>
      <nav aria-label={navLabel}>
        <ul className="space-y-0.5">
          {items.map((item) => {
            const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:min-h-11 [&_svg]:size-4",
                    current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
