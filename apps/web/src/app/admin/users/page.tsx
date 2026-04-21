"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<any>(null);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const query = search ? `?search=${encodeURIComponent(search)}` : "";
        const res = await fetch(`/api/v1/admin/users${query}`);
        const json = await res.json();
        if (json.ok) {
          setUsers(json.data.users);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    const debounceId = setTimeout(fetchUsers, 300);
    return () => clearTimeout(debounceId);
  }, [search]);

  useEffect(() => {
    if (!selectedUser) {
      setUserDetail(null);
      return;
    }
    async function fetchDetail() {
      try {
        const res = await fetch(`/api/v1/admin/users/${selectedUser}`);
        const json = await res.json();
        if (json.ok) setUserDetail(json.data);
      } catch (e) {
        console.error(e);
      }
    }
    fetchDetail();
  }, [selectedUser]);

  const formatMoney = (minorUnits: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(minorUnits / 100);
  };

  return (
    <div className="space-y-8 pb-12 relative overflow-hidden">
      <div className="flex justify-between items-end">
        <div className="space-y-1">
          <h2 className="text-3xl font-extrabold tracking-tighter text-on-surface">Gestión de Usuarios</h2>
          <p className="text-on-surface-variant font-medium text-sm">Directorio y métricas de clientes activos.</p>
        </div>
      </div>

      <div className="bg-surface-container-low rounded-2xl p-6 shadow-xl shadow-black/20 overflow-hidden">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative w-full md:w-96">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">search</span>
            <input
              type="text"
              placeholder="Buscar por nombre o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface-container border-none rounded-lg py-3 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:ring-1 focus:ring-primary/50 outline-none transition-all"
            />
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-separate border-spacing-y-2">
            <thead className="text-[10px] uppercase tracking-widest text-on-surface-variant hidden md:table-header-group">
              <tr>
                <th className="px-4 py-2 font-bold">Usuario</th>
                <th className="px-4 py-2 font-bold">Registro</th>
                <th className="px-4 py-2 font-bold">Último Mensaje</th>
                <th className="px-4 py-2 font-bold text-center">Movimientos<br/><span className="text-[8px]">(mes)</span></th>
                <th className="px-4 py-2 font-bold text-right">Balance<br/><span className="text-[8px]">(mes)</span></th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center">
                    <span className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin inline-block" />
                  </td>
                </tr>
              ) : (
                users.map((user, index) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedUser(user.id)}
                    className="group hover:bg-surface-container transition-colors rounded-xl cursor-pointer flex flex-col md:table-row mb-2 md:mb-0 bg-surface-container-highest md:bg-transparent"
                  >
                    <td className="px-4 py-3 md:py-4 rounded-t-xl md:rounded-l-xl md:rounded-tr-none">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 shrink-0 rounded-full bg-surface-container-high border border-primary/10 flex items-center justify-center">
                          <span className="text-primary font-bold">{user.name ? user.name[0].toUpperCase() : "?"}</span>
                        </div>
                        <div>
                          <p className="font-bold text-on-surface">{user.name || "Sin Nombre"}</p>
                          <p className="text-xs text-on-surface-variant font-mono">{user.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 md:py-4 hidden md:table-cell text-xs text-on-surface-variant">
                      {new Date(user.created_at).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-2 md:py-4 hidden md:table-cell text-xs text-on-surface-variant">
                      {user.last_message_at 
                        ? new Date(user.last_message_at).toLocaleDateString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) 
                        : "Nunca"}
                    </td>
                    <td className="px-4 py-2 md:py-4 md:text-center">
                      <span className="bg-surface-container-highest px-3 py-1 rounded-full text-xs font-bold tabular-nums">
                        {user.month_transactions || 0}
                      </span>
                    </td>
                    <td className={`px-4 py-3 md:py-4 text-right tabular-nums font-bold text-sm ${
                      (user.month_balance || 0) >= 0 ? "text-primary" : "text-error"
                    } rounded-b-xl md:rounded-r-xl md:rounded-bl-none`}>
                      {formatMoney(user.month_balance || 0)}
                    </td>
                  </motion.tr>
                ))
              )}
              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-on-surface-variant text-sm">
                    No se encontraron usuarios
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {selectedUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setSelectedUser(null)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-surface-container-low border-l border-white/5 z-50 p-6 overflow-y-auto"
            >
              <div className="flex justify-between items-start mb-8">
                <h3 className="text-xl font-bold text-on-surface">Detalle de Usuario</h3>
                <button onClick={() => setSelectedUser(null)} className="text-on-surface-variant hover:text-on-surface bg-surface-container p-2 rounded-full">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              {!userDetail ? (
                <div className="flex justify-center py-12">
                  <span className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="flex items-center gap-4 bg-surface-container p-4 rounded-xl">
                    <div className="w-16 h-16 rounded-full bg-surface-container-high border-2 border-primary/20 flex items-center justify-center text-2xl font-bold text-primary">
                      {userDetail.user.name ? userDetail.user.name[0].toUpperCase() : "?"}
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-on-surface">{userDetail.user.name || "Usuario Anónimo"}</h4>
                      <p className="text-sm text-on-surface-variant font-mono">{userDetail.user.phone}</p>
                      <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-widest bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {userDetail.user.role}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4 border-l-2 border-primary pl-2">
                      Transacciones Recientes
                    </h4>
                    <div className="space-y-3">
                      {userDetail.recent_transactions.length === 0 ? (
                        <p className="text-sm text-on-surface-variant italic">No hay transacciones aún.</p>
                      ) : (
                        userDetail.recent_transactions.map((tx: any) => {
                          const isIncome = tx.transactionType === "income";
                          return (
                            <div key={tx.id} className="bg-surface-container p-3 rounded-lg flex items-center justify-between group">
                               <div className="flex items-center gap-3">
                                 <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isIncome ? "bg-primary/10 text-primary" : "bg-error/10 text-error"}`}>
                                    <span className="material-symbols-outlined text-sm">{isIncome ? "payments" : "shopping_bag"}</span>
                                 </div>
                                 <div className="max-w-[140px]">
                                   <p className="text-sm font-bold text-on-surface truncate">{tx.description || tx.category}</p>
                                   <p className="text-[10px] text-on-surface-variant">{new Date(tx.occurredAt).toLocaleDateString("es-MX", { month: "short", day: "numeric" })}</p>
                                 </div>
                               </div>
                               <span className={`text-sm font-bold tabular-nums ${isIncome ? "text-primary" : "text-error"}`}>
                                 {isIncome ? "+" : "-"}{formatMoney(tx.amountMinor)}
                               </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
