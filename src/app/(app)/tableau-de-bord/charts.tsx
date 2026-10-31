"use client";

import * as React from "react";
import type { DashboardCharts } from "@/lib/dashboard";
import { Beams } from "@/components/ui/card";
import SpendingRing from "@/components/ui/kokonut-spending-ring";

/*
 * Bento analytique (adapté de « Analytics Bento », vasnev.art) : entrées/sorties, dépenses par catégorie, saisonnalité.
 * SVG seul, sans bibliothèque de graphiques ; styles dans globals.css (.ab-*). Montants en centimes.
 */

const COLORS = {
  income: ["#22d3ee", "#818cf8"],
  expense: ["#ffb800", "#ff3da5"],
  radar: "#3bf08c",
  // Couleur d'un groupe de catégories, avec l'encre lisible dessus.
  groups: [["#7cff5b", "#07080d"], ["#8b3dff", "#fff"], ["#ffb800", "#07080d"], ["#ff5a1f", "#07080d"], ["#22d3ee", "#07080d"], ["#ff3da5", "#07080d"]],
  none: ["#3a3f52", "#e2e8f0"],
} as const;
const MONTHS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MONO = "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

type Money = (cents: number) => string;
const MoneyContext = React.createContext<Money>((c) => String(Math.round(c / 100)));
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function useReducedMotion() {
  const [r, setR] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

function useSize() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Courbe lissée passant par les points (catmull-rom en béziers cubiques). */
function smooth(P: [number, number][]) {
  const n = P.length;
  if (n < 2) return "";
  const g = (i: number) => P[Math.max(0, Math.min(n - 1, i))];
  let d = `M${P[0][0]},${P[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2), k = 0.18;
    d += `C${p1[0] + (p2[0] - p0[0]) * k},${p1[1] + (p2[1] - p0[1]) * k} ${p2[0] - (p3[0] - p1[0]) * k},${p2[1] - (p3[1] - p1[1]) * k} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function CountUp({ value, duration = 1100 }: { value: number; duration?: number }) {
  const money = React.useContext(MoneyContext);
  const ref = React.useRef<HTMLSpanElement>(null);
  const from = React.useRef(0);
  const reduce = useReducedMotion();
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) { el.textContent = money(value); from.current = value; return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const f = (now: number) => {
      const t = Math.min(1, (now - t0) / duration), v = a + (value - a) * ease(t);
      el.textContent = money(v); from.current = v;
      if (t < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce, money]);
  return <span ref={ref}>{money(0)}</span>;
}

/* ---------------- infobulle ---------------- */

type Tip = { title: string; rows: { label: string; value: string; color?: string }[] };
type TipApi = { show: (x: number, y: number, t: Tip) => void; hide: () => void };
type TipRef = React.RefObject<TipApi | null>;

function Tooltip({ api }: { api: TipRef }) {
  const [tip, setTip] = React.useState<(Tip & { x: number; y: number }) | null>(null);
  const [pos, setPos] = React.useState({ l: 0, t: 0 });
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    api.current = { show: (x, y, t) => setTip({ ...t, x, y }), hide: () => setTip(null) };
    return () => { api.current = null; };
  }, [api]);
  React.useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const r = box.current.getBoundingClientRect();
    let l = tip.x + 14, t = tip.y - r.height - 12;
    if (l + r.width > window.innerWidth - 8) l = tip.x - r.width - 14;
    if (t < 8) t = tip.y + 16;
    setPos({ l, t });
  }, [tip]);
  return (
    <div ref={box} role="tooltip" className={tip ? "ab-tip on" : "ab-tip"} style={{ left: pos.l, top: pos.t }}>
      {tip && (
        <>
          <div className="ab-tip-title">{tip.title}</div>
          {tip.rows.map((r) => (
            <div key={r.label} className="ab-tip-row">
              <span>{r.color && <i style={{ background: r.color }} />}{r.label}</span>
              <b className="ab-num">{r.value}</b>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- éléments communs ---------------- */

/** Variation en % ; `upIsGood` : une hausse est une bonne nouvelle (solde) ou une mauvaise (dépenses). */
function Delta({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span className={`ab-delta${up === upIsGood ? "" : " neg"}${up ? "" : " down"}`}>
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 10.5V1.5M2 5.5l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {Math.abs(value).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
    </span>
  );
}

function Segmented({ items, value, onChange, label }: { items: string[]; value: number; onChange: (i: number) => void; label: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = React.useState({ x: 0, w: 0 });
  React.useLayoutEffect(() => {
    const b = refs.current[value];
    if (b) setThumb({ x: b.offsetLeft, w: b.offsetWidth });
  }, [value, items]);
  return (
    <div role="tablist" aria-label={label} className="ab-seg">
      <div className="ab-seg-thumb" style={{ width: thumb.w, transform: `translateX(${thumb.x - 2}px)` }} />
      {items.map((it, i) => (
        <button key={it} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" aria-selected={i === value} onClick={() => onChange(i)}>
          {it}
        </button>
      ))}
    </div>
  );
}

const leave = (setHover: (v: null) => void, tip: TipRef) => () => { setHover(null); tip.current?.hide(); };

/* ---------------- B : entrées (en haut) / sorties (en bas) cumulées ---------------- */

function FlowsChart({ income, expense, months, tip }: { income: number[][]; expense: number[][]; months: string[]; tip: TipRef }) {
  const money = React.useContext(MoneyContext);
  const [ref, { w: W, h: H }] = useSize();
  const reduce = useReducedMotion();
  const id = React.useId().replace(/:/g, "");
  const paths = React.useRef<(SVGPathElement | null)[]>([]);
  const [hover, setHover] = React.useState<number | null>(null);
  const n = income[0].length;
  const max = Math.max(1, ...income.flat(), ...expense.flat());
  const pad = 18, mid = H / 2, amp = H / 2 - 14;
  const X = (i: number) => pad + 6 + (i / (n - 1)) * (W - 2 * pad - 12);
  const sets = React.useMemo(
    () => [...income.map((a, k) => ({ a, dir: -1, k, g: "i" })), ...expense.map((a, k) => ({ a, dir: 1, k, g: "e" }))],
    [income, expense],
  );

  React.useEffect(() => {
    if (!W || !H) return;
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000, grow = reduce ? 1 : ease(Math.min(1, t / 1.3));
      sets.forEach((s, j) => {
        const breathe = reduce ? 1 : 1 + Math.sin(t * 1.2 + s.k * 0.9) * 0.035;
        const P = s.a.map((v, i) => [X(i), mid + s.dir * (3 + (v / max) * amp * grow * breathe)] as [number, number]);
        paths.current[j]?.setAttribute("d", smooth(P));
      });
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, sets, reduce, max]);

  const move = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGRectElement).ownerSVGElement!.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - pad - 6) / (W - 2 * pad - 12)) * (n - 1))));
    setHover(i);
    tip.current?.show(r.left + X(i), r.top + 12, {
      title: `Cumul au ${i + 1} ${months[0]}`,
      rows: [
        { label: "Entrées", value: money(income[0][i]), color: COLORS.income[1] },
        { label: "Sorties", value: money(expense[0][i]), color: COLORS.expense[1] },
      ],
    });
  };

  return (
    <div ref={ref} className="ab-chart tall">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Entrées et sorties cumulées de ${months[0]}, comparées aux deux mois précédents`}>
          <defs>
            <linearGradient id={`${id}i`} gradientUnits="userSpaceOnUse" x1={0} x2={W} y1={0} y2={0}>
              <stop offset=".1" stopColor={COLORS.income[0]} />
              <stop offset=".9" stopColor={COLORS.income[1]} />
            </linearGradient>
            <linearGradient id={`${id}e`} gradientUnits="userSpaceOnUse" x1={0} x2={W} y1={0} y2={0}>
              <stop offset=".15" stopColor={COLORS.expense[0]} />
              <stop offset=".85" stopColor={COLORS.expense[1]} />
            </linearGradient>
          </defs>
          {Array.from({ length: 9 }, (_, i) => 10 + ((H - 20) * i) / 8).map((y) => (
            <g key={y} stroke="var(--faint)" opacity={0.6}>
              <line x1={8} x2={14} y1={y} y2={y} />
              <line x1={W - 14} x2={W - 8} y1={y} y2={y} />
            </g>
          ))}
          <line x1={pad + 6} x2={W - pad - 6} y1={mid} y2={mid} stroke="var(--border)" />
          {sets.map((s, j) => (
            <path
              key={`${s.g}${s.k}`}
              ref={(el) => { paths.current[j] = el; }}
              fill="none"
              stroke={`url(#${id}${s.g})`}
              strokeWidth={s.k === 0 ? 2.5 : 1.6}
              strokeLinecap="round"
              opacity={s.k === 0 ? 1 : s.k === 1 ? 0.55 : 0.3}
            />
          ))}
          {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={4} y2={H - 4} stroke="var(--faint)" />}
          <rect width={W} height={H} fill="transparent" onPointerMove={move} onPointerLeave={leave(setHover, tip)} />
        </svg>
      )}
    </div>
  );
}

