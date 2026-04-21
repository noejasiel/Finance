"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTransactions() {
      try {
        const res = await fetch("/api/v1/me/transactions?limit=20");
        const json = await res.json();
        if (json.ok) {
          setTransactions(json.data.transactions);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchTransactions();
  }, []);

  const formatMoney = (minorUnits: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(minorUnits / 100);
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex justify-between items-end">
        <div className="space-y-1">
          <h2 className="text-3xl font-extrabold tracking-tighter text-on-surface">Transacciones</h2>
          <p className="text-on-surface-variant font-medium text-sm">Gestiona la narrativa financiera de tu patrimonio.</p>
        </div>
        <button className="flex items-center gap-2 bg-primary-container text-on-primary-container px-6 py-2.5 rounded-lg font-bold text-xs tracking-widest uppercase hover:bg-primary transition-colors active:scale-95 duration-200">
          <span className="material-symbols-outlined text-sm">download</span>
          <span className="hidden md:inline">Exportar CSV</span>
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-2xl p-6 shadow-xl shadow-black/20 overflow-hidden">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">search</span>
              <input
                type="text"
                placeholder="Buscar por concepto o categoría..."
                className="w-full bg-surface-container border-none rounded-lg py-3 pl-10 pr-4 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:ring-1 focus:ring-primary/50 outline-none transition-all"
              />
            </div>
            <div className="flex gap-4">
              <select className="bg-surface-container border-none rounded-lg py-3 px-4 text-sm text-on-surface font-semibold appearance-none focus:ring-1 focus:ring-primary/50 outline-none">
                <option value="">Todos los tipos</option>
                <option value="expense">Gastos</option>
                <option value="income">Ingresos</option>
              </select>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead className="text-[10px] uppercase tracking-widest text-on-surface-variant">
                <tr>
                  <th className="px-4 py-2 font-bold">Detalle</th>
                  <th className="px-4 py-2 font-bold">Categoría</th>
                  <th className="px-4 py-2 font-bold text-right">Monto</th>
                  <th className="px-4 py-2 font-bold text-right">Fecha</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {transactions.map((tx, index) => {
                  const isIncome = tx.transactionType === "income";
                  return (
                    <motion.tr
                      key={tx.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="group hover:bg-surface-container transition-colors rounded-xl"
                    >
                      <td className="px-4 py-3 md:py-4 rounded-l-xl">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${isIncome ? "bg-primary/10" : "bg-error/10"}`}>
                            <span className={`material-symbols-outlined ${isIncome ? "text-primary" : "text-error"}`}>
                              {isIncome ? "payments" : "shopping_bag"}
                            </span>
                          </div>
                          <div>
                            <p className="font-bold text-on-surface">{tx.description || tx.category || "Sin descripción"}</p>
                            <p className="text-[10px] text-on-surface-variant uppercase tracking-tighter truncate md:hidden block mt-1">
                              {new Date(tx.occurredAt).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" })}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 md:py-4">
                        <span className="text-[10px] font-bold uppercase bg-surface-container-highest px-3 py-1 rounded-full text-on-surface-variant">
                          {tx.category}
                        </span>
                      </td>
                      <td className={`px-4 py-2 md:py-4 text-right tabular-nums font-bold ${isIncome ? "text-primary" : "text-error"}`}>
                        {isIncome ? "+" : "-"}{formatMoney(tx.amountMinor)}
                      </td>
                      <td className="px-4 py-3 md:py-4 text-right text-xs text-on-surface-variant rounded-r-xl hidden md:table-cell">
                        {new Date(tx.occurredAt).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" })}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
