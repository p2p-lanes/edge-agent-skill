import { createHash } from "node:crypto";
import { join } from "node:path";

export const INDEXER_FILES = [
  "bun.lock", "package.json", "infra/config.json", "infra/code-hash.ts", "infra/runtime.ts", "scripts/lambda-handler.ts",
  "scripts/reference-state.ts", "scripts/content.ts", "scripts/index.ts",
  "scripts/publish.ts", "scripts/sources.ts", "scripts/types.d.ts",
];
export async function indexerHash(root = process.cwd()): Promise<string> {
  const hash = createHash("sha256");
  for (const path of INDEXER_FILES) hash.update(path + "\0").update(Buffer.from(await Bun.file(join(root, path)).arrayBuffer())).update("\0");
  return hash.digest("hex");
}
