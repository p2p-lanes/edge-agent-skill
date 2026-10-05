import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { type Document } from "../scripts/content";
import { readReferences, referencePath } from "../scripts/publish";
import { EVENT, WEBSITE_PAGES } from "../scripts/sources";

interface ReferenceEntry extends Omit<Document, "body"> {
  hash: string;
  indexed: string;
  retained?: boolean;
}
const files = readReferences(fileURLToPath(new URL("../references", import.meta.url)));
const manifest = JSON.parse(files.get("manifest.json")!) as {
  version: number;
  event: string;
  documents: ReferenceEntry[];
};

describe("generated reference integrity", () => {
  test("every indexed document exists, with no duplicate or orphaned Markdown", () => {
    expect(manifest.version).toBe(1);
    expect(manifest.event).toBe(EVENT.slug);
    const paths = manifest.documents.map(entry => entry.path).sort();
    expect(new Set(paths).size).toBe(paths.length);
    const links = [...files.get("index.md")!.matchAll(/\]\(\.\/([^\)]+)\)/g)].map(match => match[1]).sort();
    expect(links).toEqual(paths);
    expect([...files.keys()].filter(path => path.endsWith(".md") && path !== "index.md").sort()).toEqual(paths);
    expect(paths.every(path => referencePath(path))).toBe(true);
  });

  test("document metadata, content hashes, and source URLs match the manifest", () => {
    for (const entry of manifest.documents) {
      const markdown = files.get(entry.path)!;
      expect(markdown.startsWith(`# ${entry.title}\n\nSource: ${entry.url}\n\nSource type: ${entry.kind}\n`)).toBe(true);
      const indexed = `\n\nLast content change indexed: ${entry.indexed}`;
      expect(markdown).toContain(indexed + "\n\n---\n\n");
      if (entry.published) expect(markdown).toContain(`\n\nPublished: ${entry.published}`);
      if (entry.updated) expect(markdown).toContain(`\n\nSource updated: ${entry.updated}`);
      const hashInput = markdown.replace(indexed + "\n\n---\n\n", "\n\n---\n\n");
      expect(createHash("sha256").update(hashInput).digest("hex")).toBe(entry.hash);
      if (entry.kind === "wiki") expect(entry.url).toBe(EVENT.wikiUrl);
      else if (entry.kind === "newsletter") expect(new URL(entry.url).origin).toBe(EVENT.newsletter);
      else expect(WEBSITE_PAGES.some(page => page.url === entry.url && page.path === entry.path)).toBe(true);
    }
  });
});
