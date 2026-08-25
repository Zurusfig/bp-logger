"use client";

import { Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { INK, INK_FAINT, RULE } from "@/lib/report-format";
import type { ScatterSeries } from "@/lib/trends";

const hourTick = (h: number) => `${h}:00`;

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { hour: number; sys: number }; name?: string; color?: string }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const h = Math.floor(p.payload.hour);
  const m = Math.round((p.payload.hour - h) * 60);
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${RULE}`,
        borderRadius: 4,
        padding: "6px 8px",
        fontSize: 12,
        color: INK,
        lineHeight: 1.4,
      }}
    >
      <div style={{ color: INK_FAINT }}>
        {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")} · {p.name}
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums", color: p.color, fontWeight: 600 }}>
        {p.payload.sys}
      </div>
    </div>
  );
}

/**
 * Every reading pooled across every day, hour-of-day on x. Shows the daily
 * rhythm rather than a trend, so it shares the page's y-domain but not the
 * slot charts' stagger — that stagger is reserved for the small multiples.
 */
export function TimeOfDayScatter({
  series,
  yDomain,
  duration,
  delay,
  reducedMotion,
}: {
  series: ScatterSeries[];
  yDomain: [number, number];
  duration: number;
  delay: number;
  reducedMotion: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
        <XAxis
          type="number"
          dataKey="hour"
          domain={[0, 24]}
          ticks={[0, 6, 12, 18, 24]}
          tickFormatter={hourTick}
          tick={{ fontSize: 11, fill: INK_FAINT }}
          axisLine={{ stroke: RULE }}
          tickLine={false}
        />
        <YAxis
          type="number"
          dataKey="sys"
          domain={yDomain}
          tick={{ fontSize: 11, fill: INK_FAINT }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          content={<ScatterTooltip />}
          wrapperStyle={{ transition: "opacity 120ms ease-out" }}
          cursor={{ strokeDasharray: "3 3", stroke: RULE }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: INK_FAINT, paddingTop: 4 }}
          iconType="circle"
          iconSize={8}
        />
        {series.map((s) =>
          s.points.length > 0 ? (
            <Scatter
              key={s.def.key}
              name={s.def.label}
              data={s.points}
              fill={s.color}
              isAnimationActive={!reducedMotion}
              animationDuration={duration}
              animationBegin={delay}
              animationEasing="ease-out"
            />
          ) : null,
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
