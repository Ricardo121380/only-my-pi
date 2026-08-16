import fs from "node:fs";
import path from "node:path";

const marker = process.env.OMP_LIFECYCLE_MARKER ?? path.join(process.cwd(), "LIFECYCLE_RAN");
fs.writeFileSync(marker, "lifecycle script executed\n", "utf8");
