/*
MIT License

Copyright (c) 2025 kokonutUI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
"use client";

/**
 * @author: @dorianbaffier
 * @description: Spending Ring
 * @version: 1.0.0
 * @date: 2026-10-15
 * @license: MIT
 * @website: https://kokonutui.com
 * @github: https://github.com/kokonut-labs/kokonutui
 */

import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

const SIZE = 240;
const C = SIZE / 2;
const R = 90;
const STROKE = 22;
// Degrees left empty between categories.
const GAP = 2.4;
// Spring for the ring's angle: rate in rad/s and damping ratio. A touch under
// critical so a flick settles onto its category with a small give.
const RATE = 11;
const DAMPING = 0.78;
// How far ahead a flick is projected when choosing where it lands, in seconds.
const PROJECT = 0.2;
// Movement under this many pixels is a tap, not a spin.
const TAP_SLOP = 5;

export interface SpendingCategory {
  name: string;
  amount: number;
  /** Change from last month, in percent; omitted when there is nothing to compare. */
  change?: number;
  /** Segment and legend dot color (any CSS color). */
  color: string;
}

export interface SpendingRingProps {
  title: string;
  categories: SpendingCategory[];
  currency?: string;
  className?: string;
}

/** Wraps an angle into -180..180. */
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** A point on the ring, with 0° at the top and angles running clockwise. */
function polar(deg: number, r = R) {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)] as const;
}

