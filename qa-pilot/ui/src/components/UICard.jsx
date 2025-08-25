import { motion } from "framer-motion";

export default function UICard({ title, value, children, accent="indigo" }) {
  const ring = {
    indigo: "ring-indigo-100",
    emerald:"ring-emerald-100",
    rose:   "ring-rose-100",
  }[accent] || "ring-indigo-100";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      whileHover={{ y: -3, boxShadow: "0 16px 48px rgba(0,0,0,0.12)" }}
      className={`bg-white rounded-2xl p-5 shadow ring-1 ${ring}`}
    >
      {title && <p className="text-slate-500 text-sm">{title}</p>}
      {value !== undefined && <p className="text-3xl font-bold mt-1">{value}</p>}
      {children}
    </motion.div>
  );
}
