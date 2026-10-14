// Deja en cada microservicio SÓLO los contratos generados que consume.
// Se ejecuta automáticamente tras `npm run generate` (script "postgenerate" de npm).
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["board", "state", "ratelimit"];

const keepByService = {
  "gateway-service": ["board", "state", "ratelimit"],
  "board-service": ["board", "state"],
  "ratelimit-service": ["ratelimit"],
};

for (const [service, keep] of Object.entries(keepByService)) {
  const genDir = path.join(root, "services", service, "src", "gen");
  if (!existsSync(genDir)) continue;
  for (const pkg of PACKAGES) {
    if (keep.includes(pkg)) continue;
    const target = path.join(genDir, pkg);
    if (existsSync(target)) {
      await rm(target, { recursive: true, force: true });
      console.log("[prune-gen] eliminado " + path.relative(root, target));
    }
  }
}
