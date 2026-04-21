"use client";

import { useEffect, useState } from "react";
import { motion, type Variants } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
};

export default function AdminPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, activityRes] = await Promise.all([
          fetch("/api/v1/admin/stats").then((res) => res.json()),
          fetch("/api/v1/admin/activity").then((res) => res.json()),
        ]);

        if (statsRes.ok && activityRes.ok) {
          setData({
            stats: statsRes.data,
            activity: activityRes.data.activity,
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
          <h2 className="text-3xl font-extrabold tracking-tighter text-on-surface">Panel de Control</h2>
          <p className="text-on-surface-variant font-medium text-sm">Resumen global de actividad y usuarios.</p>
        </div>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
      >
        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-primary/40 shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <span className="material-symbols-outlined text-primary">groups</span>
            </div>
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest bg-surface-container-high px-2 py-1 rounded">Global</span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-headline font-extrabold tabular-nums text-on-surface">
              {data?.stats?.total_users || 0}
            </span>
            <span className="text-xs text-on-surface-variant mt-2">Usuarios Totales</span>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-primary shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-primary/10 rounded-lg">
              <span className="material-symbols-outlined text-primary">verified</span>
            </div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest bg-primary/10 px-2 py-1 rounded">Engagement</span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-headline font-extrabold tabular-nums text-primary">
              {data?.stats?.active_this_month || 0}
            </span>
            <span className="text-xs text-on-surface-variant mt-2">Activos este mes</span>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-secondary shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-secondary/10 rounded-lg">
              <span className="material-symbols-outlined text-secondary">forum</span>
            </div>
            <span className="text-[10px] font-bold text-secondary uppercase tracking-widest bg-secondary/10 px-2 py-1 rounded">Hoy</span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-headline font-extrabold tabular-nums text-on-surface">
              {data?.stats?.messages_today || 0}
            </span>
            <span className="text-xs text-on-surface-variant mt-2">Mensajes procesados</span>
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="bg-surface-container-low p-6 rounded-2xl border-l-4 border-primary-container shadow-lg shadow-black/20 group hover:bg-surface-container transition-all">
          <div className="flex justify-between items-start mb-4">
            <div className="p-2 bg-primary-container/10 rounded-lg">
              <span className="material-symbols-outlined text-primary-container">database</span>
            </div>
            <span className="text-[10px] font-bold text-primary-container uppercase tracking-widest bg-primary-container/10 px-2 py-1 rounded">Economía</span>
          </div>
          <div className="flex flex-col">
            <span className="text-3xl font-headline font-extrabold tabular-nums text-on-surface">
              {formatMoney(data?.stats?.total_volume || 0)}
            </span>
            <span className="text-xs text-on-surface-variant mt-2">Volumen Transaccionado</span>
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-surface-container-low rounded-2xl p-6 md:p-8 shadow-xl shadow-black/20"
      >
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h2 className="text-xl font-headline font-bold text-on-surface tracking-tight">Actividad de Usuarios</h2>
            <p className="text-xs text-on-surface-variant uppercase tracking-widest mt-1">Mensajes Recibidos (30 días)</p>
          </div>
        </div>
        
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data?.activity || []} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4be277" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4be277" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.1)", strokeWidth: 1, strokeDasharray: "4 4" }}
                contentStyle={{ backgroundColor: "#1c1b1b", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}
                formatter={(val: number) => [`${val} mensajes`, "Volumen"]}
                labelFormatter={(label) => new Date(label).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}
              />
              <XAxis 
                dataKey="date" 
                tickFormatter={(val) => new Date(val).toLocaleDateString("es-MX", { day: "numeric", month: "short" })} 
                stroke="#869585" 
                tick={{ fill: "#869585", fontSize: 10 }} 
                axisLine={false} 
                tickLine={false} 
                minTickGap={30}
              />
              <Area 
                type="monotone" 
                dataKey="count" 
                stroke="#4be277" 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorCount)" 
                animationDuration={1500}
                animationEasing="ease-in-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>
    </div>
  );
}
