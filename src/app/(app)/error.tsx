"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useI18n } from "@/app/i18n";

/** Unexpected error on a signed-in page: neutral message (no technical detail shown), retry or go back. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="card mx-auto mt-8 flex max-w-lg flex-col items-start gap-3 p-6">
      <span className="kpi-icon expense"><Icon name="alert" className="size-4" /></span>
      <h1 className="m-0 text-section">{t("This page could not be displayed")}</h1>
      <p className="m-0 text-muted">{t("An unexpected error occurred. Your data was not changed by this page.")}</p>
      <div className="form-actions mt-1 w-full">
        <button type="button" onClick={reset}>{t("Try again")}</button>
        <Link href="/dashboard" className="button secondary">{t("Dashboard")}</Link>
      </div>
    </div>
  );
}