/* ---------------- C : treemap des dépenses ---------------- */

type Rect = { name: string; group: string; v: number; x: number; y: number; w: number; h: number };
function squarify(items: { name: string; group: string; v: number }[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((a, b) => a + b.v, 0) || 1, scale = (w * h) / total, out: Rect[] = [];
  let rest = items.map((i) => ({ ...i, a: i.v * scale }));
  const worst = (row: typeof rest, len: number) => {
    const s = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  while (rest.length) {
    const len = Math.min(w, h);
    const row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], len) <= worst(row, len)) row.push(rest[i++]);
    rest = rest.slice(i);
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; for (const r of row) { const rh = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; } x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; for (const r of row) { const rw = r.a / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; } y += rh; h -= rh; }
  }
  return out;
}

const TileIcon = ({ bg }: { bg: string }) => (
  <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
    <rect x="1" y="1" width="12" height="12" rx="4" fill="currentColor" opacity=".9" />
    <path d="M7 3.6l1 2.4 2.4 1-2.4 1L7 10.4 6 8 3.6 7 6 6z" fill={bg} />
  </svg>
);

type Categories = DashboardCharts["categories"];
const groupColor = (groups: Categories["groups"], id: string) =>
  id === "none" ? COLORS.none : COLORS.groups[groups.findIndex((g) => g.id === id) % COLORS.groups.length];

