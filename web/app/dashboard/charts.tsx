"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";

interface DailyCost {
  day: string;
  total_cost: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface UserCost {
  user_name: string;
  user_email: string | null;
  total_cost: number;
  message_count: number;
}

interface ColumnCreationVolume {
  day: string;
  columns_created: number;
  rows_generated: number;
}

interface ColumnCreationCost {
  day: string;
  total_cost: number;
}

interface UserColumnCreation {
  user_name: string;
  user_email: string | null;
  columns_created: number;
  rows_generated: number;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatCostShort(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

const PURPLE = "#8432B6";
const PURPLE_LIGHT = "#E8D5F2";
const PURPLE_DARK = "#6B2C91";
const PURPLE_GHOST = "#6B2C9120";
const PURPLE_GHOST_DARK = "#E8D5F215";

export function DashboardCharts({
  dailyCosts,
  userCosts,
  columnCreationVolume,
  columnCreationCosts,
  columnCreationUserStats,
}: {
  dailyCosts: DailyCost[];
  userCosts: UserCost[];
  columnCreationVolume: ColumnCreationVolume[];
  columnCreationCosts: ColumnCreationCost[];
  columnCreationUserStats: UserColumnCreation[];
}) {
  const router = useRouter();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "Escape") {
        e.preventDefault();
        router.push("/");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  const dailyData = dailyCosts.map((d) => ({
    ...d,
    label: formatDayLabel(d.day),
  }));

  const peakCostIndex = dailyData.length > 0 ? dailyData.reduce((maxI, d, i, arr) => d.total_cost > arr[maxI].total_cost ? i : maxI, 0) : -1;
  const peakTokenIndex = dailyData.length > 0 ? dailyData.reduce((maxI, d, i, arr) => d.total_tokens > arr[maxI].total_tokens ? i : maxI, 0) : -1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const costPeakLabel = (props: any) => {
    const { x, y, index, value } = props;
    return index === peakCostIndex ? (
      <text x={x} y={y - 14} textAnchor="middle" fontSize={12} fontWeight={700} fill={PURPLE_DARK} className="dark:fill-[#E8D5F2]">{formatCostShort(value)}</text>
    ) : null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenPeakLabel = (props: any) => {
    const { x, y, index, value } = props;
    return index === peakTokenIndex ? (
      <text x={x} y={y - 14} textAnchor="middle" fontSize={12} fontWeight={700} fill={PURPLE_DARK} className="dark:fill-[#E8D5F2]">{formatTokensShort(value)}</text>
    ) : null;
  };

  const tooltipStyle = {}; // Styled via CSS in globals.css for proper dark mode support

  const userCostsSortedByMessages = [...userCosts].sort((a, b) => b.message_count - a.message_count);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const user = userCosts.find((u) => u.user_name === label);
    if (!user) return null;
    const costPerMsg = user.message_count > 0 ? user.total_cost / user.message_count : 0;
    return (
      <div className="recharts-default-tooltip" style={{ padding: "8px 12px" }}>
        <p className="font-medium text-sm">{label}</p>
        {user.user_email && <p className="text-xs text-muted-foreground">{user.user_email}</p>}
        <div className="mt-1.5 space-y-0.5 text-xs">
          <p>Cost: <span className="font-mono font-medium">${user.total_cost.toFixed(4)}</span></p>
          <p>Messages: <span className="font-mono font-medium">{user.message_count.toLocaleString()}</span></p>
          <p>Cost/msg: <span className="font-mono font-medium">${costPerMsg.toFixed(4)}</span></p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Daily Cost & Tokens Area Charts */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">
          Chat Daily Cost &amp; Tokens
        </h3>
        {dailyData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No data for this period</p>
        ) : (
          <div className="grid grid-cols-2 gap-8">
            {/* Cost area */}
            <div>
              <p className="text-xs text-muted-foreground mb-3 font-medium">Cost ($)</p>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={dailyData}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PURPLE} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={PURPLE} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    interval={Math.max(Math.floor(dailyData.length / 8) - 1, 0)}
                  />
                  <YAxis tickFormatter={formatCostShort} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={50} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_cost"
                    stroke={PURPLE}
                    strokeWidth={2}
                    fill="url(#costGradient)"
                    dot={{ fill: PURPLE, r: 3, strokeWidth: 0 }}
                    activeDot={{ fill: PURPLE_DARK, r: 5, strokeWidth: 0 }}
                    label={costPeakLabel}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Tokens area */}
            <div>
              <p className="text-xs text-muted-foreground mb-3 font-medium">Tokens</p>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={dailyData}>
                  <defs>
                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PURPLE_DARK} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={PURPLE_DARK} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                    interval={Math.max(Math.floor(dailyData.length / 8) - 1, 0)}
                  />
                  <YAxis tickFormatter={formatTokensShort} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={50} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [formatTokensShort(Number(value)), "Tokens"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Area
                    type="monotone"
                    dataKey="total_tokens"
                    stroke={PURPLE_DARK}
                    strokeWidth={2}
                    fill="url(#tokenGradient)"
                    dot={{ fill: PURPLE_DARK, r: 3, strokeWidth: 0 }}
                    activeDot={{ fill: PURPLE, r: 5, strokeWidth: 0 }}
                    label={tokenPeakLabel}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* User Cost + Messages Horizontal Bar Chart */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Chat Cost &amp; Messages by User (top 20)
        </h3>
        <div className="flex items-center gap-4 mb-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: PURPLE }} />
            Cost ($)
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: PURPLE_LIGHT }} />
            Messages
          </span>
        </div>
        {userCosts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No data for this period</p>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {/* Cost bars */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Cost ($)</p>
              <ResponsiveContainer width="100%" height={Math.max(userCosts.length * 40, 100)}>
                <BarChart data={userCosts} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" tickFormatter={formatCostShort} />
                  <YAxis type="category" dataKey="user_name" tick={{ fontSize: 11, fill: "var(--foreground)" }} stroke="var(--muted-foreground)" width={120} />
                  <Tooltip content={userTooltip} />
                  <Bar
                    dataKey="total_cost"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    label={{ position: "right", fontSize: 10, fill: PURPLE_DARK, className: "dark:fill-[#E8D5F2]", formatter: (v: unknown) => formatCostShort(Number(v)) }}
                  >
                    {userCosts.map((_, i) => (
                      <Cell key={i} fill={PURPLE} fillOpacity={0.85 - 0.3 * (i / Math.max(userCosts.length - 1, 1))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Message count bars */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Messages</p>
              <ResponsiveContainer width="100%" height={Math.max(userCostsSortedByMessages.length * 40, 100)}>
                <BarChart data={userCostsSortedByMessages} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" />
                  <YAxis type="category" dataKey="user_name" tick={{ fontSize: 11, fill: "var(--foreground)" }} stroke="var(--muted-foreground)" width={120} />
                  <Tooltip content={userTooltip} />
                  <Bar
                    dataKey="message_count"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    label={{ position: "right", fontSize: 10, fill: PURPLE_DARK, className: "dark:fill-[#E8D5F2]" }}
                  >
                    {userCostsSortedByMessages.map((_, i) => (
                      <Cell key={i} fill={PURPLE_LIGHT} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Column Creation Volume */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">
          Column Creation Volume
        </h3>
        {columnCreationVolume.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No column creation data for this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={columnCreationVolume.map((d) => ({ ...d, label: formatDayLabel(d.day) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
                interval={Math.max(Math.floor(columnCreationVolume.length / 8) - 1, 0)}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
                width={50}
                label={{ value: "Columns", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--muted-foreground)" } }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
                width={60}
                label={{ value: "Rows", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "var(--muted-foreground)" } }}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label) => String(label)}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="columns_created"
                name="Columns Created"
                stroke={PURPLE}
                strokeWidth={2}
                dot={{ fill: PURPLE, r: 3, strokeWidth: 0 }}
                activeDot={{ fill: PURPLE_DARK, r: 5, strokeWidth: 0 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="rows_generated"
                name="Rows Generated"
                stroke="#E8E0D0"
                strokeWidth={2}
                dot={{ fill: "#E8E0D0", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#F5F0E8", r: 5, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Column Creation by User */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Column Creation by User (top 20)
        </h3>
        <div className="flex items-center gap-4 mb-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: PURPLE }} />
            Columns Created
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "#E8E0D0" }} />
            Rows Generated
          </span>
        </div>
        {columnCreationUserStats.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No data for this period</p>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {/* Columns created bars */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Columns Created</p>
              <ResponsiveContainer width="100%" height={Math.max(columnCreationUserStats.length * 40, 100)}>
                <BarChart data={columnCreationUserStats} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" allowDecimals={false} />
                  <YAxis type="category" dataKey="user_name" tick={{ fontSize: 11, fill: "var(--foreground)" }} stroke="var(--muted-foreground)" width={120} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [value, "Columns Created"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Bar
                    dataKey="columns_created"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    label={{ position: "right", fontSize: 10, fill: PURPLE_DARK, className: "dark:fill-[#E8D5F2]", formatter: (v: unknown) => String(Number(v)) }}
                  >
                    {columnCreationUserStats.map((_, i) => (
                      <Cell key={i} fill={PURPLE} fillOpacity={0.85 - 0.3 * (i / Math.max(columnCreationUserStats.length - 1, 1))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Rows generated bars */}
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-2">Rows Generated</p>
              <ResponsiveContainer width="100%" height={Math.max(columnCreationUserStats.length * 40, 100)}>
                <BarChart
                  data={[...columnCreationUserStats].sort((a, b) => b.rows_generated - a.rows_generated)}
                  layout="vertical"
                  margin={{ left: 0, right: 40, top: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9 }} stroke="var(--muted-foreground)" allowDecimals={false} />
                  <YAxis type="category" dataKey="user_name" tick={{ fontSize: 11, fill: "var(--foreground)" }} stroke="var(--muted-foreground)" width={120} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [Number(value).toLocaleString(), "Rows Generated"]}
                    labelFormatter={(label) => String(label)}
                  />
                  <Bar
                    dataKey="rows_generated"
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    label={{ position: "right", fontSize: 10, fill: "#B0A898", formatter: (v: unknown) => Number(v).toLocaleString() }}
                  >
                    {[...columnCreationUserStats].sort((a, b) => b.rows_generated - a.rows_generated).map((_, i) => (
                      <Cell key={i} fill="#E8E0D0" fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Column Creation Cost */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-6">
          Column Creation Cost
        </h3>
        {columnCreationCosts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No column creation data for this period</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={columnCreationCosts.map((d) => ({ ...d, label: formatDayLabel(d.day) }))}>
              <defs>
                <linearGradient id="colCostGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PURPLE} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={PURPLE} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                stroke="var(--muted-foreground)"
                interval={Math.max(Math.floor(columnCreationCosts.length / 8) - 1, 0)}
              />
              <YAxis tickFormatter={formatCostShort} tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={50} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                labelFormatter={(label) => String(label)}
              />
              <Area
                type="monotone"
                dataKey="total_cost"
                stroke={PURPLE}
                strokeWidth={2}
                fill="url(#colCostGradient)"
                dot={{ fill: PURPLE, r: 3, strokeWidth: 0 }}
                activeDot={{ fill: PURPLE_DARK, r: 5, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
