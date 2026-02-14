"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Array of numeric values to chart */
  data: number[];
  /** Width of the SVG */
  width?: number;
  /** Height of the SVG */
  height?: number;
  /** Stroke color (tailwind class or raw value) */
  color?: string;
  /** Fill area under the line */
  fill?: boolean;
  /** Min value for Y axis (default: auto) */
  min?: number;
  /** Max value for Y axis (default: auto) */
  max?: number;
  /** Additional className for the container */
  className?: string;
  /** Label for accessibility */
  label?: string;
}

/**
 * Inline SVG sparkline chart for historical data visualization.
 * Renders a smooth polyline with optional gradient fill.
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "#10b981", // emerald-500
  fill = true,
  min: minProp,
  max: maxProp,
  className,
  label = "Sparkline",
}: SparklineProps) {
  const { linePath, fillPath } = useMemo(() => {
    if (data.length < 2) {
      return { linePath: "", fillPath: "" };
    }

    const minVal = minProp ?? Math.min(...data);
    const maxVal = maxProp ?? Math.max(...data);
    const range = maxVal - minVal || 1;

    const padding = 1;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = data.map((value, i) => {
      const x = padding + (i / (data.length - 1)) * chartWidth;
      const y = padding + chartHeight - ((value - minVal) / range) * chartHeight;
      return { x, y };
    });

    const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
    const line = `M${linePoints.replace(/ /g, " L")}`;

    // Area fill path — line + close to bottom
    const fillPoints = [
      `M${points[0].x},${height - padding}`,
      ...points.map((p) => `L${p.x},${p.y}`),
      `L${points[points.length - 1].x},${height - padding}`,
      "Z",
    ].join(" ");

    return { linePath: line, fillPath: fillPoints };
  }, [data, width, height, minProp, maxProp]);

  if (data.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-gray-600 text-xs", className)}
        style={{ width, height }}
      >
        No data
      </div>
    );
  }

  const gradientId = `spark-fill-${label.replace(/\s/g, "-")}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
      aria-label={label}
      role="img"
    >
      {fill && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
      )}
      {fill && fillPath && (
        <path d={fillPath} fill={`url(#${gradientId})`} />
      )}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