/** Dépenses du mois par catégorie de premier niveau, couleurs du treemap, évolution vs le mois précédent. */
export function SpendingByCategory({ currency, data }: { currency: string; data: Categories }) {
  const categories = React.useMemo(() => {
    const sums = new Map<string, [number, number]>();
    for (const i of data.items) {
      const s = sums.get(i.group) ?? [0, 0];
      sums.set(i.group, [s[0] + i.values[0], s[1] + i.values[1]]);
    }
    return data.groups
      .map((g) => ({ g, s: sums.get(g.id)! }))
      .filter(({ s }) => s[0] > 0)
      .sort((a, b) => b.s[0] - a.s[0])
      .map(({ g, s: [cur, prev] }) => ({
        name: g.name,
        amount: cur / 100,
        change: prev ? ((cur - prev) / prev) * 100 : undefined,
        color: groupColor(data.groups, g.id)[0],
      }));
  }, [data]);
  return <SpendingRing title="Dépenses par catégorie" categories={categories} currency={currency} />;
}

function Treemap({ data, period, tip }: { data: Categories; period: number; tip: TipRef }) {
  const money = React.useContext(MoneyContext);
  const [ref, { w: W, h: H }] = useSize();
  const [placed, setPlaced] = React.useState(false);
  React.useEffect(() => { if (W) { const r = requestAnimationFrame(() => requestAnimationFrame(() => setPlaced(true))); return () => cancelAnimationFrame(r); } }, [W]);
  const G = 6;
  const items = data.items.map((i) => ({ name: i.name, group: i.group, v: i.values[period] })).filter((i) => i.v > 0).sort((a, b) => b.v - a.v);
  const total = items.reduce((a, b) => a + b.v, 0) || 1;
  const rects = W ? squarify(items, 0, 0, W + G, H + G) : [];
  const label = data.periods[period].label;
  return (
    <div ref={ref} className="ab-tree" role="img" aria-label={`Dépenses par catégorie, ${label}`}>
      {!items.length && <p className="ab-empty muted">Aucune dépense sur cette période.</p>}
      {rects.map((r) => {
        const g = data.groups.find((x) => x.id === r.group)!;
        const [bg, ink] = groupColor(data.groups, r.group);
        const w = r.w - G, h = r.h - G, share = ((r.v / total) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " %";
        const chars = money(r.v).length;
        let fs = Math.min(30, (w - 24 - 58) / (chars * 0.62)), showPct = true;
        if (fs < 17) { showPct = false; fs = Math.min(30, (w - 24) / (chars * 0.62)); }
        const tiny = fs < 12 || h < 54 || w < 60, showName = h >= 78 && w >= 96;
        return (
          <div
            key={`${r.group}/${r.name}`}
            className="ab-tile"
            style={{ left: placed ? r.x : W / 2, top: placed ? r.y : H / 2, width: placed ? w : 0, height: placed ? h : 0, background: bg, color: ink }}
            onPointerMove={(e) => tip.current?.show(e.clientX, e.clientY, { title: `${label} · ${g.name}`, rows: [{ label: r.name, value: money(r.v), color: bg }, { label: "Part", value: share }] })}
            onPointerLeave={() => tip.current?.hide()}
          >
            <div className="ab-tile-name">
              <TileIcon bg={bg} />
              {showName && <span>{r.name}</span>}
            </div>
            {!tiny && (
              <div className="ab-tile-foot">
                <span className="ab-num" style={{ fontSize: fs, lineHeight: 0.9 }}><CountUp value={r.v} duration={900} /></span>
                {showPct && <span className="ab-pill ab-num">{share}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- D : saisonnalité (radar) ---------------- */

function Radar({ values, year, tip }: { values: number[]; year: string; tip: TipRef }) {
  const money = React.useContext(MoneyContext);
  const [ref, { w }] = useSize();
  const reduce = useReducedMotion();
  const line = React.useRef<SVGPathElement>(null);
  const cur = React.useRef<number[] | null>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const N = values.length, S = Math.min(w, 420), R = S / 2 - 34, C = S / 2;
  const ang = (i: number) => -Math.PI / 2 + (i / N) * Math.PI * 2;

  // Série de Fourier d'ordre bas : des lobes ronds et réguliers.
  const norm = (v: number[]) => { const lo = Math.min(...v), hi = Math.max(...v); return v.map((x) => 0.42 + ((x - lo) / (hi - lo || 1)) * 0.58); };
  const fit = (v: number[]) => {
    const K = Math.min(5, Math.floor(N / 2)), co: [number, number][] = [];
    for (let k = 0; k <= K; k++) {
      let a = 0, b = 0;
      v.forEach((x, i) => { const th = (i / N) * Math.PI * 2; a += x * Math.cos(k * th); b += x * Math.sin(k * th); });
      co.push([(a * (k ? 2 : 1)) / N, (b * (k ? 2 : 1)) / N]);
    }
    return (th: number) => co.reduce((r, [a, b], k) => r + a * Math.cos(k * th) + b * Math.sin(k * th), 0);
  };
  const at = (f: (t: number) => number, th: number): [number, number] => {
    const v = Math.max(0.05, f(th)), a = -Math.PI / 2 + th;
    return [C + Math.cos(a) * (R * 0.2 + v * R * 0.8), C + Math.sin(a) * (R * 0.2 + v * R * 0.8)];
  };
  const shape = (v: number[]) => { const f = fit(norm(v)); let d = ""; for (let j = 0; j <= 180; j++) { const p = at(f, (j / 180) * Math.PI * 2); d += (j ? "L" : "M") + p[0].toFixed(2) + "," + p[1].toFixed(2); } return d + "Z"; };
  const point = (v: number[], i: number) => at(fit(norm(v)), (i / N) * Math.PI * 2);

  React.useEffect(() => {
    if (!S) return;
    const from = cur.current ?? values.map(() => 1), to = values, t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = reduce ? 1 : ease(Math.min(1, (now - t0) / 900));
      cur.current = from.map((v, i) => v + (to[i] - v) * t);
      line.current?.setAttribute("d", shape(cur.current));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, S, reduce]);

  const move = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGRectElement).ownerSVGElement!.getBoundingClientRect(), x = e.clientX - r.left - C, y = e.clientY - r.top - C;
    if (Math.hypot(x, y) < R * 0.2) { setHover(null); tip.current?.hide(); return; }
    let a = Math.atan2(y, x) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
    const i = Math.round((a / (Math.PI * 2)) * N) % N, p = point(values, i);
    setHover(i);
    tip.current?.show(r.left + p[0], r.top + p[1], { title: `${MONTHS[i]} ${year}`, rows: [{ label: "Dépenses", value: money(values[i]), color: COLORS.radar }] });
  };
  const hp = hover !== null ? point(values, hover) : null;

  return (
    <div ref={ref} className="ab-radar" style={{ height: S || 300 }}>
      {S > 0 && (
        <svg width={S} height={S} role="img" aria-label={`Dépenses par mois, ${year}`}>
          {[0.33, 0.66, 1].map((k) => <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="var(--hairline)" />)}
          {MONTHS.map((m, i) => (
            <g key={m}>
              <line x1={C + Math.cos(ang(i)) * R * 0.2} y1={C + Math.sin(ang(i)) * R * 0.2} x2={C + Math.cos(ang(i)) * R} y2={C + Math.sin(ang(i)) * R} stroke="var(--hairline)" />
              <text x={C + Math.cos(ang(i)) * (R + 18)} y={C + Math.sin(ang(i)) * (R + 18)} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--faint)" style={{ fontFamily: MONO }}>{m}</text>
            </g>
          ))}
          <path ref={line} fill="none" strokeWidth={2.5} strokeLinejoin="round" stroke={COLORS.radar} />
          <circle cx={C} cy={C} r={R * 0.2} fill="var(--surface)" stroke="var(--border)" />
          <g transform={`translate(${C - 11} ${C - 11})`} fill="none" stroke="var(--faint)" strokeWidth={1.4} strokeLinejoin="round">
            <path d="M11 1.5l8.5 5v9L11 20.5l-8.5-5v-9z M11 1.5v19 M2.5 6.5L19.5 15.5 M19.5 6.5L2.5 15.5" />
          </g>
          {hp && <circle cx={hp[0]} cy={hp[1]} r={4.5} stroke="var(--surface)" strokeWidth={2} fill={COLORS.radar} />}
          <rect width={S} height={S} fill="transparent" onPointerMove={move} onPointerLeave={leave(setHover, tip)} />
        </svg>
      )}
    </div>
  );
}

/* ---------------- le bento ---------------- */

export function AnalyticsBento({ currency, data, aside }: { currency: string; data: DashboardCharts; aside?: React.ReactNode }) {
  const money = React.useMemo(() => {
    const f = new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (cents: number) => f.format(cents / 100);
  }, [currency]);
  const tip = React.useRef<TipApi | null>(null);
  const [period, setPeriod] = React.useState(0);
  const [year, setYear] = React.useState(0);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  const { flows, categories, seasons } = data;
  const Y = seasons[year];
  const net = flows.monthIncome - flows.monthExpense;

  return (
    <MoneyContext.Provider value={money}>
      <div className={shown ? "ab-grid ab-shown" : "ab-grid"}>
        <section className="ab-card w12" aria-label="Entrées et sorties du mois">
          <Beams />
          <div className="ab-split">
            <div>
              <div className="ab-label">Solde du mois</div>
              <div className={net < 0 ? "ab-big ab-num neg" : "ab-big ab-num"}><CountUp value={net} /></div>
              <div className="ab-note">Entrées <b className="ab-num">{money(flows.monthIncome)}</b> · Sorties <b className="ab-num">{money(flows.monthExpense)}</b></div>
              <div className="ab-legend">
                <span><i className="line" style={{ background: `linear-gradient(90deg,${COLORS.income.join(",")})` }} />Entrées</span>
                <span><i className="line" style={{ background: `linear-gradient(90deg,${COLORS.expense.join(",")})` }} />Sorties</span>
                <span><i className="line" style={{ background: "var(--faint)" }} />{flows.months[1]}, {flows.months[2]}</span>
              </div>
            </div>
            <FlowsChart income={flows.income} expense={flows.expense} months={flows.months} tip={tip} />
          </div>
        </section>

        {aside}
        <section className={aside ? "ab-card w6" : "ab-card w12"} aria-label="Saisonnalité des dépenses">
          <Beams />
          <div className="ab-head">
            <h2>Saisonnalité des dépenses</h2>
            <Segmented label="Année" items={seasons.map((s) => s.label)} value={year} onChange={setYear} />
          </div>
          <Radar values={Y.values} year={Y.label} tip={tip} />
          <div className="ab-stats">
            <div>
              <div className="ab-label">Moyenne mensuelle</div>
              <div className="ab-stat ab-num"><CountUp value={Y.average} /></div>
            </div>
            <div>
              <div className="ab-label">Total de l’année</div>
              <div className="ab-stat ab-num"><CountUp value={Y.total} /></div>
              {Y.delta !== null && <div className="ab-note"><Delta value={Y.delta} upIsGood={false} /> vs l’an dernier à date</div>}
            </div>
          </div>
          <div className="ab-rows">
            {Y.top.map((r) => (
              <div key={r.label}><span>{r.label}</span><span className="ab-num">{money(r.value)}</span></div>
            ))}
          </div>
        </section>
      </div>
      <Tooltip api={tip} />
    </MoneyContext.Provider>
  );
}

/* ---------------- indicateurs du haut : valeur, variation, courbe du mois ---------------- */

export type Kpi = { label: string; value: number; note: string; series: number[] | null; prev: number | null; upIsGood?: boolean; colors: readonly [string, string] };

function Spark({ series, colors, label }: { series: number[]; colors: readonly [string, string]; label: string }) {
  const [ref, { w: W, h: H }] = useSize();
  const id = React.useId().replace(/:/g, "");
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const top = 34, bottom = 14, left = 14, right = 52;
  const X = (i: number) => left + (series.length > 1 ? (i / (series.length - 1)) * (W - left - right) : 0);
  const Y = (v: number) => top + (1 - (v - min) / span) * (H - top - bottom);
  const P = series.map((v, i) => [X(i), Y(v)] as [number, number]);
  const line = smooth(P), end = P[P.length - 1];
  const ticks = [0, 1, 2, 3].map((k) => max - (span * k) / 3);
  return (
    <div ref={ref} className="ab-chart kpi-chart">
      <span className="ab-caption">Ce mois</span>
      {W > 0 && series.length > 1 && (
        <svg width={W} height={H} role="img" aria-label={`${label} cumulé jour par jour ce mois-ci`}>
          <defs>
            <linearGradient id={`${id}l`} gradientUnits="userSpaceOnUse" x1={left} x2={W - right} y1={0} y2={0}>
              <stop offset="0" stopColor={colors[0]} />
              <stop offset="1" stopColor={colors[1]} />
            </linearGradient>
            <linearGradient id={`${id}a`} x1={0} x2={0} y1={0} y2={1}>
              <stop offset="0" stopColor={colors[1]} stopOpacity={0.18} />
              <stop offset="1" stopColor={colors[1]} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={0} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
              <text x={W - 10} y={Y(v) - 4} textAnchor="end" fontSize={11} fontFamily={MONO} fill="var(--muted)">{compact.format(v / 100)}</text>
            </g>
          ))}
          <path d={`${line}L${end[0]},${H}L${P[0][0]},${H}Z`} fill={`url(#${id}a)`} />
          <path d={line} fill="none" stroke={`url(#${id}l)`} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={end[0]} cy={end[1]} r={5} fill={colors[1]} />
        </svg>
      )}
    </div>
  );
}

export function KpiCards({ currency, items }: { currency: string; items: Kpi[] }) {
  const money = React.useMemo(() => {
    const f = new Intl.NumberFormat("fr-FR", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (cents: number) => f.format(cents / 100);
  }, [currency]);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  return (
    <MoneyContext.Provider value={money}>
      <div className={shown ? "ab-grid ab-shown" : "ab-grid"}>
        {items.map((k) => {
          const now = k.series?.at(-1);
          // Variation du cumul au même jour du mois précédent ; rien si la base est nulle.
          const delta = now !== undefined && k.prev ? ((now - k.prev) / Math.abs(k.prev)) * 100 : null;
          return (
            <section key={k.label} className="ab-card w4 kpi" aria-label={k.label}>
              <div className="kpi-split">
                <div>
                  <div className="ab-label">{k.label}</div>
                  <div className="kpi-value">
                    <span className={k.value < 0 ? "ab-big ab-num neg" : "ab-big ab-num"}><CountUp value={k.value} /></span>
                    <span title="Cumul comparé au même jour du mois précédent"><Delta value={delta} upIsGood={k.upIsGood} /></span>
                  </div>
                  <div className="ab-note">{k.note}</div>
                </div>
                {k.series && <Spark series={k.series} colors={k.colors} label={k.label} />}
              </div>
            </section>
          );
        })}
      </div>
    </MoneyContext.Provider>
  );
}
