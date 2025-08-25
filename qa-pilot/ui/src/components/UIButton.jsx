import { motion } from "framer-motion";

export default function UIButton({ children, className="", ...props }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      whileHover={{ y: -1 }}
      className={`px-3 py-2 rounded-xl text-white shadow-soft hover:shadow-softHover transition ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  )
}
