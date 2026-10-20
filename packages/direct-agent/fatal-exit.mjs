// Called after the failed action settles, before Pi's immediate-exit TUI error
// handler can run. No private renderer methods or global exception interception.
export async function exitFailedDirectRuntime({ getRuntime, stop, report }) {
  const deadline = setTimeout(() => process.exit(1), 5_000);
  try { stop?.(); } catch { /* The diagnostic must survive renderer failure. */ }
  report();
  try { await getRuntime()?.dispose(); } catch { /* Uncertain leases stay held. */ }
  clearTimeout(deadline);
  process.exit(1);
}
