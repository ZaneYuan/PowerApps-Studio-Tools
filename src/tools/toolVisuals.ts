export interface ToolIconTone {
  icon: string;
  surface: string;
}

const tonesByCategory: Record<string, ToolIconTone> = {
  "连接管理": { icon: "text-violet-600 dark:text-violet-400", surface: "bg-violet-50 dark:bg-violet-500/10" },
  "元数据浏览": { icon: "text-cyan-600 dark:text-cyan-400", surface: "bg-cyan-50 dark:bg-cyan-500/10" },
  "查询工具": { icon: "text-blue-600 dark:text-blue-400", surface: "bg-blue-50 dark:bg-blue-500/10" },
  "插件开发": { icon: "text-amber-600 dark:text-amber-400", surface: "bg-amber-50 dark:bg-amber-500/10" },
  "数据管理": { icon: "text-emerald-600 dark:text-emerald-400", surface: "bg-emerald-50 dark:bg-emerald-500/10" },
  "Power Apps": { icon: "text-fuchsia-600 dark:text-fuchsia-400", surface: "bg-fuchsia-50 dark:bg-fuchsia-500/10" },
};

const fallbackTone: ToolIconTone = { icon: "text-slate-600 dark:text-slate-400", surface: "bg-slate-100 dark:bg-slate-800" };

export function getToolIconTone(category: string): ToolIconTone {
  return tonesByCategory[category] ?? fallbackTone;
}
