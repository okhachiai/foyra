"use client";

import * as React from "react";
import type { DashboardCharts } from "@/lib/dashboard";
import SpendingRing from "@/components/ui/kokonut-spending-ring";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatWhole } from "@/lib/money";

/*
 * Bento analytique (adapté de « Analytics Bento », vasnev.art) : entrées/sorties, dépenses par catégorie, saisonnalité.
 * SVG seul, sans bibliothèque de graphiques ; styles dans globals.css (.ab-*). Montants en centimes.
 */

// Palette Foyra : vert = entrées, terracotta = sorties ; teintes de catégories accordées au vert et à la terre cuite.
const COLORS = {
  income: ["var(--chart-1-soft)", "var(--chart-1)"],
  expense: ["var(--chart-2-soft)", "var(--chart-2)"],
  radar: "var(--chart-1)",
  // Couleur d'un groupe de catégories (tokens --chart-*, clair et sombre).
  groups: [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-${n})`),
  none: "var(--chart-none)",
} as const;
const MONTHS = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MONO = "var(--font-sans), system-ui, sans-serif";

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

type Categories = DashboardCharts["categories"];
const groupColor = (groups: Categories["groups"], id: string) =>
  id === "none" ? COLORS.none : COLORS.groups[groups.findIndex((g) => g.id === id) % COLORS.groups.length];

/** Dépenses du mois par catégorie de premier niveau, une couleur par groupe, évolution vs le mois précédent. */
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
        color: groupColor(data.groups, g.id),
      }));
  }, [data]);
  return <SpendingRing title="Dépenses par catégorie" categories={categories} currency={currency} />;
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
  const money = useMoney(currency);
  const tip = React.useRef<TipApi | null>(null);
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

/* ---------------- indicateurs du haut : carte principale + cartes secondaires ---------------- */

const useMoney = (currency: string) => React.useCallback((cents: number) => formatWhole(cents, currency), [currency]);

/** Mini-courbe d'un cumul (aire en dégradé + trait). `colors` : [départ, trait]. */
function Spark({ series, colors, label }: { series: number[]; colors: readonly [string, string]; label: string }) {
  const [ref, { w: W, h: H }] = useSize();
  const id = React.useId().replace(/:/g, "");
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const X = (i: number) => (i / (series.length - 1)) * (W - 6) + 3;
  const Y = (v: number) => 4 + (1 - (v - min) / span) * (H - 8);
  const P = series.map((v, i) => [X(i), Y(v)] as [number, number]);
  const line = smooth(P), end = P[P.length - 1];
  return (
    <div ref={ref} className="kpi-chart">
      {W > 0 && series.length > 1 && (
        <svg width={W} height={H} role="img" aria-label={`${label} cumulé jour par jour ce mois-ci`}>
          <defs>
            <linearGradient id={`${id}a`} x1={0} x2={0} y1={0} y2={1}>
              <stop offset="0" stopColor={colors[1]} stopOpacity={0.24} />
              <stop offset="1" stopColor={colors[1]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line}L${end[0]},${H}L${P[0][0]},${H}Z`} fill={`url(#${id}a)`} />
          <path d={line} fill="none" stroke={colors[1]} strokeWidth={2} strokeLinecap="round" />
          <circle cx={end[0]} cy={end[1]} r={3.5} fill="var(--surface)" stroke={colors[1]} strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

export type Kpi = {
  label: string; icon: IconName; tone: "hero" | "accent" | "expense" | "info"; value: number; note: string;
  series: number[] | null; prev: number | null; upIsGood?: boolean; colors: readonly [string, string];
  /** À la place de la courbe : avancement réel / prévu (épargne). */
  progress?: { value: number; max: number; label: string };
};

/** Variation du cumul au même jour du mois précédent ; rien si la base est nulle. */
const deltaOf = (k: { series: number[] | null; prev: number | null }) => {
  const now = k.series?.at(-1);
  return now !== undefined && k.prev ? ((now - k.prev) / Math.abs(k.prev)) * 100 : null;
};

