import { load } from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EVENT, PUBLIC_HOSTS } from "./sources";

export type SourceKind = "wiki" | "website" | "newsletter";
export interface Document {
  path: string;
  title: string;
  url: string;
  kind: SourceKind;
  body: string;
  published?: string;
  updated?: string;
  author?: string;
}
export type FetchText = (url: string) => Promise<string>;

export function publicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || !PUBLIC_HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error(`Unapproved public source: ${raw}`);
  }
  return url;
}

export function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function safeLink(raw: string, base: string): string | undefined {
  if (!raw.trim()) return;
  try {
    const url = new URL(raw, base);
    if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) return;
    // Markdown destinations cannot contain raw angle brackets or whitespace.
    return url.href.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/\s/g, "%20");
  } catch {
    return;
  }
}

function markdownService(): TurndownService {
  const service = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
  service.use(gfm);
  // Preserve hard line breaks without Git's trailing-whitespace warnings.
  service.addRule("lineBreak", { filter: "br", replacement: () => "\\\n" });
  return service;
}

export function htmlMarkdown(html: string, url: string, articleOnly = false): string {
  const $ = load(html);
  $("script, style, noscript, nav, footer, form, button, input, .w-nav, .w-form-done, .w-form-fail, .subscription-widget-wrap, .subscribe-widget, .post-footer, .comments-section").remove();
  // Edge City's Webflow pages contain hidden template copies and organizer
  // labels. Exclude those, but keep interactive FAQ/accordion answers: an
  // initially collapsed panel is not the same as a permanently hidden block.
  if (["www.edgecity.live", "edgecity.live"].includes(new URL(url).hostname)) {
    $(".hide, .w-condition-invisible, .w-form").remove();
  }
  $("a").each((_, node) => {
    const link = safeLink($(node).attr("href") ?? "", url);
    if (link) $(node).attr("href", link);
    else $(node).removeAttr("href");
  });
  $("img").each((_, node) => {
    const src = safeLink($(node).attr("src") ?? "", url);
    if (src) $(node).attr("src", src);
    else $(node).remove();
  });
  const selectors = articleOnly
    ? [".available-content .body", ".body.markup", ".post-content", "article"]
    : ["main", "article", "body"];
  const selected = selectors.map(selector => $(selector).first()).find(element => element.length);
  if (articleOnly && !selected) throw new Error(`Article body not found: ${url}`);
  return markdownService().turndown(selected?.html() ?? $.html())
    .replace(/^[ \t]+$/gm, "").replace(/^([> \t]*>)[ \t]+$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function validateBody(body: string, url: string): void {
  if (body.length < 120) throw new Error(`Empty or unexpectedly short content: ${url}`);
}

function date(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid publication date: ${value}`);
  return new Date(timestamp).toISOString();
}

export function htmlDocument(html: string, url: string, path: string, kind: "website" | "newsletter"): Document {
  const $ = load(html);
  const title = cleanTitle($("meta[property='og:title']").attr("content") ?? $("h1").first().text() ?? "");
  if (!title || /^(?:just a moment|access denied|sign in|log in|error|not found)\b/i.test(title)) throw new Error(`Missing or invalid page title: ${url}`);
  const body = htmlMarkdown(html, url, kind === "newsletter");
  validateBody(body, url);
  return {
    path, title, url, kind, body,
    published: date($("meta[property='article:published_time']").attr("content")),
    updated: date($("meta[property='article:modified_time']").attr("content")),
  };
}

function parseXml(xml: string): Record<string, unknown> {
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid XML response");
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml) as Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function articlePath(raw: string): string {
  const url = publicUrl(raw);
  const match = /^\/p\/([a-z0-9][a-z0-9-]{0,159})$/.exec(url.pathname);
  if (url.origin !== EVENT.newsletter || !match?.[1]) throw new Error(`Invalid India article URL: ${raw}`);
  return `newsletter/${match[1]}.md`;
}

export function parseFeed(xml: string): Document[] {
  const channel = object(object(parseXml(xml).rss).channel);
  const items = list(channel.item);
  if (!items.length) throw new Error("RSS feed has no articles; refusing to replace references");
  const documents = items.map(value => {
    const item = object(value);
    if (typeof item.link !== "string" || typeof item.title !== "string") throw new Error("RSS article missing title or URL");
    const url = publicUrl(item.link);
    url.search = "";
    url.hash = "";
    const html = item["content:encoded"] ?? item.description;
    if (typeof html !== "string") throw new Error(`RSS article has no content: ${url}`);
    const body = htmlMarkdown(html, url.href);
    validateBody(body, url.href);
    return {
      path: articlePath(url.href), title: cleanTitle(item.title), url: url.href,
      kind: "newsletter" as const, body, published: date(item.pubDate),
      author: typeof item["dc:creator"] === "string" ? cleanTitle(item["dc:creator"]) : undefined,
    };
  });
  if (new Set(documents.map(doc => doc.path)).size !== documents.length) throw new Error("Duplicate RSS article URLs");
  return documents;
}

export function sitemapArticles(xml: string): string[] {
  const root = object(parseXml(xml).urlset);
  if (!root.url) throw new Error("Expected a newsletter URL sitemap");
  const urls = list(root.url).map(value => object(value).loc).filter((value): value is string => typeof value === "string");
  const articles = urls.filter(raw => {
    const url = publicUrl(raw);
    return url.origin === EVENT.newsletter && url.pathname.startsWith("/p/");
  }).map(raw => {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    articlePath(url.href);
    return url.href;
  });
  if (!articles.length || articles.length > 200) throw new Error("Unexpected newsletter sitemap size");
  return [...new Set(articles)].sort();
}

export async function newsletterDocuments(fetchText: FetchText): Promise<Document[]> {
  const [feed, sitemap] = await Promise.all([
    fetchText(`${EVENT.newsletter}/feed`), fetchText(`${EVENT.newsletter}/sitemap.xml`),
  ]);
  const byUrl = new Map(parseFeed(feed).map(doc => [doc.url, doc]));
  // RSS is a rolling window. Backfill every public article listed in the sitemap.
  for (const url of sitemapArticles(sitemap)) {
    if (!byUrl.has(url)) byUrl.set(url, htmlDocument(await fetchText(url), url, articlePath(url), "newsletter"));
  }
  return [...byUrl.values()].sort((a, b) => a.path.localeCompare(b.path));
}

interface Block {
  type: string;
  properties?: Record<string, unknown>;
  content?: string[];
  format?: Record<string, unknown>;
  last_edited_time?: number;
  alive?: boolean;
}

function normalizeId(id: string): string { return id.replace(/-/g, ""); }

function blockValue(entry: unknown): Block | undefined {
  const wrapper = object(entry);
  const value = object(wrapper.value);
  const block = typeof value.type === "string" ? value : object(value.value);
  return typeof block.type === "string" ? block as unknown as Block : undefined;
}

function notionPlainText(value: unknown): string {
  return list(value).map(part => Array.isArray(part) ? String(part[0] ?? "") : typeof part === "string" ? part : "").join("");
}

export function notionText(value: unknown): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = list(value).map(part => {
    if (!Array.isArray(part)) return typeof part === "string" ? escape(part) : "";
    const raw = typeof part[0] === "string" ? part[0] : "";
    if (!raw.trim()) return escape(raw);
    let text = escape(raw).replace(/\n/g, "<br>");
    const annotations = Array.isArray(part[1]) ? part[1] as unknown[][] : [];
    for (const annotation of annotations) {
      if (annotation[0] === "p" && typeof annotation[1] === "string") {
        const pageId = normalizeId(annotation[1]);
        if (/^[a-f0-9]{32}$/i.test(pageId)) text = `<a href="https://edgecity.notion.site/${pageId}">${raw === "‣" ? "Notion page" : text}</a>`;
      } else if (annotation[0] === "lm") {
        const mention = object(annotation[1]);
        const link = typeof mention.href === "string" ? safeLink(mention.href, EVENT.wikiUrl) : undefined;
        if (link) text = `<a href="${escape(link)}">${escape(typeof mention.title === "string" ? mention.title : raw)}</a>`;
      } else if (annotation[0] === "a" && typeof annotation[1] === "string") {
        const link = safeLink(annotation[1], EVENT.wikiUrl);
        if (link) text = `<a href="${escape(link)}">${text}</a>`;
      } else if (annotation[0] === "b") text = `<strong>${text}</strong>`;
      else if (annotation[0] === "i") text = `<em>${text}</em>`;
      else if (annotation[0] === "c") text = `<code>${text}</code>`;
      else if (annotation[0] === "s") text = `<del>${text}</del>`;
    }
    return text;
  }).join("");
  return markdownService().turndown(html).replace(/^[ \t]+$/gm, "");
}

export function missingNotionBlocks(recordMap: { block: Record<string, unknown> }): string[] {
  const blocks = new Map(Object.entries(recordMap.block).map(([id, entry]) => [normalizeId(id), blockValue(entry)]));
  const seen = new Set<string>();
  const missing: string[] = [];
  function visit(id: string): void {
    const key = normalizeId(id);
    if (seen.has(key)) return;
    seen.add(key);
    const block = blocks.get(key);
    if (!block) { missing.push(id); return; }
    if (block.alive === false) return;
    for (const child of block.content ?? []) visit(child);
  }
  visit(EVENT.wikiId);
  return missing;
}

export function notionDocument(recordMap: { block: Record<string, unknown> }): Document {
  const blocks = new Map<string, Block>();
  for (const [id, entry] of Object.entries(recordMap.block)) {
    const value = blockValue(entry);
    if (value) blocks.set(normalizeId(id), value);
  }
  const root = blocks.get(EVENT.wikiId);
  if (!root || root.type !== "page" || !root.content?.length) throw new Error("India wiki root not found or empty");
  const seen = new Set<string>();
  const pieces: string[] = [];
  const updated: number[] = [];
  const getBlock = (id: string): Block => {
    const block = blocks.get(normalizeId(id));
    if (!block) throw new Error(`Missing reachable wiki block: ${id}`);
    return block;
  };
  function walk(id: string, depth: number, listDepth = 0): void {
    const key = normalizeId(id);
    if (seen.has(key)) throw new Error(`Repeated or cyclic wiki block: ${id}`);
    seen.add(key);
    const block = getBlock(id);
    if (block.alive === false) return;
    if (block.last_edited_time) updated.push(block.last_edited_time);
    const text = notionText(block.properties?.title);
    let rendered = "";
    switch (block.type) {
      case "page": if (depth > 0) rendered = `## ${text}`; break;
      case "header": rendered = `## ${text}`; break;
      case "sub_header": rendered = `### ${text}`; break;
      case "sub_sub_header": rendered = `#### ${text}`; break;
      case "toggle": rendered = `### ${text}`; break;
      case "bulleted_list": rendered = `${"  ".repeat(listDepth)}- ${text}`; break;
      case "numbered_list": rendered = `${"  ".repeat(listDepth)}1. ${text}`; break;
      case "to_do": rendered = `- [${notionText(block.properties?.checked) === "Yes" ? "x" : " "}] ${text}`; break;
      case "quote": case "callout": rendered = text ? text.split("\n").map(line => `> ${line}`).join("\n") : ""; break;
      case "divider": rendered = "---"; break;
      case "code": rendered = `\`\`\`\n${notionPlainText(block.properties?.title)}\n\`\`\``; break;
      case "table": {
        const columns = block.format?.table_block_column_order;
        if (!Array.isArray(columns) || !columns.length || !block.content?.length) throw new Error("Malformed wiki table");
        const rows = block.content.map(rowId => {
          const row = getBlock(rowId);
          seen.add(normalizeId(rowId));
          if (row.last_edited_time) updated.push(row.last_edited_time);
          return columns.map(column => notionText(row.properties?.[String(column)]).replace(/\|/g, "\\|").replace(/\n/g, "<br>"));
        });
        if (block.format?.table_block_column_header !== true) rows.unshift(columns.map((_, i) => `Column ${i + 1}`));
        rows.splice(1, 0, columns.map(() => "---"));
        pieces.push(rows.map(row => `| ${row.join(" | ")} |`).join("\n"));
        return;
      }
      case "image": case "bookmark": case "embed": case "file": case "video": case "pdf": {
        const link = safeLink(notionPlainText(block.properties?.source), EVENT.wikiUrl);
        if (link) rendered = `[${notionText(block.properties?.caption) || text || block.type}](<${link}>)`;
        break;
      }
      case "column_list": case "column": break;
      default:
        if (["collection_view", "collection_view_page", "transclusion_reference", "transclusion_container"].includes(block.type)) {
          throw new Error(`Unsupported wiki container: ${block.type}; refusing incomplete publication`);
        }
        rendered = text;
    }
    if (rendered) pieces.push(rendered);
    const childListDepth = listDepth + (["bulleted_list", "numbered_list", "to_do"].includes(block.type) ? 1 : 0);
    for (const child of block.content ?? []) walk(child, depth + 1, childListDepth);
  }
  walk(EVENT.wikiId, 0);
  const body = pieces.join("\n\n");
  validateBody(body, EVENT.wikiUrl);
  return {
    path: "wiki-content.md", title: `${EVENT.name} Wiki`, url: EVENT.wikiUrl,
    kind: "wiki", body, updated: updated.length ? new Date(Math.max(...updated)).toISOString() : undefined,
  };
}
