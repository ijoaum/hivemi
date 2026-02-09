"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { 
  Users, 
  ClipboardList, 
  Theater, 
  Settings, 
  ScrollText,
  Menu,
  X,
  Network,
  Sun,
  Moon,
  Loader2
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";

const navItems = [
  { href: "/", label: "Agents", icon: Users },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/teams", label: "Teams", icon: Network },
  { href: "/roles", label: "Roles", icon: Theater },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/logs", label: "Logs", icon: ScrollText },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const prevPathname = React.useRef(pathname);

  // Clear navigating state when route changes
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      setNavigatingTo(null);
      if (onClose) onClose();
    }
    prevPathname.current = pathname;
  }, [pathname, onClose]);

  const handleNavClick = useCallback((href: string) => {
    if (href !== pathname) {
      setNavigatingTo(href);
    }
  }, [pathname]);

  return (
    <>
      {/* Overlay - mobile only */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <aside className={cn(
        "bg-gray-900 text-white min-h-screen p-4 flex flex-col z-50",
        // Mobile: fixed overlay, slides in
        "fixed inset-y-0 left-0 w-64 transform transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full",
        // Desktop: static, always visible
        "md:static md:translate-x-0"
      )}>
        {/* Close button - mobile only */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white md:hidden"
        >
          <X className="w-5 h-5" />
        </button>

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
            const isNavigating = navigatingTo === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => handleNavClick(item.href)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150",
                  isActive
                    ? "bg-amber-500/20 text-amber-400"
                    : isNavigating
                    ? "bg-amber-500/10 text-amber-300 scale-[0.98]"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                )}
              >
                {isNavigating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="pt-4 border-t border-gray-800">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            {theme === "dark" ? (
              <>
                <Sun className="w-5 h-5" />
                <span className="font-medium text-sm">Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-5 h-5" />
                <span className="font-medium text-sm">Dark Mode</span>
              </>
            )}
          </button>
          <div className="px-3 py-2 text-xs text-gray-500">
            <p>Cluster: <span className="text-gray-400">local-dev</span></p>
            <p>Version: <span className="text-gray-400">0.1.0</span></p>
          </div>
        </div>
      </aside>
    </>
  );
}

// Mobile header with hamburger menu
export function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-gray-900 text-white flex items-center px-4 z-30">
      <button
        onClick={onMenuClick}
        className="p-2 -ml-2 text-gray-400 hover:text-white"
      >
        <Menu className="w-6 h-6" />
      </button>
      <div className="flex items-center gap-2 ml-2">
        <Image
          src="/logo.png"
          alt="HiveMI"
          width={28}
          height={28}
          className="rounded"
        />
        <span className="font-semibold">hivemi</span>
      </div>
    </div>
  );
}
