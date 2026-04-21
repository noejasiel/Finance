"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  yAxis,
  Cell,
} from "recharts";

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
};

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // We will mock the fetching process matching our expected structure from me.ts
  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, chartRes, categoriesRes, transactionsRes] = await Promise.all([
          fetch("/api/v1/me/summary").then((res) => res.json()),
          fetch("/api/v1/me/chart").then((res) => res.json()),
          fetch("/api/v1/me/categories").then((res) => res.json()),
          fetch("/api/v1/me/transactions?limit=8").then((res) => res.json()),
        ]);

        if (summaryRes.ok && chartRes.ok && categoriesRes.ok && transactionsRes.ok) {
          setData({
            summary: summaryRes.data,
            chart: chartRes.data.weekly_trend,
            categories: categoriesRes.data.by_category,
            transactions: transactionsRes.data.transactions,
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Format currency
  const formatMoney = (minorUnits: number) => {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(minorUnits / 100);
  };

  const getDeltaBadge = (pct: number | null) => {
    if (pct === null) return null;
    const isPositive = pct > 0;
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isPositive ? "bg-primary/10 text-primary" : "bg-error/10 text-error"}`}>
        {isPositive ? "+" : ""}{pct}%
      </span>
    );
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Summary Cards */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-error shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-error/10 rounded-lg">
              <span className="material-symbols-outlined text-error">trending_down</span>
            </div>
            <span className="text-[10px] font-bold text-error uppercase tracking-widest bg-error/10 px-2 py-1 rounded">Gastos del mes</span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-headline font-extrabold tabular-nums text-on-surface">
              {formatMoney(data?.summary?.total_expenses || 0)}
            </span>
            <div className="flex items-center gap-2 mt-2">
              {getDeltaBadge(data?.summary?.expense_delta_pct)}
              <span className="text-xs text-on-surface-variant">vs mes anterior</span>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-primary shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <span className="material-symbols-outlined text-primary">trending_up</span>
            </div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest bg-primary/10 px-2 py-1 rounded">Ingresos del mes</span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-headline font-extrabold tabular-nums text-on-surface">
              {formatMoney(data?.summary?.total_income || 0)}
            </span>
            <div className="flex items-center gap-2 mt-2">
              {getDeltaBadge(data?.summary?.income_delta_pct)}
              <span className="text-xs text-on-surface-variant">vs mes anterior</span>
            </div>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-secondary shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-secondary/10 rounded-lg">
              <span className="material-symbols-outlined text-secondary">account_balance_wallet</span>
            </div>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest bg-surface-container-high px-2 py-1 rounded">Balance Total</span>
          </div>
          <div className="flex flex-col">
            <span className={`text-3xl font-headline font-extrabold tabular-nums ${(data?.summary?.balance || 0) >= 0 ? "text-primary" : "text-error"}`}>
              {formatMoney(data?.summary?.balance || 0)}
            </span>
            <span className="text-xs text-on-surface-variant mt-2">Capital neto del mes disponible</span>
          </div>
        </motion.div>
      </motion.div>

      {/* Main Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-surface-container-low rounded-2xl p-6 md:p-8 shadow-xl shadow-black/20"
      >
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h2 className="text-xl font-headline font-bold text-on-surface tracking-tight">Rendimiento Semanal</h2>
            <p className="text-xs text-on-surface-variant uppercase tracking-widest mt-1">Gastos vs Ingresos</p>
          </div>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.chart || []} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{ backgroundColor: "#1c1b1b", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}
                formatter={(val: number) => formatMoney(val)}
              />
              <XAxis dataKey="week" tickFormatter={(val) => `Semana ${val}`} stroke="#869585" tick={{ fill: "#869585", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Bar dataKey="expenses" fill="#ffb4ab" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="income" fill="#4be277" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Grid Inferior */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Categories */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-4 bg-surface-container-low rounded-2xl p-6 shadow-xl shadow-black/20"
        >
          <div className="mb-8">
            <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface border-l-2 border-primary pl-4">Gastos por Categoría</h3>
          </div>
          <div className="space-y-6">
            {(data?.categories || []).slice(0, 5).map((cat: any, i: number) => {
              const totalExpenses = data?.summary?.total_expenses || 1; // Prevent division by 0
              const pct = Math.min((cat.total / totalExpenses) * 100, 100);
              return (
                <div key={cat.category}>
                  <div className="flex justify-between text-xs mb-2">
                    <span className="text-on-surface font-medium capitalize">{cat.category}</span>
                    <span className="text-on-surface-variant tabular-nums">{formatMoney(cat.total)}</span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: "easeOut", delay: 0.5 + i * 0.1 }}
                      className="h-full bg-primary"
                    />
                  </div>
                </div>
              );
            })}
            
            {(!data?.categories || data.categories.length === 0) && (
              <p className="text-sm text-on-surface-variant italic">No hay gastos este mes.</p>
            )}
          </div>
          
          {data?.categories?.length > 0 && (
            <div className="mt-10 p-6 rounded-xl bg-gradient-to-br from-primary/10 to-transparent border border-primary/10">
              <p className="text-xs text-primary font-bold uppercase tracking-wider mb-2">Tip del mes</p>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Tus mayores gastos están en la categoría "{data.categories[0]?.category}".
                Considera revisar tus suscripciones y compras allí.
              </p>
            </div>
          )}
        </motion.div>

        {/* Recent Transactions */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-8 bg-surface-container-low rounded-2xl p-6 shadow-xl shadow-black/20 overflow-hidden"
        >
          <div className="flex justify-between items-center mb-6 px-2">
            <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface border-l-2 border-primary pl-4">Últimas Transacciones</h3>
            <button className="text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/10 px-4 py-2 rounded-lg transition-colors">Ver todas</button>
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead className="text-[10px] uppercase tracking-widest text-on-surface-variant hidden md:table-header-group">
                <tr>
                  <th className="px-4 py-2 font-bold">Detalle</th>
                  <th className="px-4 py-2 font-bold">Categoría</th>
                  <th className="px-4 py-2 font-bold text-right">Monto</th>
                  <th className="px-4 py-2 font-bold text-right">Fecha</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {(data?.transactions || []).map((tx: any, index: number) => {
                  const isIncome = tx.transactionType === "income";
                  return (
                    <motion.tr
                      key={tx.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6 + index * 0.05 }}
                      className="group hover:bg-surface-container transition-colors rounded-xl flex flex-col md:table-row mb-2 md:mb-0 bg-surface-container-highest md:bg-transparent"
                    >
                      <td className="px-4 py-3 md:py-4 rounded-t-xl md:rounded-l-xl md:rounded-tr-none">
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${isIncome ? "bg-primary/10" : "bg-error/10"}`}>
                            <span className={`material-symbols-outlined ${isIncome ? "text-primary" : "text-error"}`}>
                              {isIncome ? "payments" : "shopping_bag"}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-on-surface truncate">{tx.description || tx.category || "Sin descripción"}</p>
                            <p className="text-[10px] text-on-surface-variant uppercase tracking-tighter truncate block md:hidden">
                              {new Date(tx.occurredAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 md:py-4 hidden md:table-cell">
                        <span className="text-[10px] font-bold uppercase bg-surface-container-highest px-3 py-1 rounded-full text-on-surface-variant">
                          {tx.category}
                        </span>
                      </td>
                      <td className={`px-4 py-2 md:py-4 text-right tabular-nums font-bold ${isIncome ? "text-primary" : "text-error"}`}>
                        {isIncome ? "+" : "-"}{formatMoney(tx.amountMinor)}
                      </td>
                      <td className="px-4 py-3 md:py-4 text-right text-xs text-on-surface-variant rounded-b-xl md:rounded-r-xl md:rounded-bl-none hidden md:table-cell">
                        {new Date(tx.occurredAt).toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "numeric" })}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
            
            {(!data?.transactions || data.transactions.length === 0) && (
              <div className="text-center py-8">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2">receipt_long</span>
                <p className="text-on-surface-variant text-sm border-0">No hay transacciones aún.</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
