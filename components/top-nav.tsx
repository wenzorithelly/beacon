"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/map", label: "Mapa" },
  { href: "/db", label: "Banco" },
  { href: "/health", label: "Saúde" },
  { href: "/sessions", label: "Sessões" },
  { href: "/list", label: "Lista" },
  { href: "/bugs", label: "Bugs" },
  { href: "/settings", label: "Config" },
];

export function TopNav({ repo }: { repo?: string }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-white/10 bg-background/30 px-4 backdrop-blur-xl">
      <Link href="/" className="mr-4 flex items-center gap-2 font-semibold tracking-tight">
        <span className="inline-block size-2.5 rounded-full bg-[var(--accent-2,#ff7a45)]" />
        Beacon
        {repo && <span className="font-mono text-xs text-muted-foreground">· {repo}</span>}
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
