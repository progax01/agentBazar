"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

const links = [
  { href: "/",           label: "Dashboard" },
  { href: "/tasks/new",  label: "New Task" },
  { href: "/agents",     label: "Agents" },
];

export function NavBar() {
  const path = usePathname();
  return (
    <nav className="border-b border-gray-800 bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 flex items-center gap-6 h-14">
        <Link href="/" className="text-brand-500 font-bold text-lg tracking-tight">
          AgentBazar
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={clsx(
              "text-sm font-medium transition-colors",
              path === l.href
                ? "text-white"
                : "text-gray-400 hover:text-white",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