/** Quatre indicateurs de même gabarit ; `tone: "hero"` = la carte principale, vert profond. */
export function KpiRow({ currency, items }: { currency: string; items: Kpi[] }) {
  const money = useMoney(currency);
  return (
    <MoneyContext.Provider value={money}>
      <div className="dash-kpis">
        {items.map((k) => {
          const hero = k.tone === "hero";
          return (
            <section key={k.label} className={hero ? "card card-hero kpi-card" : "card kpi-card"} aria-label={k.label}>
              <div className="kpi-top">
                <span className={`kpi-icon ${k.tone}`}><Icon name={k.icon} className="size-4" /></span>
                <span className="kpi-title min-w-0 truncate">{k.label}</span>
                {!hero && <span className="ml-auto shrink-0" title="Cumul comparé au même jour du mois précédent"><Delta value={deltaOf(k)} upIsGood={k.upIsGood} /></span>}
              </div>
              <strong className={k.value < 0 && !hero ? "kpi-value text-neg" : "kpi-value"}><CountUp value={k.value} /></strong>
              {k.progress ? (
                <div className="kpi-progress">
                  <progress
                    className={k.tone === "info" ? "progress info" : "progress"}
                    value={Math.max(Math.min(k.progress.value, k.progress.max || 1), 0)}
                    max={k.progress.max || 1}
                    aria-label={k.progress.label}
                  />
                </div>
              ) : k.series ? (
                <Spark series={k.series} colors={k.colors} label={k.label} />
              ) : (
                <div className="kpi-chart" />
              )}
              <div className="kpi-note">{k.note}</div>
            </section>
          );
        })}
      </div>
    </MoneyContext.Provider>
  );
}

/* ---------------- cash-flow : revenus et dépenses par mois, reste en ligne ---------------- */

const RANGES = [["3M", 3], ["6M", 6], ["12M", 12]] as const;

/** Graduations lisibles couvrant [lo, hi] : pas en 1/2/2,5/5 × 10ⁿ, environ 3 intervalles, 0 toujours inclus. */
export function axisTicks(lo: number, hi: number) {
  const span = Math.max(hi - lo, 1) / 3;
  const p = 10 ** Math.floor(Math.log10(span));
  const step = ([1, 2, 2.5, 5, 10].find((r) => span <= r * p) ?? 10) * p;
  const bottom = Math.floor(lo / step) * step, top = Math.max(Math.ceil(hi / step) * step, bottom + step);
  return Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, k) => bottom + k * step);
}

export function CashFlow({ currency, data }: { currency: string; data: DashboardCharts["monthly"] }) {
  const money = useMoney(currency);
  const [range, setRange] = React.useState(1);
  const n = RANGES[range][1];
  const labels = data.labels.slice(-n), income = data.income.slice(-n), expense = data.expense.slice(-n);
  const net = income.map((v, i) => v - expense[i]);
  const last = labels.length - 1;
  const avg = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
  const rate = income[last] ? (net[last] / income[last]) * 100 : null;
  const tip = React.useRef<TipApi | null>(null);

  return (
    <MoneyContext.Provider value={money}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="ab-legend m-0">
          <span><i style={{ background: COLORS.income[1] }} />Revenus</span>
          <span><i style={{ background: COLORS.expense[1] }} />Dépenses</span>
          <span><i className="line" style={{ background: "var(--heading)" }} />Résultat</span>
        </div>
        <Segmented label="Période" items={RANGES.map((r) => r[0])} value={range} onChange={setRange} />
      </div>
      <Bars labels={labels} income={income} expense={expense} net={net} tip={tip} />
      {/* aria-label plutôt que <caption> : la légende échappe au clip de .sr-only et s'affichait par-dessus le titre. */}
      <table className="sr-only" aria-label="Revenus, dépenses et résultat par mois">
        <thead><tr><th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Résultat</th></tr></thead>
        <tbody>
          {labels.map((l, i) => <tr key={l + i}><td>{l}</td><td>{money(income[i])}</td><td>{money(expense[i])}</td><td>{money(net[i])}</td></tr>)}
        </tbody>
      </table>
      <dl className="cash-stats">
        <div><dt>Revenus moyens</dt><dd className="ab-num">{money(avg(income))}</dd></div>
        <div><dt>Dépenses moyennes</dt><dd className="ab-num">{money(avg(expense))}</dd></div>
        <div><dt>Résultat / revenus ({labels[last]})</dt><dd className="ab-num">{rate === null ? "—" : `${rate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`}</dd></div>
      </dl>
      <Tooltip api={tip} />
    </MoneyContext.Provider>
  );
}

