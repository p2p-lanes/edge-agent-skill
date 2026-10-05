import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Document, articlePath, htmlDocument, htmlMarkdown, missingNotionBlocks, newsletterDocuments, notionDocument, notionText, parseFeed, publicUrl, safeLink, sitemapArticles } from "../scripts/content";
import { collectDocuments, runIndexer } from "../scripts/index";
import { buildReferenceFiles, publishReferences, readReferences } from "../scripts/publish";
import { EVENT, WEBSITE_PAGES } from "../scripts/sources";

const TEXT = "Public India guide explaining accommodation, transport, and support with enough useful text to validate the document. ".repeat(3);
const ARTICLE_URL = `${EVENT.newsletter}/p/housing-for-edge-city-india`;
const ARTICLE_HTML = `<html><head><meta property="og:title" content="Housing for India"><meta property="article:published_time" content="2026-08-14T15:43:06Z"></head><body><nav>Navigation noise</nav><article><p>${TEXT}</p><a href="/p/getting-to-edge-city-india">Travel guide</a></article><script>doNotInclude()</script></body></html>`;
const RSS = `<rss><channel><title>India</title><item><title>Housing for India</title><link>${ARTICLE_URL}</link><pubDate>Fri, 14 Aug 2026 15:43:06 GMT</pubDate><description><![CDATA[<p>${TEXT}</p><a href="https://forms.fillout.com/t/example">Book here</a>]]></description></item></channel></rss>`;
const sitemap = (urls: string[]) => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join("")}</urlset>`;
const doc = (path = "wiki-content.md", kind: Document["kind"] = "wiki"): Document => ({ path, kind, title: "India guide", url: kind === "wiki" ? EVENT.wikiUrl : ARTICLE_URL, body: TEXT });
const block = (type: string, title: string, content?: string[]) => ({ value: { value: { type, properties: { title: [[title]] }, content } } });
const get = async (url: string) => url.endsWith("/feed") ? RSS : url.endsWith("/sitemap.xml") ? sitemap([ARTICLE_URL]) : ARTICLE_HTML;
const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "edge-india-test-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true }); });

describe("public source boundaries", () => {
  test("only fetches approved HTTPS origins without credentials or nonstandard ports", () => {
    expect(publicUrl(EVENT.website).hostname).toBe("www.edgecity.live");
    for (const url of ["https://evil.test/india26", "http://www.edgecity.live/india26", "https://user:secret@www.edgecity.live/india26", "https://www.edgecity.live:444/india26", "https://edgeesmeralda2026.substack.com/feed"]) {
      expect(() => publicUrl(url)).toThrow();
    }
  });
  test("rejects article paths from other villages or unsafe slugs", () => {
    expect(articlePath(ARTICLE_URL)).toBe("newsletter/housing-for-edge-city-india.md");
    for (const url of ["https://edgeesmeralda2026.substack.com/p/housing", `${EVENT.newsletter}/p/a/b`, `${EVENT.newsletter}/p/a.md`, `${EVENT.newsletter}/p/%2e%2e`]) expect(() => articlePath(url)).toThrow();
  });
  test("preserves useful relative/email links, rejects executable and empty links", () => {
    expect(safeLink("/p/travel", ARTICLE_URL)).toBe(`${EVENT.newsletter}/p/travel`);
    expect(safeLink("mailto:info@edgecity.live", ARTICLE_URL)).toBe("mailto:info@edgecity.live");
    expect(safeLink("javascript:alert(1)", ARTICLE_URL)).toBeUndefined();
    expect(safeLink("", ARTICLE_URL)).toBeUndefined();
  });
});

describe("HTML and RSS", () => {
  test("keeps headings, links, tables and resolves relative links", () => {
    const html = `<main><h2>Accommodation</h2><p>${TEXT}</p><a href="/india26">Apply</a><table><thead><tr><th>Stay</th><th>INR</th></tr></thead><tbody><tr><td>Week</td><td>63700</td></tr></tbody></table></main><nav>Noise</nav><script>danger()</script>`;
    const md = htmlMarkdown(html, EVENT.website);
    expect(md).toContain("## Accommodation");
    expect(md).toContain("[Apply](https://www.edgecity.live/india26)");
    expect(md).toContain("| Stay | INR |");
    expect(md).toContain("63700");
    expect(md).not.toContain("Noise");
    expect(md).not.toContain("danger");
  });
  test("excludes hidden Webflow templates and form states without dropping collapsed FAQs", () => {
    const html = `<main>
      <h1>India</h1>
      <section><h2>Anima House</h2><div class="tag_card-india hide"><em>with Chris Morello</em></div><p>Led by Charlotte.</p></section>
      <section><h2>Hacker House</h2><div class="tag_card-india">with 2:47PM Studio</div></section>
      <div class="hero_row is-principles hide"><p>At Edge Esmeralda, during our month together.</p></div>
      <div class="w-condition-invisible"><p>Unused conditional template.</p></div>
      <div class="w-form"><p>GET UPDATES</p><form><input type="email"></form><div class="w-form-done">You've been added.</div><div class="w-form-fail">Something went wrong.</div></div>
      <div class="accordion_bottom" style="height:0px"><p>FAQ: accommodation and meals are not included.</p><a href="/india26">Apply</a></div>
      <details><summary>Housing</summary><p>Book accommodation separately.</p></details>
    </main>`;
    const md = htmlMarkdown(html, EVENT.website);
    for (const text of ["with Chris Morello", "At Edge Esmeralda", "Unused conditional template", "GET UPDATES", "You've been added", "Something went wrong"]) expect(md).not.toContain(text);
    for (const text of ["Anima House", "Led by Charlotte", "with 2:47PM Studio", "accommodation and meals are not included", "Book accommodation separately", EVENT.website]) expect(md).toContain(text);
  });
  test("keeps historical source text and scopes Webflow template classes to Edge City's website", () => {
    const html = `<article><p>${TEXT}</p><p>Earlier research at Edge Esmeralda.</p><p class="hide">Newsletter source text.</p><div class="w-form-done">Form success noise.</div><div class="w-form-fail">Form error noise.</div></article>`;
    const md = htmlMarkdown(html, ARTICLE_URL, true);
    expect(md).toContain("Earlier research at Edge Esmeralda");
    expect(md).toContain("Newsletter source text");
    expect(md).not.toContain("Form success noise");
    expect(md).not.toContain("Form error noise");
  });
  test("preserves hard breaks without generating trailing whitespace", () => {
    const md = htmlMarkdown("<main><p>First<br>Second</p></main>", EVENT.website);
    expect(md).toContain("First\\\nSecond");
    expect(md).not.toMatch(/[ \t]+$/m);
    const quote = htmlMarkdown("<main><blockquote><p>First</p><p>Second</p></blockquote></main>", EVENT.website);
    expect(quote).toContain("> First\n>\n> Second");
    expect(quote).not.toMatch(/[ \t]+$/m);
  });
  test("extracts article metadata and removes boilerplate", () => {
    const article = htmlDocument(ARTICLE_HTML, ARTICLE_URL, articlePath(ARTICLE_URL), "newsletter");
    expect(article.title).toBe("Housing for India");
    expect(article.published).toBe("2026-08-14T15:43:06.000Z");
    expect(article.body).not.toContain("Navigation noise");
    expect(article.body).toContain("Travel guide");
  });
  test("does not treat a login/challenge page as a valid article", () => {
    expect(() => htmlDocument(`<html><h1>Sign in</h1><p>${TEXT}</p></html>`, ARTICLE_URL, articlePath(ARTICLE_URL), "newsletter")).toThrow();
    expect(() => htmlDocument(`<html><h1>Just a moment</h1><p>${TEXT}</p></html>`, EVENT.website, "website-content.md", "website")).toThrow();
  });
  test("parses a single RSS item and preserves action links", () => {
    const articles = parseFeed(RSS);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.published).toBe("2026-08-14T15:43:06.000Z");
    expect(articles[0]?.body).toContain("https://forms.fillout.com/t/example");
  });
  test("rejects invalid, non-RSS, empty, short, duplicate and foreign feeds", () => {
    for (const xml of ["<rss>", "<html><body>Challenge</body></html>", "<rss><channel/></rss>", RSS.replace(TEXT, "short"), RSS.replace("</channel>", RSS.match(/<item>[\s\S]*<\/item>/)![0] + "</channel>"), RSS.replace(ARTICLE_URL, "https://edgeesmeralda2026.substack.com/p/housing")]) {
      expect(() => parseFeed(xml)).toThrow();
    }
  });
  test("validates sitemap scope and backfills articles outside the feed", async () => {
    const older = `${EVENT.newsletter}/p/welcome-to-edge-city-india`;
    expect(sitemapArticles(sitemap([`${EVENT.newsletter}/archive`, ARTICLE_URL, ARTICLE_URL]))).toEqual([ARTICLE_URL]);
    expect(() => sitemapArticles(sitemap(["https://evil.test/p/post"]))).toThrow();
    const calls: string[] = [];
    const articles = await newsletterDocuments(async url => {
      calls.push(url);
      return url.endsWith("/feed") ? RSS : url.endsWith("sitemap.xml") ? sitemap([ARTICLE_URL, older]) : ARTICLE_HTML;
    });
    expect(articles).toHaveLength(2);
    expect(calls).toContain(older);
    expect(calls).not.toContain(ARTICLE_URL); // Full RSS body needs no duplicate request.
  });
  test("fails the collection if a backfill article is unavailable", async () => {
    await expect(newsletterDocuments(async url => {
      if (url.endsWith("/feed")) return RSS;
      if (url.endsWith("sitemap.xml")) return sitemap([`${EVENT.newsletter}/p/older`]);
      throw new Error("Unavailable older guide");
    })).rejects.toThrow("Unavailable older guide");
  });
});

describe("ordered Notion extraction", () => {
  test("traverses only reachable blocks in parent.content order, including nested toggles", () => {
    const result = notionDocument({ block: {
      orphan: block("text", "PRIVATE_OR_UNRELATED_ORPHAN"),
      detail: block("text", TEXT),
      heading: block("sub_sub_header", "Accommodation", ["detail"]),
      [EVENT.wikiId]: block("page", "India wiki", ["heading"]),
    } });
    expect(result.body.indexOf("Accommodation")).toBeLessThan(result.body.indexOf("Public India guide"));
    expect(result.body).not.toContain("PRIVATE_OR_UNRELATED_ORPHAN");
  });
  test("supports both record-map wrappers and hyphenated IDs", () => {
    const hyphenated = EVENT.wikiId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    expect(notionDocument({ block: {
      [hyphenated]: { value: { type: "page", content: ["text"] } },
      text: { value: { type: "text", properties: { title: [[TEXT]] } } },
    } }).body).toContain("Public India guide");
  });
  test("renders table columns in declared order even without title properties", () => {
    const result = notionDocument({ block: {
      [EVENT.wikiId]: block("page", "India", ["text", "table"]),
      text: block("text", TEXT),
      table: { value: { type: "table", format: { table_block_column_order: ["stay", "price"], table_block_column_header: true }, content: ["header", "row"] } },
      header: { value: { type: "table_row", properties: { price: [["INR"]], stay: [["Stay"]] } } },
      row: { value: { type: "table_row", properties: { price: [["63700"]], stay: [["Week | 1"]] } } },
    } });
    expect(result.body).toContain("| Stay | INR |\n| --- | --- |\n| Week \\| 1 | 63700 |");
  });
  test("preserves inline map mentions without embedding provider metadata", () => {
    const md = notionText([["‣", [["lm", { href: "https://maps.app.goo.gl/example", title: "Google Maps", iframe_url: "PRIVATE_PROVIDER_METADATA" }]]]]);
    expect(md).toContain("[Google Maps](https://maps.app.goo.gl/example)");
    expect(md).not.toContain("PRIVATE_PROVIDER_METADATA");
    expect(notionText([["Apply ", [["b"]]], ["here", [["b"], ["a", EVENT.portal]]]])).toContain(EVENT.portal);
  });
  test("detects missing descendants and rejects incomplete or cyclic trees", () => {
    const incomplete = { block: { [EVENT.wikiId]: block("page", "India", ["missing"]) } };
    expect(missingNotionBlocks(incomplete)).toEqual(["missing"]);
    expect(() => notionDocument(incomplete)).toThrow("Missing reachable");
    expect(() => notionDocument({ block: { [EVENT.wikiId]: block("page", "India", ["cycle"]), cycle: block("toggle", "Cycle", ["cycle"]) } })).toThrow("cyclic");
  });
  test("rejects unsupported database/synced containers instead of omitting content", () => {
    for (const type of ["collection_view", "transclusion_reference"]) {
      expect(() => notionDocument({ block: { [EVENT.wikiId]: block("page", "India", ["unsupported"]), unsupported: block(type, "") } })).toThrow("Unsupported wiki container");
    }
  });
});

describe("publication and retention", () => {
  test("unchanged content preserves document timestamps and every generated byte", () => {
    const first = buildReferenceFiles([doc()], new Map(), "2026-09-30T10:00:00Z");
    const next = buildReferenceFiles([doc()], first, "2026-09-30T10:15:00Z");
    expect([...next]).toEqual([...first]);
    expect(next.get("wiki-content.md")).not.toContain("10:15");
  });
  test("changed content updates timestamp and hash", () => {
    const first = buildReferenceFiles([doc()], new Map(), "2026-09-30T10:00:00Z");
    const next = buildReferenceFiles([{ ...doc(), body: TEXT + "Updated." }], first, "2026-09-30T10:15:00Z");
    expect(next.get("wiki-content.md")).toContain("10:15");
    expect(next.get("manifest.json")).not.toBe(first.get("manifest.json"));
  });
  test("retains disappeared newsletter guides and labels them as retained", () => {
    const first = buildReferenceFiles([doc(), doc("newsletter/housing-for-edge-city-india.md", "newsletter")], new Map());
    const next = buildReferenceFiles([doc()], first);
    expect(next.get("newsletter/housing-for-edge-city-india.md")).toBe(first.get("newsletter/housing-for-edge-city-india.md"));
    expect(next.get("index.md")).toContain("Retained; absent from latest feed/sitemap");
  });
  test("rejects empty publication, traversal, duplicate paths, and cross-event manifests", () => {
    expect(() => buildReferenceFiles([], new Map())).toThrow();
    expect(() => buildReferenceFiles([doc("../secret.md")], new Map())).toThrow();
    expect(() => buildReferenceFiles([doc(), doc()], new Map())).toThrow();
    expect(() => buildReferenceFiles([doc()], new Map([["manifest.json", JSON.stringify({ version: 1, event: "edge-esmeralda", documents: [] })]]))).toThrow("different event");
  });
  test("stages files, no-ops on identical runs, and preserves valid snapshots on invalid paths", () => {
    const refs = join(temp(), "references");
    const files = buildReferenceFiles([doc()], new Map());
    expect(publishReferences(refs, files)).toBe(true);
    expect(publishReferences(refs, files)).toBe(false);
    expect(() => publishReferences(refs, new Map([["../escape.md", "invalid"]]))).toThrow();
    expect([...readReferences(refs)].sort()).toEqual([...files].sort());
  });
  test("does not follow reference symlinks", () => {
    const root = temp();
    const refs = join(root, "references");
    mkdirSync(refs);
    writeFileSync(join(root, "secret"), "secret");
    symlinkSync(join(root, "secret"), join(refs, "wiki-content.md"));
    expect(() => readReferences(refs)).toThrow("symlink");
  });
});

describe("all-or-nothing orchestration", () => {
  test("collects only public India sources without credentials", async () => {
    const docs = await collectDocuments(get, async () => doc());
    expect(docs).toHaveLength(WEBSITE_PAGES.length + 2);
    expect(docs.every(document => !document.url.includes("edgeesmeralda"))).toBe(true);
  });
  test("a failed source rejects the run and preserves every valid India reference", async () => {
    const refs = join(temp(), "references");
    const original = buildReferenceFiles([doc()], new Map(), "2026-09-30T10:00:00Z");
    publishReferences(refs, original);
    await expect(runIndexer(refs, {
      get: async url => { if (url === EVENT.website) throw new Error("Website down"); return get(url); },
      wiki: async () => doc(),
    })).rejects.toThrow("No references published");
    expect([...readReferences(refs)].sort()).toEqual([...original].sort());
  });
  test("publishes India references from scratch and preserves unchanged runs", async () => {
    const root = temp();
    const refs = join(root, "references");
    await runIndexer(refs, { get, wiki: async () => doc(), now: "2026-09-30T10:00:00Z" });
    expect(readFileSync(join(refs, "index.md"), "utf8")).toContain(EVENT.name);
    expect(existsSync(join(root, "archives"))).toBe(false);
    const previous = readReferences(refs);
    await runIndexer(refs, { get, wiki: async () => doc(), now: "2026-09-30T11:00:00Z" });
    expect([...readReferences(refs)].sort()).toEqual([...previous].sort());
  });
});
