"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/hooks/use-api";
import { tasksApi, type TaskProgressStep } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Terminal,
  FileText,
  Pencil,
  Wrench,
  Search,
  Globe,
  Monitor,
  Activity,
  Loader2,
  ChevronDown,
  Inbox,
} from "lucide-react";

// =============================================================================
// Icon mapping by toolCall type — matches the interceptor summaries from #89
// =============================================================================

interface StepIconConfig {
  icon: React.ElementType;
  color: string;
  bg: string;
}

function getStepIcon(step: TaskProgressStep): StepIconConfig {
  const toolCall = step.toolCall;
  const text = step.step;

  if (toolCall === "exec" || text.startsWith("$")) {
    return { icon: Terminal, color: "text-green-400", bg: "bg-green-500/20" };
  }
  if (toolCall === "read" || text.startsWith("📄")) {
    return { icon: FileText, color: "text-blue-400", bg: "bg-blue-500/20" };
  }
  if (toolCall === "write" || text.startsWith("✏️")) {
    return { icon: Pencil, color: "text-amber-400", bg: "bg-amber-500/20" };
  }
  if (toolCall === "edit" || text.startsWith("🔧")) {
    return { icon: Wrench, color: "text-purple-400", bg: "bg-purple-500/20" };
  }
  if (toolCall === "web_search" || text.startsWith("🔍")) {
    return { icon: Search, color: "text-cyan-400", bg: "bg-cyan-500/20" };
  }
  if (toolCall === "web_fetch" || text.startsWith("🌐")) {
    return { icon: Globe, color: "text-teal-400", bg: "bg-teal-500/20" };
  }
  if (toolCall === "browser" || text.startsWith("🖥️")) {
    return { icon: Monitor, color: "text-indigo-400", bg: "bg-indigo-500/20" };
  }

  return { icon: Activity, color: "text-gray-400", bg: "bg-gray-500/20" };
}

// =============================================================================
// Format timestamp relative to now (or absolute if old)
// =============================================================================

function formatStepTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStepTimeAbsolute(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// =============================================================================
// Step item — single timeline entry
// =============================================================================

function TimelineStep({ step, isLast }: { step: TaskProgressStep; isLast: boolean }) {
  const config = getStepIcon(step);
  const Icon = config.icon;

  // Clean up step text: strip leading emoji if present (already shown via icon)
  const cleanText = step.step
    .replace(/^[$📄✏️🔧🔍🌐🖥️]\s*/, "")
    .trim();

  return (
    <div className="flex gap-3 group">
      {/* Timeline line + icon */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0",
            config.bg,
          )}
        >
          <Icon className={cn("w-3.5 h-3.5", config.color)} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-gray-700/50 min-h-[16px]" />
        )}
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm text-gray-200 font-mono truncate leading-snug">
            {cleanText || step.step}
          </p>
          <span
            className="text-xs text-gray-500 flex-shrink-0 whitespace-nowrap"
            title={formatStepTimeAbsolute(step.timestamp)}
          >
            {formatStepTime(step.timestamp)}
          </span>
        </div>
        {step.toolCall && (
          <span className="text-xs text-gray-500 mt-0.5 inline-block">
            {step.toolCall}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main TaskTimeline component
// =============================================================================

interface TaskTimelineProps {
  taskId: string;
  /** Whether the task is currently running (enables real-time polling) */
  isActive: boolean;
}

export function TaskTimeline({ taskId, isActive }: TaskTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevCountRef = useRef(0);

  const fetcher = useCallback(
    () => tasksApi.progress(taskId, { limit: 200 }),
    [taskId],
  );

  const { data: steps, isLoading } = useApi(fetcher, {
    // Poll every 3s for active tasks, no polling for completed
    refetchInterval: isActive ? 3000 : undefined,
  });

  // Auto-scroll when new steps arrive
  useEffect(() => {
    if (!steps || !autoScroll) return;

    if (steps.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = steps.length;
  }, [steps, autoScroll]);

  // Detect manual scroll (user scrolls up = disable auto-scroll)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setAutoScroll(true);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading activity...</span>
      </div>
    );
  }

  // Empty state
  if (!steps || steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-500">
        <Inbox className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No activity recorded yet</p>
        {isActive && (
          <p className="text-xs mt-1 text-gray-600">
            Steps will appear as the agent works
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Step count + live indicator */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-400">Activity Timeline</h4>
          <span className="text-xs text-gray-500">
            {steps.length} step{steps.length !== 1 ? "s" : ""}
          </span>
        </div>
        {isActive && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Scrollable timeline */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-64 overflow-y-auto pr-1 scrollbar-thin"
      >
        {steps.map((step, i) => (
          <TimelineStep
            key={step.id}
            step={step}
            isLast={i === steps.length - 1}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {!autoScroll && steps.length > 5 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 p-1.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors shadow-lg"
          title="Scroll to latest"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
