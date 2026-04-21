"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handlePhoneSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (cooldown > 0) return; // Prevent spamming / debounce
    
    setError(null);
    if (!phone || phone.length < 10) {
      setError("Ingresa un número válido de 10 dígitos");
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `+52${phone.replace(/\D/g, "")}` }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || "Error al enviar código");
      setStep("otp");
      setCooldown(30); // 30 seconds debounce before they can send another WhatsApp message
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    // Auto-fill logic for copy-paste
    if (value.length > 1) {
      const chars = value.slice(0, 6).split("");
      const newOtp = [...otp];
      chars.forEach((c, i) => {
        if (index + i < 6) newOtp[index + i] = c;
      });
      setOtp(newOtp);
      const nextFocus = Math.min(index + chars.length, 5);
      otpRefs.current[nextFocus]?.focus();
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto focus next
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const verifyOtp = async () => {
    const code = otp.join("");
    if (code.length !== 6) return;

    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: `+52${phone.replace(/\D/g, "")}`, code }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || "Código inválido");
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
      // Trigger shake via error state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step === "otp" && otp.join("").length === 6) {
      verifyOtp();
    }
  }, [otp]);

  // Particle background canvas setup
  useEffect(() => {
    const canvas = document.getElementById("particle-canvas") as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: { x: number; y: number; s: number; vx: number; vy: number }[] = [];
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    for (let i = 0; i < 50; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            s: Math.random() * 2 + 1,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
        });
    }

    let animationFrameId: number;
    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(75, 226, 119, 0.15)";
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx.fill();
      });
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-background">
      <canvas id="particle-canvas" className="absolute inset-0 pointer-events-none" />
      
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="mb-12 text-center relative z-10">
        <motion.h1 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-primary text-4xl shadow-primary drop-shadow-[0_0_8px_rgba(75,226,119,0.5)]" style={{ fontVariationSettings: "'FILL' 1" }}>
            account_balance_wallet
          </span>
          Financial Noir
        </motion.h1>
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="font-label text-xs uppercase tracking-[0.2em] text-outline mt-2"
        >
          Elite Wealth Management
        </motion.p>
      </div>

      <main className="w-full max-w-[440px] relative z-10">
        <AnimatePresence mode="wait">
          {step === "phone" ? (
            <motion.div
              key="phone-step"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
              className="glass-panel rounded-xl p-8 shadow-2xl shadow-black/60 border border-white/5"
            >
              <div className="text-center space-y-2 mb-8">
                <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">Bienvenido</h2>
                <p className="text-on-surface-variant text-sm">Ingresa tu número para recibir un código de acceso.</p>
              </div>

              <form onSubmit={handlePhoneSubmit} className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-outline uppercase tracking-wider ml-1">
                    Número de WhatsApp
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-4 flex items-center gap-2 text-on-surface border-r border-white/10 pr-3 h-6">
                      <span className="text-sm font-medium tabular-nums">+52</span>
                    </div>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={loading}
                      placeholder="55 0000 0000"
                      className="w-full bg-surface-container-low border border-white/5 rounded-lg py-4 pl-20 pr-4 text-on-surface placeholder:text-outline/40 focus:ring-1 focus:ring-primary/50 font-body transition-all outline-none disabled:opacity-50"
                      autoFocus
                    />
                  </div>
                  {error && <p className="text-error text-xs ml-1 mt-1">{error}</p>}
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={loading}
                  type="submit"
                  className="w-full bg-primary-container text-on-primary-container font-headline font-bold py-4 rounded-lg shadow-lg shadow-primary/10 hover:brightness-110 transition-all disabled:opacity-50 flex justify-center items-center h-14"
                >
                  {loading ? (
                    <span className="w-5 h-5 border-2 border-on-primary-container/20 border-t-on-primary-container rounded-full animate-spin" />
                  ) : (
                    "Enviarme código"
                  )}
                </motion.button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="otp-step"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -20 }}
              transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
              className="glass-panel rounded-xl p-8 shadow-2xl shadow-black/60 border border-white/5"
            >
              <div className="text-center space-y-2 mb-8">
                <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface">Verificación</h2>
                <p className="text-on-surface-variant text-sm">
                  Ingresa el código que enviamos a<br />
                  <span className="text-on-surface font-medium">+52 {phone}</span>
                </p>
              </div>

              <div className={`flex justify-center gap-2 mb-6 ${error ? "animate-[shake_0.5s]" : ""}`}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    disabled={loading}
                    className="w-12 h-14 text-center text-xl font-bold rounded-lg bg-surface-container-low border border-white/5 text-on-surface focus:ring-2 focus:ring-primary/50 outline-none transition-all disabled:opacity-50"
                  />
                ))}
              </div>

              {error && <p className="text-error text-xs text-center mb-6">{error}</p>}

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={verifyOtp}
                disabled={loading || otp.join("").length < 6}
                className="w-full bg-primary-container text-on-primary-container font-headline font-bold py-4 rounded-lg shadow-lg shadow-primary/10 hover:brightness-110 transition-all disabled:opacity-50 flex justify-center items-center h-14"
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-on-primary-container/20 border-t-on-primary-container rounded-full animate-spin" />
                ) : (
                  "Verificar"
                )}
              </motion.button>
              
              <div className="flex flex-col gap-2 mt-4">
                <button
                  onClick={() => handlePhoneSubmit()}
                  disabled={loading || cooldown > 0}
                  className="w-full text-primary text-xs font-medium hover:text-primary/80 transition-colors py-2 disabled:opacity-50"
                >
                  {cooldown > 0 ? `Reenviar disponible en ${cooldown}s` : "Reenviar código"}
                </button>
                
                <button
                  onClick={() => setStep("phone")}
                  disabled={loading}
                  className="w-full text-on-surface-variant text-xs font-medium hover:text-on-surface transition-colors py-2"
                >
                  Cambiar número
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-5px); }
          40%, 80% { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
