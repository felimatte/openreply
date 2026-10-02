import type { CSSProperties } from "react";

const paths: Record<string, string> = {
  start: "M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M14 3h7v7M21 3 10 14",
  message: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  input: "M4 5h16v14H4zM8 9h8M8 13h4M15 12v4M13 14h4",
  condition: "m12 3 9 9-9 9-9-9 9-9ZM12 8v4M12 16h.01",
  delay: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
  action: "m13 2-9 12h7l-1 8 10-12h-7l1-8Z",
  randomizer: "M12 3v7M5 21v-6a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v6M2 18l3 3 3-3M16 18l3 3 3-3",
  end: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9 9h6v6H9z",
  plus: "M12 5v14M5 12h14", close: "m6 6 12 12M6 18 18 6", arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6", down: "m6 9 6 6 6-6", check: "m5 12 4 4L19 6",
  play: "m8 4 12 8-12 8V4Z", search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6",
  map: "M3 3h6v6H3zM15 15h6v6h-6zM15 3h6v6h-6zM9 6h6M6 9v9h9",
  list: "M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01",
  undo: "M3 10h11a6 6 0 0 1 0 12M3 10l6-6M3 10l6 6",
  redo: "M21 10H10a6 6 0 0 0 0 12M21 10l-6-6M21 10l-6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  warning: "m12 3 10 18H2L12 3ZM12 9v4M12 17h.01",
  template: "M3 3h8v8H3zM15 3h6v8h-6zM3 15h8v6H3zM15 15h6v6h-6z",
  activity: "M2 12h5l3-9 4 18 3-9h5", history: "M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2",
  copy: "M8 8h13v13H8zM16 8V3H3v13h5", trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  save: "M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  collapse: "M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5",
};

export default function FlowIcon({ name, size = 18, className = "", style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} style={style}><path d={paths[name] || paths.message} /></svg>;
}
