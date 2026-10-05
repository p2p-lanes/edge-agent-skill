import { createHash } from "node:crypto";
import { articlePath } from "./content";
import { referencePath } from "./publish";
import { EVENT, WEBSITE_PAGES } from "./sources";

export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
export function snapshotDigest(files: Map<string, string>): string {
  const hash = createHash("sha256");
  for (const [path, body] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(path + "\0" + body + "\0");
  return hash.digest("hex");
}

export function decodeSnapshot(input: unknown): Map<string, string> {
  if (!Array.isArray(input) || !input.length || input.length > 250) throw new Error("Invalid snapshot entries");
  const files = new Map<string, string>();
  let bytes = 0;
  for (const entry of input) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") throw new Error("Invalid snapshot entry");
    const [path, body] = entry as [string, string];
    if ((!["index.md", "manifest.json"].includes(path) && !referencePath(path)) || files.has(path)) throw new Error("Unsafe or duplicate snapshot path");
    bytes += Buffer.byteLength(path) + Buffer.byteLength(body);
    if (bytes > MAX_PAYLOAD_BYTES) throw new Error("Snapshot exceeds safe payload limit");
    files.set(path, body);
  }
  validateSnapshot(files);
  return files;
}

export function validateSnapshot(files: Map<string, string>) {
  const manifest = JSON.parse(files.get("manifest.json") ?? "null");
  if (!manifest || manifest.version !== 1 || manifest.event !== EVENT.slug || !Array.isArray(manifest.documents) || !manifest.documents.length) throw new Error("Invalid India manifest");
  const paths = new Set<string>();
  const byKind: Record<string, number> = { wiki: 0, newsletter: 0, website: 0 };
  for (const entry of manifest.documents) {
    if (!entry || typeof entry.path !== "string" || !referencePath(entry.path) || paths.has(entry.path) || typeof entry.title !== "string" || typeof entry.url !== "string" || typeof entry.indexed !== "string" || typeof entry.hash !== "string" || !Number.isFinite(Date.parse(entry.indexed))) throw new Error("Invalid manifest entry");
    paths.add(entry.path);
    if (entry.kind === "wiki") {
      if (entry.url !== EVENT.wikiUrl || entry.path !== "wiki-content.md") throw new Error("Invalid wiki source");
    } else if (entry.kind === "newsletter") {
      if (articlePath(entry.url) !== entry.path) throw new Error("Invalid newsletter source");
    } else if (entry.kind === "website") {
      if (!WEBSITE_PAGES.some(page => page.url === entry.url && page.path === entry.path)) throw new Error("Invalid website source");
    } else throw new Error("Invalid source kind");
    const body = files.get(entry.path);
    const stamp = `\n\nLast content change indexed: ${entry.indexed}\n\n---\n\n`;
    if (!body?.startsWith(`# ${entry.title}\n\nSource: ${entry.url}\n\nSource type: ${entry.kind}\n`) || !body.includes(stamp)) throw new Error("Reference metadata mismatch");
    if (createHash("sha256").update(body.replace(stamp, "\n\n---\n\n")).digest("hex") !== entry.hash) throw new Error("Reference hash mismatch");
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  if (files.size !== paths.size + 2 || [...files.keys()].some(path => !["index.md", "manifest.json"].includes(path) && !paths.has(path))) throw new Error("Orphaned or missing references");
  const index = files.get("index.md");
  const links = [...(index ?? "").matchAll(/\]\(\.\/([^\)]+)\)/g)].map(match => match[1]!);
  if (!index?.startsWith(`# ${EVENT.name}`) || links.length !== paths.size || new Set(links).size !== paths.size || links.some(path => !paths.has(path))) throw new Error("Reference index mismatch");
  return { documents: paths.size, byKind, digest: snapshotDigest(files) };
}