function Bars({ labels, income, expense, net, tip }: { labels: string[]; income: number[]; expense: number[]; net: number[]; tip: TipRef }) {
  const money = React.useContext(MoneyContext);
  const [ref, { w: W, h: H }] = useSize();
  const [hover, setHover] = React.useState<number | null>(null);
  const L = 44, B = 26, T = 22; // axe gauche, libellés du bas, valeurs au-dessus des barres
  const ticks = axisTicks(Math.min(...net, 0), Math.max(...income, ...expense, ...net, 0));
  const bottom = ticks[0], top = ticks.at(-1)!;
  const Y = (v: number) => T + ((top - v) / (top - bottom)) * (H - T - B);
  const step = (W - L) / labels.length;
  const bw = Math.max(Math.min(step * 0.22, 26), 4), gap = Math.min(step * 0.06, 6);
  const cx = (i: number) => L + step * (i + 0.5);
  const showValues = step > 70;
  const move = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const i = Math.min(Math.max(Math.floor((e.clientX - r.left - L) / step), 0), labels.length - 1);
    setHover(i);
    tip.current?.show(e.clientX, e.clientY, {
      title: labels[i],
      rows: [
        { label: "Revenus", value: money(income[i]), color: COLORS.income[1] },
        { label: "Dépenses", value: money(expense[i]), color: COLORS.expense[1] },
        { label: "Résultat", value: money(net[i]), color: "var(--heading)" },
      ],
    });
  };
  return (
    <div ref={ref} className="cash-chart">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label={`Revenus et dépenses par mois, de ${labels[0]} à ${labels.at(-1)}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W} y1={Y(v)} y2={Y(v)} stroke="var(--hairline)" strokeDasharray={v === 0 ? undefined : "3 4"} />
              <text x={L - 8} y={Y(v)} textAnchor="end" dominantBaseline="central" fontSize={11} fill="var(--faint)">{compact.format(v / 100)}</text>
            </g>
          ))}
          {hover !== null && <rect x={L + step * hover + 4} y={4} width={step - 8} height={H - 8} rx={10} fill="var(--surface-secondary)" />}
          {labels.map((l, i) => {
            const x = cx(i);
            const bar = (v: number, dx: number, color: string, ink: string) => (
              <g>
                <rect x={x + dx} y={Y(Math.max(v, 0))} width={bw} height={Math.max(Y(0) - Y(Math.max(v, 0)), 0)} rx={4} fill={color} />
                {showValues && v > 0 && <text x={x + dx + bw / 2} y={Y(v) - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={ink}>{compact.format(v / 100)}</text>}
              </g>
            );
            return (
              <g key={l + i}>
                {bar(income[i], -bw - gap / 2, COLORS.income[1], "var(--accent-ink)")}
                {bar(expense[i], gap / 2, COLORS.expense[1], "var(--neg)")}
                <text x={x} y={H - 6} textAnchor="middle" fontSize={12} fontWeight={i === labels.length - 1 ? 700 : 500} fill={i === labels.length - 1 ? "var(--heading)" : "var(--muted)"}>{l}</text>
              </g>
            );
          })}
          <polyline points={net.map((v, i) => `${cx(i)},${Y(v)}`).join(" ")} fill="none" stroke="var(--heading)" strokeWidth={1.75} strokeLinejoin="round" />
          {net.map((v, i) => <circle key={i} cx={cx(i)} cy={Y(v)} r={hover === i ? 4.5 : 3.5} fill="var(--surface)" stroke="var(--heading)" strokeWidth={1.75} />)}
          <rect x={L} width={W - L} height={H} fill="transparent" onPointerMove={move} onPointerLeave={leave(setHover, tip)} />
        </svg>
      )}
    </div>
  );
}
