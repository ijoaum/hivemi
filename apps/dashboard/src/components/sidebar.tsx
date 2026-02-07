"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Agents", icon: "👥" },
  { href: "/tasks", label: "Tasks", icon: "📋" },
  { href: "/roles", label: "Roles", icon: "🎭" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
  { href: "/logs", label: "Logs", icon: "📜" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen p-4 flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-2 py-4 mb-6">
        <Image
          src="/logo.png"
          alt="HiveMI"
          width={40}
          height={40}
          className="rounded-lg"
        />
        <div>
          <h1 className="text-xl font-semibold" style={{ fontFamily: 'var(--font-quicksand)' }}>hivemi</h1>
          <p className="text-xs text-gray-400">Hive Mesh Intelligence</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                isActive
                  ? "bg-amber-500/20 text-amber-400"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <span>{item.icon}</span>
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="pt-4 border-t border-gray-800">
        <div className="px-3 py-2 text-xs text-gray-500">
          <p>Cluster: <span className="text-gray-400">local-dev</span></p>
          <p>Version: <span className="text-gray-400">0.1.0</span></p>
        </div>
      </div>
    </aside>
  );
}