function arc(from: number, to: number) {
  const [x0, y0] = polar(from);
  const [x1, y1] = polar(to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** The category whose slice covers an angle on the ring. */
function sliceAt(spans: { from: number; to: number }[], deg: number) {
  const a = ((deg % 360) + 360) % 360;
  const index = spans.findIndex((s) => a >= s.from && a < s.to);
  return index === -1 ? 0 : index;
}

/** One step of a damped spring, in small slices for stability. */
function springStep(
  state: { a: number; v: number },
  target: number,
  dt: number
) {
  const slices = Math.ceil(dt / (1 / 240));
  const h = dt / slices;
  for (let i = 0; i < slices; i++) {
    const accel =
      -RATE * RATE * (state.a - target) - 2 * DAMPING * RATE * state.v;
    state.v += accel * h;
    state.a += state.v * h;
  }
  return Math.abs(state.a - target) < 0.05 && Math.abs(state.v) < 2;
}

export default function SpendingRing({
  title,
  categories,
  currency = "EUR",
  className,
}: SpendingRingProps) {
  const [selected, setSelected] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const ringRef = useRef<SVGGElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(0);

  const total = categories.reduce((sum, c) => sum + c.amount, 0);
  const spans = useMemo(() => {
    let at = 0;
    return categories.map((c) => {
      const sweep = total ? (c.amount / total) * 360 : 360 / categories.length;
      const span = { from: at, to: at + sweep, mid: at + sweep / 2 };
      at += sweep;
      return span;
    });
  }, [categories, total]);

  // The ring turns so the selected slice sits under the marker at the top.
  const sim = useRef({
    a: -(spans[0]?.mid ?? 0),
    v: 0,
    target: -(spans[0]?.mid ?? 0),
    raf: 0,
    last: 0,
    // While a flick coasts, the readout follows whatever passes the marker.
    coast: false,
    drag: null as null | {
      id: number;
      angle: number;
      time: number;
      moved: number;
      x: number;
      y: number;
    },
  });

  const money = useMemo(
    () =>
      new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }),
    [currency]
  );

  const paint = useCallback(() => {
    ringRef.current?.setAttribute(
      "transform",
      `rotate(${sim.current.a.toFixed(3)} ${C} ${C})`
    );
  }, []);

  /** Show whichever slice is under the marker right now. */
  const track = useCallback(() => {
    const index = sliceAt(spans, -sim.current.a);
    if (index !== selectedRef.current) {
      selectedRef.current = index;
      setSelected(index);
    }
  }, [spans]);

  const tick = useCallback(
    (now: number) => {
      const s = sim.current;
      s.raf = 0;
      if (s.drag) {
        return;
      }
      const dt = s.last ? Math.min((now - s.last) / 1000, 1 / 30) : 1 / 60;
      s.last = now;
      const state = { a: s.a, v: s.v };
      const settled = springStep(state, s.target, dt);
      s.a = settled ? s.target : state.a;
      s.v = settled ? 0 : state.v;
      paint();
      if (s.coast) {
        track();
      }
      if (settled) {
        s.last = 0;
        s.coast = false;
        setSpinning(false);
      } else {
        s.raf = requestAnimationFrame(tick);
      }
    },
    [paint, track]
  );

  /**
   * Turn the ring to a slice, the short way round from where it would come to
   * rest on its own (a flick keeps going the way it was thrown).
   */
  const turnTo = useCallback(
    (index: number, rest = sim.current.a, coast = false) => {
      const s = sim.current;
      const goal = -(spans[index]?.mid ?? 0);
      s.target = rest + wrap(goal - rest);
      s.coast = coast;
      if (!coast) {
        selectedRef.current = index;
        setSelected(index);
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        s.a = s.target;
        s.v = 0;
        s.coast = false;
        paint();
        track();
        return;
      }
      setSpinning(true);
      if (!s.raf) {
        s.last = 0;
        s.raf = requestAnimationFrame(tick);
      }
    },
    [paint, spans, tick, track]
  );

  // New data keeps the same slice under the marker.
  useEffect(() => {
    const s = sim.current;
    const index = Math.min(selectedRef.current, spans.length - 1);
    s.a = -(spans[index]?.mid ?? 0);
    s.target = s.a;
    s.v = 0;
    selectedRef.current = index;
    setSelected(index);
    paint();
  }, [spans, paint]);

  useEffect(() => () => cancelAnimationFrame(sim.current.raf), []);

  const pointerAngle = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    return (Math.atan2(x, -y) * 180) / Math.PI;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (s.drag || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    cancelAnimationFrame(s.raf);
    s.raf = 0;
    s.v = 0;
    s.drag = {
      id: event.pointerId,
      angle: pointerAngle(event),
      time: event.timeStamp,
      moved: 0,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    const drag = s.drag;
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    drag.moved = Math.max(
      drag.moved,
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y)
    );
    if (drag.moved < TAP_SLOP) {
      return;
    }
    const angle = pointerAngle(event);
    const delta = wrap(angle - drag.angle);
    const dt = Math.max((event.timeStamp - drag.time) / 1000, 1 / 240);
    s.a += delta;
    // Smoothed angular speed, for the flick on release.
    s.v = s.v * 0.6 + (delta / dt) * 0.4;
    drag.angle = angle;
    drag.time = event.timeStamp;
    setSpinning(true);
    paint();
    track();
  };

  const release = (event: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    const drag = s.drag;
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    s.drag = null;
    if (drag.moved < TAP_SLOP) {
      // A tap on the ring picks the slice under the finger; the middle is
      // only a readout.
      const rect = event.currentTarget.getBoundingClientRect();
      const r = Math.hypot(
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2
      );
      if (r > ((R - STROKE) / SIZE) * rect.width) {
        turnTo(sliceAt(spans, pointerAngle(event) - s.a));
      }
      return;
    }
    // A stale drag (held still before letting go) has no flick left in it.
    if (event.timeStamp - drag.time > 80) {
      s.v = 0;
    }
    s.v = Math.max(-1440, Math.min(1440, s.v));
    const rest = s.a + s.v * PROJECT;
    turnTo(sliceAt(spans, -rest), rest, true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    let next: number | null = null;
    if (event.key in step) {
      next =
        (selected + step[event.key] + categories.length) % categories.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = categories.length - 1;
    }
    if (next !== null) {
      event.preventDefault();
      turnTo(next);
    }
  };

  const current = categories[selected];
  const share = total && current ? (current.amount / total) * 100 : 0;
  const change = current?.change;

  return (
    <div
      className={cn(
        "w-full text-foreground",
        className
      )}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-base font-semibold tracking-tight text-heading">{title}</h2>
        <p className="m-0 font-medium text-sm tabular-nums text-heading">
          {money.format(total)}
        </p>
      </div>

      <div
        aria-label="Dépenses par catégorie. Flèches pour tourner l’anneau."
        aria-valuemax={categories.length}
        aria-valuemin={1}
        aria-valuenow={selected + 1}
        aria-valuetext={
          current ? `${current.name}, ${money.format(current.amount)}` : ""
        }
        className={cn(
          "relative mx-auto mt-3 aspect-square w-full max-w-[240px] touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-panel",
          spinning ? "cursor-grabbing" : "cursor-grab"
        )}
        onKeyDown={handleKeyDown}
        onLostPointerCapture={release}
        onPointerCancel={release}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={release}
        ref={surfaceRef}
        role="slider"
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
        >
          <g ref={ringRef} transform={`rotate(${sim.current.a} ${C} ${C})`}>
            {spans.map((span, i) => {
              const category = categories[i];
              const on = i === selected;
              return (
                <path
                  className={cn(
                    "transition-[stroke-width,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    !on && "opacity-45"
                  )}
                  d={arc(span.from + GAP / 2, span.to - GAP / 2)}
                  fill="none"
                  key={category.name}
                  stroke={category.color}
                  strokeWidth={on ? STROKE + 8 : STROKE}
                />
              );
            })}
          </g>
          {/* The marker the ring turns slices to. */}
          <path
            className="fill-heading"
            d={`M${C - 5} 2 L${C + 5} 2 L${C} 8 Z`}
          />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div
            className="starting:translate-y-1 starting:opacity-0 transition-[opacity,translate] duration-200 ease-out"
            key={current?.name}
          >
            <p className="m-0 flex items-center justify-center gap-1.5 text-xs text-muted">
              <span className="size-1.5" style={{ background: current?.color }} />
              {current?.name}
            </p>
            <p className="m-0 mt-0.5 font-semibold text-2xl tabular-nums tracking-tight text-heading">
              {current ? money.format(current.amount) : ""}
            </p>
            <p className="m-0 mt-0.5 text-xs text-muted tabular-nums">
              {share.toFixed(0)} % du total
            </p>
            {change !== undefined && (
              <p
                className={cn(
                  "m-0 mt-0.5 text-xs tabular-nums",
                  change > 0 && "text-neg",
                  change < 0 && "text-pos",
                  change === 0 && "text-faint"
                )}
              >
                {change === 0
                  ? "Comme le mois dernier"
                  : `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % vs mois dernier`}
              </p>
            )}
          </div>
        </div>
      </div>

      <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-1 p-0">
        {categories.map((category, i) => (
          <li key={category.name}>
            <button
              aria-pressed={i === selected}
              className={cn(
                "flex min-h-0 w-full items-center justify-start gap-2 border-0 px-2 py-1.5 text-left font-normal text-xs transition-colors duration-150 ease-out hover:translate-y-0 hover:shadow-none",
                i === selected
                  ? "bg-raised text-heading"
                  : "bg-transparent text-muted hover:bg-raised hover:text-heading"
              )}
              onClick={() => turnTo(i)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: category.color }}
              />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              <span className="tabular-nums">
                {money.format(Math.round(category.amount)).replace(",00", "")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
