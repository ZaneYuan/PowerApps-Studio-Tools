import type { CSSProperties } from "react";

export type SvgIconName =
  | "app-tools"
  | "connection"
  | "metadata"
  | "sql"
  | "fetchxml"
  | "plugin"
  | "trace"
  | "migration"
  | "copy"
  | "edit"
  | "solution"
  | "ribbon"
  | "workflow"
  | "compare"
  | "convert"
  | "merge"
  | "assembly"
  | "plugin-type"
  | "step"
  | "image"
  | "search"
  | "warning"
  | "file"
  | "table"
  | "close"
  | "check"
  | "error";

export default function SvgIcon({ name, className = "h-4 w-4" }: { name: SvgIconName; className?: string }) {
  const url = `/icons/${name}.svg`;
  const style: CSSProperties = {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };

  return <span aria-hidden="true" className={`inline-block shrink-0 bg-current ${className}`} style={style} />;
}
