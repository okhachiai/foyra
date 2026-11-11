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

import { type KeyboardEvent, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/app/i18n";

const SIZE = 240;
const C = SIZE / 2;
const R = 90;
const STROKE = 22;
// Degrees left empty between categories.
const GAP = 2.4;

interface SpendingCategory {
  name: string;
  amount: number;
  /** Change from last month, in percent; omitted when there is nothing to compare. */
  change?: number;
  /** Segment and legend dot color (any CSS color). */
  color: string;
}

interface SpendingRingProps {
  title: string;
  categories: SpendingCategory[];
  currency: string;
}

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

export default function SpendingRing({
  title,
  categories,
  currency,
}: SpendingRingProps) {
  const { t, intl } = useI18n();
  const [picked, setSelected] = useState(0);
  // New data with fewer categories keeps a valid selection.
  const selected = Math.min(picked, Math.max(categories.length - 1, 0));

  const total = categories.reduce((sum, c) => sum + c.amount, 0);
  const spans = useMemo(() => {
    let at = 0;
    return categories.map((c) => {
      const sweep = total ? (c.amount / total) * 360 : 360 / categories.length;
      const span = { from: at, to: at + sweep };
      at += sweep;
      return span;
    });
  }, [categories, total]);

  const money = useMemo(
    () =>
      new Intl.NumberFormat(intl, {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      }),
    [currency, intl]
  );

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
      setSelected(next);
    }
  };

  const current = categories[selected];
  const share = total && current ? (current.amount / total) * 100 : 0;
  const change = current?.change;

  return (
    <div
      className="w-full text-foreground"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-base font-semibold tracking-tight text-heading">{title}</h2>
        <p className="m-0 font-medium text-sm tabular-nums text-heading">
          {money.format(total)}
        </p>
      </div>

      <div
        aria-label={t("Spending by category. Arrow keys pick a category.")}
        aria-valuemax={categories.length}
        aria-valuemin={1}
        aria-valuenow={selected + 1}
        aria-valuetext={
          current ? `${current.name}, ${money.format(current.amount)}` : ""
        }
        className="relative mx-auto mt-3 aspect-square w-full max-w-[240px] select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-panel"
        onKeyDown={handleKeyDown}
        role="slider"
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
        >
          <g>
            {spans.map((span, i) => {
              const category = categories[i];
              const on = i === selected;
              return (
                <path
                  className={cn(
                    "cursor-pointer transition-[stroke-width,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    !on && "opacity-45"
                  )}
                  d={arc(span.from + GAP / 2, span.to - GAP / 2)}
                  fill="none"
                  key={category.name}
                  onClick={() => setSelected(i)}
                  stroke={category.color}
                  strokeWidth={on ? STROKE + 8 : STROKE}
                />
              );
            })}
          </g>
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
              {t("{pct}% of total", { pct: share.toFixed(0) })}
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
                  ? t("Same as last month")
                  : `${change > 0 ? "▲" : "▼"} ${t("{pct}% vs last month", { pct: Math.abs(change).toLocaleString(intl, { maximumFractionDigits: 1 }) })}`}
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
                "flex min-h-0 w-full items-center justify-start gap-2 border-0 px-2 py-1.5 text-start font-normal text-xs transition-colors duration-150 ease-out hover:translate-y-0 hover:shadow-none",
                i === selected
                  ? "bg-raised text-heading"
                  : "bg-transparent text-muted hover:bg-raised hover:text-heading"
              )}
              onClick={() => setSelected(i)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0"
                style={{ background: category.color }}
              />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              <span className="tabular-nums">
                {money.format(Math.round(category.amount)).replace(/[.,]00(?!\d)/, "")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
