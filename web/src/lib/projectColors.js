// Full class names (not built dynamically) so Tailwind keeps them
const COLORS = {
  blue: { dot: 'bg-blue-500', soft: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', ring: 'ring-blue-500' },
  emerald: { dot: 'bg-emerald-500', soft: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500' },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', ring: 'ring-amber-500' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', ring: 'ring-rose-500' },
  violet: { dot: 'bg-violet-500', soft: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', ring: 'ring-violet-500' },
  cyan: { dot: 'bg-cyan-500', soft: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300', ring: 'ring-cyan-500' },
  orange: { dot: 'bg-orange-500', soft: 'bg-orange-500/10 text-orange-700 dark:text-orange-300', ring: 'ring-orange-500' },
  slate: { dot: 'bg-slate-500', soft: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', ring: 'ring-slate-500' },
}

export const PROJECT_COLORS = Object.keys(COLORS)

export function projectColor(name) {
  return COLORS[name] || COLORS.blue
}
