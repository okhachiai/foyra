"use client";
import { useState } from "react";
import { useI18n } from "@/app/i18n";
import { ActionForm } from "@/app/form";
import { applyPlanAction } from "@/app/actions";
import { formatCents, parseCents } from "@/lib/money";
import type { PlanInput, PlanOutput } from "@/lib/report";

export function AllocationEditor({ reportId, input, output, locked }: { reportId: string; input: PlanInput; output: PlanOutput; locked: string | null }) {
  const { t, intl } = useI18n();
  const [values, setValues] = useState(() => Object.fromEntries(output.lines.map((l) => [l.budgetItemId, (l.amount / 100).toFixed(2)])));
  const parsed = input.lines.map((l) => parseCents(values[l.id] ?? "", { allowSigned: true }));
  const valid = parsed.every((n) => n !== null && n >= 0);
  const total = parsed.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const money = (n: number) => formatCents(n, "EUR", intl);
  const balanced = valid && total === input.toDistribute;
  return (
    <ActionForm action={applyPlanAction} className="form" confirm={t("Replace the variable expense amounts with the allocation shown here? Other budget lines remain unchanged.")}>
      <input type="hidden" name="reportId" value={reportId} />
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t("Line")}</th><th className="num hidden sm:table-cell">{t("Before proposal")}</th><th className="num">{t("Proposed")}</th></tr></thead>
          <tbody>{input.lines.map((l) => {
            const proposal = output.lines.find((x) => x.budgetItemId === l.id);
            const amount = parseCents(values[l.id] ?? "", { allowSigned: true });
            return <tr key={l.id}>
              <td className="break-words">{l.label}<small className="block text-muted">{proposal?.reason}</small><small className="block text-muted sm:hidden">{t("planned {amount}", { amount: money(l.planned) })}</small><small className="block text-muted">{t("Spending recorded in {n} of three months", { n: l.history.filter((n) => n > 0).length })}</small></td>
              <td className="num hidden sm:table-cell">{money(l.planned)}</td>
              <td><input aria-label={t("Allocation for {label}", { label: l.label })} name={`allocation:${l.id}`} inputMode="decimal" maxLength={18} disabled={!!locked} value={values[l.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [l.id]: e.target.value }))} /><small className="block text-end text-muted">{amount !== null && t("Change: {amount}", { amount: money(amount - l.planned) })}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <p role="status" className={balanced ? "text-muted" : "text-neg"}>{t("Allocated {amount} of {available}", { amount: money(total), available: money(input.toDistribute) })}</p>
      <button type="submit" disabled={!!locked || !balanced} className="self-start">{t("Apply to the budget")}</button>
      {locked && <p className="text-label text-muted">{locked}</p>}
    </ActionForm>
  );
}
