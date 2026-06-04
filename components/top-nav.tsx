"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/map", label: "Mapa" },
  { href: "/db", label: "Banco" },
  { href: "/list", label: "Lista" },
  { href: "/bugs", label: "Bugs" },
  { href: "/settings", label: "Config" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b border-border bg-background/80 px-4 backdrop-blur">
      <Link href="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
        <span className="inline-block size-2.5 rounded-full bg-[var(--accent-2,#ff7a45)]" />
        Juriscan <span className="text-muted-foreground">Control</span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {LINKS.map((l) => {
          const active = pathname === l.href || pathname.startsWith(l.href + "/");
          return (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
