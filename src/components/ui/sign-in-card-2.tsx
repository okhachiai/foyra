"use client";

import { useState, type ReactNode } from "react";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/app/form";
import { Beams } from "./card";

const NOISE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

const INPUT =
  "h-11 min-h-0 w-full rounded-lg border-transparent bg-white/5 pl-10 text-white placeholder:text-white/30 hover:border-transparent focus:border-white/20 focus:bg-white/10 focus:shadow-none";
const ICON = "pointer-events-none absolute left-3 h-4 w-4 text-white/40 transition-colors duration-300 group-focus-within/field:text-white";
const FIELD = "group/field relative flex items-center transition-transform duration-200 hover:scale-[1.01]";

/** Icône au trait 24×24 (tracés repris de Lucide, ISC). */
const Icon = ({ className, children }: { className: string; children: ReactNode }) => (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {children}
  </svg>
);

const clamp = (v: number) => Math.max(-10, Math.min(10, v));

/** Carte de connexion animée (effet 3D, faisceaux lumineux), branchée sur loginAction. */
export function SignInCard() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-black px-4">
      <div className="absolute inset-0 bg-gradient-to-b from-purple-500/40 via-purple-700/50 to-black" />
      <div className="absolute inset-0 opacity-[0.03] mix-blend-soft-light" style={{ backgroundImage: NOISE, backgroundSize: "200px 200px" }} />
      <div className="absolute left-1/2 top-0 h-[60vh] w-[120vh] -translate-x-1/2 rounded-b-[50%] bg-purple-400/20 blur-[80px]" />
      <div className="absolute left-1/2 top-0 h-[60vh] w-[100vh] -translate-x-1/2 motion-safe:animate-pulse rounded-b-full bg-purple-300/20 blur-[60px] [animation-duration:8s]" />
      <div className="absolute bottom-0 left-1/2 h-[90vh] w-[90vh] -translate-x-1/2 motion-safe:animate-pulse rounded-t-full bg-purple-400/20 blur-[60px] [animation-duration:6s]" />
      <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-pulse rounded-full bg-white/5 opacity-40 blur-[100px]" />
      <div className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-pulse rounded-full bg-white/5 opacity-40 blur-[100px] delay-1000" />

      <div className="relative z-10 w-full max-w-sm transition duration-700 starting:translate-y-5 starting:opacity-0" style={{ perspective: 1500 }}>
        <div
          className="group relative transition-transform duration-200 ease-out"
          onMouseMove={(e) => {
            if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2, y = e.clientY - rect.top - rect.height / 2;
            e.currentTarget.style.transform = `rotateX(${clamp(-y / 30)}deg) rotateY(${clamp(x / 30)}deg)`;
          }}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
        >
          <Beams />
          <div className="absolute -inset-[0.5px] rounded-2xl bg-gradient-to-r from-white/3 via-white/7 to-white/3 opacity-0 transition-opacity duration-500 group-hover:opacity-70" />

          <div className="relative overflow-hidden rounded-2xl border border-white/[0.05] bg-black/40 p-6 shadow-2xl backdrop-blur-xl">
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage: "linear-gradient(135deg, white 0.5px, transparent 0.5px), linear-gradient(45deg, white 0.5px, transparent 0.5px)",
                backgroundSize: "30px 30px",
              }}
            />

            <div className="relative mb-5 space-y-1 text-center">
              <div className="relative mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10 transition duration-700 starting:scale-50 starting:opacity-0">
                <span className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-lg font-bold text-transparent">F</span>
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
              </div>
              <h1 className="m-0 bg-gradient-to-b from-white to-white/80 bg-clip-text text-xl font-bold text-transparent transition delay-200 duration-500 starting:translate-y-2.5 starting:opacity-0">
                Foyra
              </h1>
              <p className="m-0 text-xs text-white/60 transition-opacity delay-300 duration-500 starting:opacity-0">Connectez-vous pour accéder aux comptes du foyer</p>
            </div>

            <ActionForm action={loginAction} className="form group/form relative text-sm">
              <label className={FIELD}>
                <span className="sr-only">Email</span>
                <Icon className={ICON}>
                  <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                </Icon>
                <input name="email" type="email" required autoComplete="email" placeholder="Email" className={INPUT} />
              </label>

              <div className={FIELD}>
                <Icon className={ICON}>
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </Icon>
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Mot de passe"
                  aria-label="Mot de passe"
                  className={`${INPUT} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  className="absolute right-1 min-h-0 border-0 bg-transparent p-2 text-white/40 hover:text-white hover:shadow-none hover:transform-none"
                >
                  {showPassword ? (
                    <Icon className="h-4 w-4">
                      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                      <circle cx="12" cy="12" r="3" />
                    </Icon>
                  ) : (
                    <Icon className="h-4 w-4">
                      <path d="m15 18-.722-3.25" />
                      <path d="M2 8a10.645 10.645 0 0 0 20 0" />
                      <path d="m20 15-1.726-2.05" />
                      <path d="m4 15 1.726-2.05" />
                      <path d="m9 18 .722-3.25" />
                    </Icon>
                  )}
                </button>
              </div>

              <button
                type="submit"
                className="group/button relative mt-2 block w-full min-h-0 border-0 bg-transparent p-0 transition-transform duration-200 hover:scale-[1.02] hover:shadow-none active:scale-[0.98]"
              >
                <div className="absolute inset-0 rounded-lg bg-white/10 opacity-0 blur-lg transition-opacity duration-300 group-hover/button:opacity-70" />
                <div className="relative flex h-11 items-center justify-center overflow-hidden rounded-lg bg-white font-medium text-black">
                  <div className="hidden h-4 w-4 animate-spin rounded-full border-2 border-black/70 border-t-transparent group-aria-busy/form:block" />
                  <span className="flex items-center justify-center gap-1 text-sm font-medium group-aria-busy/form:hidden">
                    Se connecter
                    <Icon className="h-3 w-3 transition-transform duration-300 group-hover/button:translate-x-1">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </Icon>
                  </span>
                </div>
              </button>
            </ActionForm>
          </div>
        </div>
      </div>
    </div>
  );
}
