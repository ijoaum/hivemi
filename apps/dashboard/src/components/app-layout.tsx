"use client";

import { useState } from "react";
import { Sidebar, MobileHeader } from "@/components/sidebar";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-950">
      {/* Mobile Header */}
      <MobileHeader onMenuClick={() => setIsSidebarOpen(true)} />
      
      {/* Sidebar */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      
      {/* Main content - add top padding on mobile for fixed header */}
      <main className="flex-1 p-4 md:p-8 overflow-auto pt-18 md:pt-8">
        {children}
      </main>
    </div>
  );
}
