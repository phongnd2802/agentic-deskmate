"use client";

import { LogOut, User as UserIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** Shared with the Conversation list, which sits in the same sidebar family. */
export const navLinkClass = (current: boolean) =>
  cn(
    "flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring pointer-coarse:min-h-11 [&_svg]:size-4",
    current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
  );

type NavItem = { href: string; label: string; icon: React.ReactNode };

export function Sidebar({
  name,
  navLabel,
  items,
  user,
  settings,
}: {
  name: string;
  navLabel: string;
  items: NavItem[];
  user: { email: string };
  /** Only Admins get this; the backend refuses everyone else anyway. */
  settings?: NavItem;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("userMenu");

  async function signOut() {
    await fetch("/api/backend/auth/sign-out", { method: "POST" });
    router.replace("/sign-in");
    router.refresh();
  }

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
                  className={navLinkClass(current)}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto space-y-0.5 pt-2">
        {settings && (
          <Link
            href={settings.href}
            aria-current={pathname.startsWith(settings.href) ? "page" : undefined}
            className={navLinkClass(pathname.startsWith(settings.href))}
          >
            {settings.icon}
            {settings.label}
          </Link>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              aria-label={t("menuLabel")}
              className="w-full justify-start px-2 font-normal hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <UserIcon aria-hidden />
              <span className="truncate">{user.email}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut}>
              <LogOut aria-hidden className="size-4" />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}