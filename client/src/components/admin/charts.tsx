"use client";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Table2, LineChart } from "lucide-react";
import { compactNumber, fmt } from "@/lib/admin";

type Point = { t: string; value: number };

function niceMax(max: number) {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}
function bucketLabel(t: string, interval: "day" | "week" | "month", long = false) {
  const d = new Date(t);
  if (interval === "month") return d.toLocaleDateString("en", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  const base = d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC", ...(long ? { year: "numeric" } : {}) });
  return interval === "week" && long ? `Week of ${base}` : base;
}

/**
 * Single-series trend (line + 10% area wash) with crosshair tooltip, arrow-key navigation
 * and a table view. One series per chart: measures are shown as small multiples, never on a second axis.
 */
export function TrendChart({
  title,
  points,
  total,
  note,
  interval,
  height = 168,
  totalLabel = "total",
}: {
  title: string;
  points: Point[];
  total: number;
  note?: string | null;
  interval: "day" | "week" | "month";
  height?: number;
  totalLabel?: string;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const measure = (el: HTMLDivElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  };

  const pad = { l: 36, r: 10, t: 10, b: 22 };
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = Math.max(0, width - pad.l - pad.r);
  const innerH = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : "";
  const ticks = [0, max / 2, max];
  const xLabels = points.length ? [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])] : [];
  const empty = points.every((p) => p.value === 0);

  const pick = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / Math.max(1, rect.width);
    setActive(Math.min(points.length - 1, Math.max(0, Math.round(rel * (points.length - 1)))));
  };
  const keys = (e: KeyboardEvent) => {
    if (!points.length) return;
    const last = points.length - 1;
    const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in move) {
      e.preventDefault();
      setActive((i) => Math.min(last, Math.max(0, (i ?? last) + move[e.key])));
    } else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Escape") setActive(null);
  };
  const hovered = active !== null ? points[active] : null;

  return (
    <figure className="trend">
      <figcaption className="trend-head">
        <div>
          <h3>{title}</h3>
          <p>
            <strong>{fmt(total)}</strong> {totalLabel}
          </p>
        </div>
        <button
          type="button"
          className="icon-button small"
          aria-pressed={table}
          aria-label={table ? `Show ${title} as chart` : `Show ${title} as table`}
          title={table ? "Chart view" : "Table view"}
          onClick={() => setTable((t) => !t)}
        >
          {table ? <LineChart size={16} /> : <Table2 size={16} />}
        </button>
      </figcaption>
      {table ? (
        <div className="trend-table">
          <table>
            <thead>
              <tr>
                <th scope="col">{interval === "day" ? "Day" : interval === "week" ? "Week" : "Month"}</th>
                <th scope="col">{title}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.t}>
                  <td>{bucketLabel(p.t, interval, true)}</td>
                  <td>{fmt(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="trend-plot" ref={measure} style={{ height }}>
          {width > 0 && (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={`${title}: ${fmt(total)} ${totalLabel}. Use arrow keys to read values.`}
              tabIndex={0}
              onKeyDown={keys}
              onBlur={() => setActive(null)}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="trend-grid" />
                  <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="trend-tick">
                    {compactNumber(t)}
                  </text>
                </g>
              ))}
              {xLabels.map((i, n) => (
                <text
                  key={i}
                  x={x(i)}
                  y={height - 6}
                  textAnchor={n === 0 && xLabels.length > 1 ? "start" : i === points.length - 1 && xLabels.length > 1 ? "end" : "middle"}
                  className="trend-tick"
                >
                  {bucketLabel(points[i].t, interval)}
                </text>
              ))}
              <path d={area} className="trend-area" />
              <path d={line} className="trend-line" />
              {points.length > 0 && !hovered && (
                <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r={4} className="trend-dot" />
              )}
              {hovered && active !== null && (
                <>
                  <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + innerH} className="trend-cross" />
                  <circle cx={x(active)} cy={y(hovered.value)} r={4.5} className="trend-dot" />
                </>
              )}
              <rect
                x={pad.l}
                y={pad.t}
                width={innerW}
                height={innerH}
                fill="transparent"
                onPointerMove={pick}
                onPointerDown={pick}
                onPointerLeave={() => setActive(null)}
              />
            </svg>
          )}
          {empty && <p className="trend-empty">No activity in this range</p>}
          {hovered && active !== null && (
            <div
              className="trend-tip"
              role="status"
              style={{
                left: Math.min(Math.max(x(active), 70), width - 70),
                top: Math.max(0, y(hovered.value) - 52),
              }}
            >
              <span>{bucketLabel(hovered.t, interval, true)}</span>
              <strong>{fmt(hovered.value)}</strong>
            </div>
          )}
        </div>
      )}
      {note && <p className="trend-note">{note}</p>}
    </figure>
  );
}

/** Horizontal proportion bars for a small categorical breakdown (one hue; values labelled). */
export function BreakdownBars({ items, label }: { items: { key: string; label: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="breakdown" aria-label={label}>
      {items.map((i) => (
        <li key={i.key}>
          <span className="breakdown-label">{i.label}</span>
          <span className="breakdown-track" aria-hidden="true">
            <span className="breakdown-bar" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="breakdown-value">{fmt(i.value)}</span>
        </li>
      ))}
    </ul>
  );
}
