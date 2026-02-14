"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface CpuGaugeProps {
  /** CPU usage percentage (0–100) */
  value: number;
  /** Diameter in pixels */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Additional className */
  className?: string;
}

/**
 * Arc gauge for CPU usage visualization.
 * Color transitions from emerald (low) → amber (medium) → red (high).
 */
export function CpuGauge({
  value,
  size = 100,
  strokeWidth = 8,
  className,
}: CpuGaugeProps) {
  const { arcPath, color, bgArcPath } = useMemo(() => {
    const clamped = Math.min(100, Math.max(0, value));

    // 270-degree arc (from 135° to 405° = -45° to 225°)
    const startAngle = 135;
    const endAngle = 405;
    const totalAngle = endAngle - startAngle;

    const cx = size / 2;
    const cy = size / 2;
    const radius = (size - strokeWidth) / 2;

    const angleToPoint = (angleDeg: number) => {
      const rad = (angleDeg * Math.PI) / 180;
      return {
        x: cx + radius * Math.cos(rad),
        y: cy + radius * Math.sin(rad),
      };
    };

    const valueAngle = startAngle + (clamped / 100) * totalAngle;

    // Background arc (full 270°)
    const bgStart = angleToPoint(startAngle);
    const bgEnd = angleToPoint(endAngle);
    const bgPath = [
      `M ${bgStart.x} ${bgStart.y}`,
      `A ${radius} ${radius} 0 1 1 ${bgEnd.x} ${bgEnd.y}`,
    ].join(" ");

    // Value arc
    let valPath = "";
    if (clamped > 0) {
      const valStart = angleToPoint(startAngle);
      const valEnd = angleToPoint(valueAngle);
      const largeArc = valueAngle - startAngle > 180 ? 1 : 0;
      valPath = [
        `M ${valStart.x} ${valStart.y}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${valEnd.x} ${valEnd.y}`,
      ].join(" ");
    }

    // Color based on value
    let col: string;
    if (clamped >= 80) {
      col = "#ef4444"; // red-500
    } else if (clamped >= 60) {
      col = "#f59e0b"; // amber-500
    } else {
      col = "#10b981"; // emerald-500
    }

    return { arcPath: valPath, color: col, bgArcPath: bgPath };
  }, [value, size, strokeWidth]);

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <path
          d={bgArcPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="text-gray-800"
        />
        {/* Value arc */}
        {arcPath && (
          <path
            d={arcPath}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{
              transition: "stroke-dashoffset 0.5s ease, stroke 0.3s ease",
            }}
          />
        )}
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-white" style={{ color }}>
          {Math.round(value)}%
        </span>
        <span className="text-xs text-gray-500">CPU</span>
      </div>
    </div>
  );
}
