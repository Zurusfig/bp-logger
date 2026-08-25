"use client";

import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { localParts } from "@/lib/slot";
import { thaiDate, bkkTime, INK, INK_FAINT, RULE } from "@/lib/report-format";
import type { SlotPoint, SlotSeries } from "@/lib/trends";

const tickDate = (t: number) => thaiDate(localParts(new Date(t), "Asia/Bangkok").date);

function SessionTooltip({
  active,
  payload,
  color,
}: {
  active?: boolean;
  payload?: { payload: SlotPoint }[];
  color: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
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
        {tickDate(p.t)} · {bkkTime(new Date(p.t).toISOString())}
      </div>
      <div style={{ fontVariantNumeric: "tabular-nums" }}>
        <span style={{ color, fontWeight: 600 }}>{p.sys}</span>/{p.dia}
      </div>
    </div>
  );
}

function SlotChart({
  series,
  tDomain,
  yDomain,
  duration,
  delay,
  reducedMotion,
}: {
  series: SlotSeries;
  tDomain: [number, number];
  yDomain: [number, number];
  duration: number;
  delay: number;
  reducedMotion: boolean;
}) {
  const { def, color, points } = series;
  const animate = !reducedMotion;

  if (points.length === 0) {
    return (
      <div className="flex h-12 items-center justify-between border-b border-rule px-4">
        <span className="text-[13px] font-medium text-ink-muted">{def.label}</span>
        <span className="text-[13px] text-ink-faint">ยังไม่มีข้อมูลในช่วงนี้</span>
      </div>
    );
  }

  return (
    <div className="border-b border-rule pb-1">
      <div className="px-4 pt-3 pb-1 text-[13px] font-medium" style={{ color }}>
        {def.label}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={points} margin={{ top: 4, right: 16, left: 4, bottom: 0 }} syncId="trends">
          <XAxis
            dataKey="t"
            type="number"
            domain={tDomain}
            tickFormatter={tickDate}
            tick={{ fontSize: 11, fill: INK_FAINT }}
            axisLine={{ stroke: RULE }}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: INK_FAINT }}
            axisLine={false}
            tickLine={false}
            width={28}
          />
          <Tooltip
            content={<SessionTooltip color={color} />}
            wrapperStyle={{ transition: "opacity 120ms ease-out" }}
            cursor={{ stroke: RULE }}
          />
          <Area
            dataKey="dia"
            stackId="band"
            stroke="none"
            fill="transparent"
            isAnimationActive={animate}
            animationDuration={duration}
            animationBegin={delay}
            animationEasing="ease-out"
          />
          <Area
            dataKey="range"
            stackId="band"
            stroke="none"
            fill={color}
            fillOpacity={0.16}
            isAnimationActive={animate}
            animationDuration={duration}
            animationBegin={delay}
            animationEasing="ease-out"
          />
          <Line
            dataKey="sys"
            stroke={color}
            strokeWidth={1.75}
            dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
            isAnimationActive={animate}
            animationDuration={duration}
            animationBegin={delay}
            animationEasing="ease-out"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * One chart per configured slot, stacked so a day lines up column-for-column
 * across all of them (same time domain, same y-domain, same syncId cursor).
 * Staggered by 80ms each on mount — the only stagger this app uses.
 */
export function SlotCharts({
  series,
  tDomain,
  yDomain,
  duration,
  reducedMotion,
}: {
  series: SlotSeries[];
  tDomain: [number, number];
  yDomain: [number, number];
  duration: number;
  reducedMotion: boolean;
}) {
  return (
    <section>
      {series.map((s, i) => (
        <SlotChart
          key={s.def.key}
          series={s}
          tDomain={tDomain}
          yDomain={yDomain}
          duration={duration}
          delay={i * 80}
          reducedMotion={reducedMotion}
        />
      ))}
    </section>
  );
}
