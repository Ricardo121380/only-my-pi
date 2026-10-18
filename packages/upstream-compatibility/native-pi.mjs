// Development runtime admission is separate from private distribution contracts.
// Each native package must also match the admitted Pi version exactly.
export const NATIVE_PI_VERSIONS = Object.freeze(["1.1.0", "1.3.0"]);

export function usesNativePiTools(version) {
  if (NATIVE_PI_VERSIONS.includes(version)) return true;
  if (["0.84.3", "0.85.1"].includes(version)) return false;
  throw Object.assign(new Error("OMP_PI_RUNTIME_UNSUPPORTED"), { code: "OMP_PI_RUNTIME_UNSUPPORTED" });
}
