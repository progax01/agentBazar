"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const links = [
  { href: "/",          label: "Home"     },
  { href: "/analyze",   label: "Analyze"  },
  { href: "/tasks/new", label: "New Task" },
  { href: "/services",  label: "Services" },
  { href: "/payments",  label: "Payments" },
  { href: "/agents",    label: "Agents"   },
];

export function NavBar() {
  const path = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#030712]/80 backdrop-blur-xl">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-2">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 mr-4 flex-shrink-0 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-sky-500/25">
            <span className="text-white text-[11px] font-black leading-none">A</span>
          </div>
          <span className="font-bold text-white text-sm tracking-tight group-hover:text-sky-300 transition-colors">
            AgentBazar
          </span>
        </Link>

        {/* Links */}
        <div className="flex items-center gap-0.5">
          {links.map((l) => {
            const active = l.href === "/"
              ? path === "/"
              : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={clsx(
                  "relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "text-white bg-slate-800"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60",
                )}
              >
                {l.label}
                {active && (
                  <span className="absolute bottom-0 left-3 right-3 h-px bg-gradient-to-r from-sky-500 to-violet-500 rounded-full" />
                )}
              </Link>
            );
          })}
        </div>

        {/* Right side — live indicator */}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-slate-800 border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            Arc Testnet
          </span>
        </div>
      </nav>
    </header>
  );
}
