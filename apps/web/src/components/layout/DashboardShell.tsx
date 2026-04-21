"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; role: string } | null>(null);

  // Fetch real user profile from the backend
  useEffect(() => {
    fetch("/api/v1/me")
      .then(async (res) => {
        if (!res.ok) {
          // If the session is invalid or user was deleted/merged, force logout
          // We call logout first to clear the cookie and avoid the middleware redirect loop
          await fetch("/api/v1/auth/logout", { method: "POST" });
          window.location.href = "/login";
          throw new Error("Session invalid");
        }
        return res.json();
      })
      .then((json) => {
        if (json.ok) {
          setUser({
            name: json.data.user.name || "Usuario",
            role: json.data.user.role,
          });
        }
      })
      .catch((err) => console.error("Error fetching user:", err));
  }, []);

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const navItems = [
    { name: "Dashboard", href: "/dashboard", icon: "dashboard" },
    { name: "Transacciones", href: "/dashboard/transactions", icon: "receipt_long" },
    ...(user.role === "admin"
      ? [
        { name: "Métricas Admin", href: "/admin", icon: "analytics" },
        { name: "Usuarios", href: "/admin/users", icon: "group" },
      ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* SideNavBar Shell */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen z-40 bg-surface-container-low w-64 shadow-2xl shadow-black/40 font-manrope tracking-tight font-semibold border-r border-white/5">
        <div className="p-8">
          <div className="text-xl font-bold tracking-tighter text-on-surface">Financial Noir</div>
          <div className="text-[10px] uppercase tracking-widest text-primary mt-1 opacity-80">Prestigio Financiero</div>
        </div>
        <nav className="flex-1 px-4 space-y-2 mt-4">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 py-3 px-4 rounded-lg transition-transform active:scale-95 ${isActive
                    ? "text-primary bg-surface-container-high"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                  }`}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                  {item.icon}
                </span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-6 border-t border-white/5 space-y-1">
          <button className="w-full flex items-center gap-3 py-3 px-4 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors">
            <span className="material-symbols-outlined">account_circle</span>
            <span>Perfil</span>
          </button>
          <button className="w-full flex items-center gap-3 py-3 px-4 text-on-surface-variant hover:text-secondary hover:bg-surface-container rounded-lg transition-colors" onClick={() => fetch("/api/v1/auth/logout", { method: "POST" }).then(() => window.location.href = "/login")}>
            <span className="material-symbols-outlined">logout</span>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* TopAppBar Shell */}
      <header className="flex justify-between items-center h-16 px-4 md:px-8 md:ml-64 bg-background/80 backdrop-blur-xl sticky top-0 z-30 font-manrope text-sm uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <button className="md:hidden text-on-surface-variant" onClick={() => setMobileMenuOpen(!isMobileMenuOpen)}>
            <span className="material-symbols-outlined">menu</span>
          </button>
          <span className="text-on-surface-variant font-medium hidden md:block">
            {navItems.find(i => i.href === pathname)?.name || "Dashboard"}
          </span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <div className="relative group hidden md:block">
            <input
              type="text"
              placeholder="Buscar transacción..."
              className="bg-surface-container-low border border-white/5 rounded-full py-2 px-6 text-xs w-64 focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/50 outline-none transition-all"
            />
            <span className="material-symbols-outlined absolute right-4 top-2 text-sm text-on-surface-variant">search</span>
          </div>
          <div className="flex items-center gap-4 border-l border-white/5 pl-4 md:pl-6">
            <button className="text-on-surface-variant hover:text-primary transition-colors">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <div className="flex items-center gap-3 md:ml-2">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-bold text-on-surface tracking-normal leading-none mb-1">{user.name}</p>
                <p className="text-[8px] text-primary/80 leading-none capitalize">{user.role}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center border border-primary/20">
                <span className="material-symbols-outlined text-sm text-primary">person</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
          <motion.div
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            className="w-64 h-full bg-surface-container-low border-r border-white/5 p-6 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-8">
              <div className="text-xl font-bold tracking-tighter text-on-surface">Financial Noir</div>
              <div className="text-[10px] uppercase tracking-widest text-primary mt-1 opacity-80">Prestigio Financiero</div>
            </div>
            <nav className="flex-1 space-y-2">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 py-3 px-4 rounded-lg transition-transform active:scale-95 ${isActive
                        ? "text-primary bg-surface-container-high"
                        : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                      }`}
                  >
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}>
                      {item.icon}
                    </span>
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </motion.div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="md:ml-64 p-4 md:p-8 pt-6 min-h-[calc(100vh-64px)] overflow-x-hidden">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
