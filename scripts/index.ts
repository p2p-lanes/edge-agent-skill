import { NotionAPI } from "notion-client";
import axios from "axios";
import { join } from "node:path";
import { type Document, type FetchText, htmlDocument, missingNotionBlocks, newsletterDocuments, notionDocument, publicUrl } from "./content";
import { buildReferenceFiles, publishReferences, readReferences } from "./publish";
import { EVENT, WEBSITE_PAGES } from "./sources";

export const fetchText: FetchText = async raw => {
  publicUrl(raw);
  for (let attempt = 0; ; attempt++) {
    try {
      const { data } = await axios.get<string>(raw, {
        responseType: "text",
        timeout: 20_000,
        maxContentLength: 8 * 1024 * 1024,
        maxRedirects: 3,
        headers: { "User-Agent": "EdgeCityIndia-PublicIndexer/3.0" },
        beforeRedirect(options) {
          publicUrl(`${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ""}${options.path}`);
        },
      });
      if (typeof data !== "string") throw new Error(`Expected text response: ${raw}`);
      return data;
    } catch (error) {
      const httpError = axios.isAxiosError(error);
      const status = httpError ? error.response?.status : undefined;
      const retryable = httpError && (!error.response || status === 429 || (status !== undefined && status >= 500));
      if (!retryable || attempt >= 2) {
        // Log only the approved request URL and status, never Axios config,
        // response bodies, cookies, or headers.
        const detail = status !== undefined ? `HTTP ${status}` : httpError ? "Network request failed" : "Invalid public-source response or redirect";
        throw new Error(`Failed to fetch ${raw}: ${detail}`, { cause: error });
      }
      await Bun.sleep(500 * (attempt + 1));
    }
  }
};

export async function fetchWiki(): Promise<Document> {
  const notion = new NotionAPI({ userTimeZone: EVENT.timezone, ofetchOptions: { timeout: 20_000, retry: 1 } });
  const recordMap = await notion.getPage(EVENT.wikiId, {
    fetchMissingBlocks: false, fetchCollections: false, signFileUrls: false,
  });
  // notion-client's automatic missing-block loop is unbounded. Fetch only
  // reachable descendants with explicit progress and size limits instead.
  for (let round = 0; round < 10; round++) {
    const missing = missingNotionBlocks(recordMap);
    if (!missing.length) return notionDocument(recordMap);
    if (missing.length > 500 || Object.keys(recordMap.block).length > 5000) throw new Error("Wiki exceeds safe block limit");
    const extra = await notion.getBlocks(missing);
    Object.assign(recordMap.block, extra.recordMap.block);
    if (missingNotionBlocks(recordMap).some(id => missing.includes(id))) throw new Error("Wiki descendants inaccessible; refusing incomplete publication");
  }
  throw new Error("Wiki exceeds maximum nesting fetch rounds");
}

export async function collectDocuments(get: FetchText = fetchText, wiki: () => Promise<Document> = fetchWiki): Promise<Document[]> {
  const jobs = [
    { name: "wiki", run: async () => [await wiki()] },
    { name: "newsletter", run: () => newsletterDocuments(get) },
    ...WEBSITE_PAGES.map(page => ({
      name: page.url,
      run: async () => [htmlDocument(await get(page.url), page.url, page.path, "website")],
    })),
  ];
  const results = await Promise.allSettled(jobs.map(job => job.run()));
  const failures = results.flatMap((result, i) => result.status === "rejected" ? [`${jobs[i]!.name}: ${String(result.reason)}`] : []);
  if (failures.length) throw new Error(`No references published. Source failures:\n${failures.join("\n")}`);
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}

export async function runIndexer(
  refsDir = join(import.meta.dir, "..", "references"),
  options: { get?: FetchText; wiki?: () => Promise<Document>; now?: string } = {},
): Promise<void> {
  console.log(`Indexing public documents for ${EVENT.name}...`);
  const documents = await collectDocuments(options.get, options.wiki);
  const files = buildReferenceFiles(documents, readReferences(refsDir), options.now);
  const changed = publishReferences(refsDir, files);
  console.log(`${documents.length} documents validated. ${changed ? "References updated." : "No content changes."}`);
}

if (import.meta.main) {
  try {
    await runIndexer();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
