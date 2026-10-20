import symbols from "./prototype-icons.json";
const aliases = { arrow: "arrow-up", close: "x", code: "file", chat: "file", menu: "sidebar" } as const;
export type IconName = keyof typeof symbols | keyof typeof aliases;
export function Icon({ name }: { name: IconName }) {
  const symbol = name in aliases ? aliases[name as keyof typeof aliases] : name as keyof typeof symbols;
  // Only local SVG literals; Host/user content never enters this markup.
  return <svg className="i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: symbols[symbol] }} />;
}
export function BrandLogo() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 7h7a7 7 0 0 1 7 7v4a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7v-3a8 8 0 0 1 8-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><path d="M12 17h12M17 7v6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
