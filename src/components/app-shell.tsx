import Link from "next/link";

import { cn } from "@/lib/utils";

export function AppShell({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              WAN Composer
            </Link>
            {subtitle ? (
              <span className="text-muted-foreground text-xs">{subtitle}</span>
            ) : null}
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/" className="hover:underline">
              Projects
            </Link>
            <Link href="/settings" className="hover:underline">
              Settings
            </Link>
          </nav>
        </div>
      </header>
      <main className={cn("mx-auto max-w-7xl px-4 py-6")}>{children}</main>
    </div>
  );
}
