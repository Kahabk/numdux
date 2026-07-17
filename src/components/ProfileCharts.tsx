import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type React from "react";
import type { DatasetProfile } from "../lib/types";

const COLORS = ["#6C8CFF", "#6FAF83", "#C9A45D", "#B778C4", "#59A9A5", "#C46A6A"];

export function ProfileCharts({ profile }: { profile: DatasetProfile }) {
  const numeric = profile.numeric_distributions[0];
  const category = profile.category_distributions[0];
  const secondaryNumeric = profile.numeric_distributions[1];
  const missingness = profile.missingness_chart.filter((item) => item.nulls > 0).slice(0, 10);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ChartFrame title={numeric ? `${numeric.column} distribution` : "Numeric distribution"} empty={!numeric}>
        {numeric && <Histogram data={numeric.bins} />}
      </ChartFrame>
      <ChartFrame title={category ? `${category.column} top values` : secondaryNumeric ? `${secondaryNumeric.column} distribution` : "Category distribution"} empty={!category && !secondaryNumeric}>
        {category ? <HorizontalBars data={category.values} /> : secondaryNumeric && <Histogram data={secondaryNumeric.bins} />}
      </ChartFrame>
      <ChartFrame title="Missing values by column" empty={!missingness.length} className="lg:col-span-2">
        {missingness.length > 0 && <HorizontalBars data={missingness.map((item) => ({ label: item.column, count: item.nulls }))} />}
      </ChartFrame>
    </div>
  );
}

function ChartFrame({ title, empty, children, className = "" }: { title: string; empty: boolean; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-base p-3 ${className}`}>
      <div className="mb-2 text-xs text-muted">{title}</div>
      {empty ? <div className="flex h-48 items-center text-xs text-muted">{title === "Missing values by column" ? "No missing values detected." : "No profile values available for this chart."}</div> : <div className="h-48">{children}</div>}
    </section>
  );
}

function Histogram({ data }: { data: Array<{ label: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 20 }}>
        <CartesianGrid stroke="#2A2A2A" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: "#9A9A9A", fontSize: 10 }} interval="preserveStartEnd" angle={-20} textAnchor="end" />
        <YAxis tick={{ fill: "#9A9A9A", fontSize: 10 }} allowDecimals={false} />
        <Tooltip contentStyle={{ background: "#1A1A1A", border: "1px solid #2A2A2A", fontSize: 12 }} />
        <Bar dataKey="count" fill="#6C8CFF" radius={0} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function HorizontalBars({ data }: { data: Array<{ label: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 18, bottom: 0 }}>
        <CartesianGrid stroke="#2A2A2A" horizontal={false} />
        <XAxis type="number" tick={{ fill: "#9A9A9A", fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={112} tick={{ fill: "#9A9A9A", fontSize: 10 }} />
        <Tooltip contentStyle={{ background: "#1A1A1A", border: "1px solid #2A2A2A", fontSize: 12 }} />
        <Bar dataKey="count" radius={0}>
          {data.map((item, index) => <Cell key={`${item.label}-${index}`} fill={COLORS[index % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
