"use client";

import { useState } from "react";
import { motion, MotionConfig, useMotionValue, useTransform } from "framer-motion";
import { Mail, Lock, Eye, EyeClosed, ArrowRight } from "lucide-react";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/app/form";

const NOISE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// Faisceaux lumineux qui parcourent les 4 bords de la carte, l'un après l'autre.
const BEAMS = [
  { side: "left", className: "top-0 h-[3px] w-1/2 bg-gradient-to-r", delay: 0 },
  { side: "top", className: "right-0 h-1/2 w-[3px] bg-gradient-to-b", delay: 0.6 },
  { side: "right", className: "bottom-0 h-[3px] w-1/2 bg-gradient-to-r", delay: 1.2 },
  { side: "bottom", className: "left-0 h-1/2 w-[3px] bg-gradient-to-b", delay: 1.8 },
] as const;

const INPUT =
  "h-11 min-h-0 w-full rounded-lg border-transparent bg-white/5 pl-10 text-white placeholder:text-white/30 hover:border-transparent focus:border-white/20 focus:bg-white/10 focus:shadow-none";

/** Carte de connexion animée (effet 3D, faisceaux lumineux), branchée sur loginAction. */
export function SignInCard() {
  const [showPassword, setShowPassword] = useState(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-300, 300], [10, -10]);
  const rotateY = useTransform(mouseX, [-300, 300], [-10, 10]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-dvh w-full items-center justify-center overflow-hidden bg-black px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-500/40 via-purple-700/50 to-black" />
        <div className="absolute inset-0 opacity-[0.03] mix-blend-soft-light" style={{ backgroundImage: NOISE, backgroundSize: "200px 200px" }} />
        <div className="absolute left-1/2 top-0 h-[60vh] w-[120vh] -translate-x-1/2 rounded-b-[50%] bg-purple-400/20 blur-[80px]" />
        <motion.div
          className="absolute left-1/2 top-0 h-[60vh] w-[100vh] -translate-x-1/2 rounded-b-full bg-purple-300/20 blur-[60px]"
          animate={{ opacity: [0.15, 0.3, 0.15], scale: [0.98, 1.02, 0.98] }}
          transition={{ duration: 8, repeat: Infinity, repeatType: "mirror" }}
        />
        <motion.div
          className="absolute bottom-0 left-1/2 h-[90vh] w-[90vh] -translate-x-1/2 rounded-t-full bg-purple-400/20 blur-[60px]"
          animate={{ opacity: [0.3, 0.5, 0.3], scale: [1, 1.1, 1] }}
          transition={{ duration: 6, repeat: Infinity, repeatType: "mirror", delay: 1 }}
        />
        <div className="absolute left-1/4 top-1/4 h-96 w-96 animate-pulse rounded-full bg-white/5 opacity-40 blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 animate-pulse rounded-full bg-white/5 opacity-40 blur-[100px] delay-1000" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative z-10 w-full max-w-sm"
          style={{ perspective: 1500 }}
        >
          <motion.div
            className="group relative"
            style={{ rotateX, rotateY }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              mouseX.set(e.clientX - rect.left - rect.width / 2);
              mouseY.set(e.clientY - rect.top - rect.height / 2);
            }}
            onMouseLeave={() => {
              mouseX.set(0);
              mouseY.set(0);
            }}
          >
            <div className="absolute -inset-[1px] overflow-hidden rounded-2xl">
              {BEAMS.map(({ side, className, delay }) => (
                <motion.div
                  key={side}
                  className={`absolute from-transparent via-white to-transparent ${className}`}
                  initial={{ filter: "blur(2px)" }}
                  animate={{ [side]: ["-50%", "100%"], opacity: [0.3, 0.7, 0.3], filter: ["blur(1px)", "blur(2.5px)", "blur(1px)"] }}
                  transition={{
                    [side]: { duration: 2.5, ease: "easeInOut" as const, repeat: Infinity, repeatDelay: 1, delay },
                    opacity: { duration: 1.2, repeat: Infinity, repeatType: "mirror", delay },
                    filter: { duration: 1.5, repeat: Infinity, repeatType: "mirror", delay },
                  }}
                />
              ))}
            </div>
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
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.8 }}
                  className="relative mx-auto flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10"
                >
                  <span className="bg-gradient-to-b from-white to-white/70 bg-clip-text text-lg font-bold text-transparent">F</span>
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
                </motion.div>
                <motion.h1
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="m-0 bg-gradient-to-b from-white to-white/80 bg-clip-text text-xl font-bold text-transparent"
                >
                  Foyra
                </motion.h1>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="m-0 text-xs text-white/60">
                  Connectez-vous pour accéder aux comptes du foyer
                </motion.p>
              </div>

              <ActionForm action={loginAction} className="form group/form relative text-sm">
                <motion.label className="group/field relative flex items-center" whileHover={{ scale: 1.01 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
                  <span className="sr-only">Email</span>
                  <Mail className="pointer-events-none absolute left-3 h-4 w-4 text-white/40 transition-colors duration-300 group-focus-within/field:text-white" />
                  <input name="email" type="email" required autoComplete="email" placeholder="Email" className={INPUT} />
                </motion.label>

                <motion.div className="group/field relative flex items-center" whileHover={{ scale: 1.01 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
                  <Lock className="pointer-events-none absolute left-3 h-4 w-4 text-white/40 transition-colors duration-300 group-focus-within/field:text-white" />
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
                    {showPassword ? <Eye className="h-4 w-4" /> : <EyeClosed className="h-4 w-4" />}
                  </button>
                </motion.div>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  className="group/button relative mt-2 block w-full min-h-0 border-0 bg-transparent p-0 hover:shadow-none"
                >
                  <div className="absolute inset-0 rounded-lg bg-white/10 opacity-0 blur-lg transition-opacity duration-300 group-hover/button:opacity-70" />
                  <div className="relative flex h-11 items-center justify-center overflow-hidden rounded-lg bg-white font-medium text-black">
                    <div className="hidden h-4 w-4 animate-spin rounded-full border-2 border-black/70 border-t-transparent group-aria-busy/form:block" />
                    <span className="flex items-center justify-center gap-1 text-sm font-medium group-aria-busy/form:hidden">
                      Se connecter
                      <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover/button:translate-x-1" />
                    </span>
                  </div>
                </motion.button>
              </ActionForm>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </MotionConfig>
  );
}
