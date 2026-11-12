"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh persisted job state; generation continues independently of this page. */
export function ReportRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 4000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
