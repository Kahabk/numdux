import { AlertTriangle, CheckCircle2, Download, Moon, RefreshCw, Sun } from "lucide-react";
import type { DatasetReport } from "../lib/types";

export function VisualReport({ report, pdfUrl, onRefresh, theme, onToggleTheme }: { report: DatasetReport; pdfUrl: string; onRefresh: () => void; theme: "light" | "dark"; onToggleTheme: () => void }) {
  return (
    <div className="report-preview-shell">
      <div className="report-toolbar"><span>Visual report preview</span><div className="flex gap-2"><button className="text-action" onClick={onToggleTheme} type="button">{theme === "light" ? <Moon className="mr-1 inline h-3.5 w-3.5" /> : <Sun className="mr-1 inline h-3.5 w-3.5" />}{theme === "light" ? "Dark report" : "Light report"}</button><button className="text-action" onClick={onRefresh} type="button"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Regenerate</button><a className="text-action" href={pdfUrl}><Download className="mr-1 inline h-3.5 w-3.5" />PDF</a></div></div>
      <article className={`visual-report-page report-theme-${theme}`}>
        <header className="visual-report-header"><div><div className="report-eyebrow">{report.report_type}</div><h1>{report.title}</h1><p>{report.subtitle}</p></div><dl><div><dt>Version</dt><dd>{String(report.dataset.version_id ?? "v1")}</dd></div><div><dt>Generated</dt><dd>{new Date(report.generated_at).toLocaleString()}</dd></div><div><dt>Format</dt><dd>{String(report.dataset.file_format ?? "-").toUpperCase()}</dd></div></dl></header>

        <section className="report-kpis">{report.metrics.map((metric) => <div key={metric.label} className={`report-kpi report-kpi-${metric.status}`}><div>{metric.label}</div><strong>{metric.value}</strong><small>{metric.description}</small></div>)}</section>

        <section className="report-section"><div className="report-section-heading"><div><h2>Dataset overview</h2><p>{report.analysis.objective}</p></div><span>{String(report.dataset.rows ?? 0)} rows · {String(report.dataset.columns ?? 0)} columns</span></div><div className="report-grid-two">{report.charts.slice(0, 2).map((chart) => <ReportChart key={chart.id} chart={chart} />)}</div></section>

        <section className="report-section"><div className="report-section-heading"><div><h2>Quality analysis</h2><p>Charts use the selected version&apos;s computed profile, not inferred narrative values.</p></div></div><div className="report-grid-two">{report.charts.slice(2, 4).map((chart) => <ReportChart key={chart.id} chart={chart} />)}</div></section>

        <section className="report-grid-two report-section"><div className="report-copy"><h2>Findings and interpretation</h2><p>{report.analysis.summary}</p><h3>Method</h3><p>{report.analysis.method}</p><h3>Limitations</h3><p>{report.analysis.limitations}</p></div><div className="report-findings"><h2>Priority findings</h2>{report.findings.length ? report.findings.slice(0, 6).map((finding, index) => <div className="report-finding" key={`${finding.column}-${index}`}><span className={`severity severity-${finding.severity.toLowerCase()}`}>{finding.severity}</span><div><strong>{finding.column}</strong><p>{finding.problem}</p><small>{finding.affected_rows} affected ({finding.percentage}%). {finding.suggested_action}</small></div></div>) : <div className="report-clear"><CheckCircle2 className="h-4 w-4" />No high-confidence quality findings.</div>}</div></section>

        {report.charts[4] && <section className="report-section"><ReportChart chart={report.charts[4]} full /></section>}

        <section className="report-section report-column-section"><div className="report-section-heading"><div><h2>Column dictionary</h2><p>Profiled types, completeness, distribution summaries, and recommended actions.</p></div></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Unique</th><th>Range / mean</th><th>Issue</th><th>Suggested action</th></tr></thead><tbody>{report.columns.map((column) => <tr key={String(column.name)}><td>{String(column.name)}</td><td>{String(column.type)}</td><td>{String(column.null_count)} ({String(column.null_percentage)}%)</td><td>{String(column.unique_count)}</td><td>{column.mean == null ? `${String(column.minimum ?? "-")} - ${String(column.maximum ?? "-")}` : `${String(column.minimum ?? "-")} - ${String(column.maximum ?? "-")} / ${String(column.mean)}`}</td><td>{String(column.issue ?? "None")}</td><td>{String(column.suggested_action ?? "No action required")}</td></tr>)}</tbody></table></div></section>

        <section className="report-recommendation"><AlertTriangle className="h-5 w-5" /><div><strong>Recommended next step</strong><p>{report.analysis.recommendation}</p></div></section>
        <footer className="visual-report-footer"><span>Numdux · validated dataset report</span><span>{String(report.dataset.fingerprint ?? "").slice(0, 16)}</span></footer>
      </article>
    </div>
  );
}

function ReportChart({ chart, full = false }: { chart: DatasetReport["charts"][number]; full?: boolean }) {
  return <figure className={full ? "report-chart report-chart-full" : "report-chart"}><img src={chart.url} alt={chart.title} /><figcaption><strong>{chart.title}</strong><span>{chart.objective} · {chart.dpi} DPI</span></figcaption></figure>;
}
