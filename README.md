# Edge City India 2026 — Agent Skill

Public documentary knowledge for the three-week popup village in Mandrem, North Goa, **October 11–November 1, 2026** (`Asia/Kolkata`).

This is the canonical India-only repository. It has a new history, no Esmeralda archives, and no synchronization with the previous repository.

## For users

Download [`SKILL.md`](./SKILL.md) and add it to your agent:

- **Claude Code:** `~/.claude/skills/edge-india/SKILL.md`
- **Other agents:** your host's skill/context directory.

Install only `SKILL.md`, not the reference Markdown. No API keys are needed; internet access is required. For each documentary query, the agent fetches the remote index and relevant documents without persisting or reusing previous copies.

Reference index: https://raw.githubusercontent.com/franvinas/edge-agent-skill/main/references/index.md

Browse the documents at [`references/index.md`](./references/index.md). If references are unavailable, the skill provides primary-source fallbacks.

For live calendar, venues, RSVPs, and attendee directory queries, use AgentVillage's `edgeos` skill with verified India access. Otherwise consult https://portal.edgecity.live/portal/edge-india.

## For maintainers

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run index
```

`bun run index` refreshes local references; it does not commit or publish them.

### Refresh status and AWS migration

**Automatic refresh is not yet enabled.** The committed documents are snapshots, not a guarantee of current logistics. GitHub Actions runs offline validation only; it does not fetch sources or publish references.

The complete indexer has been tested with Bun 1.4.2 in AWS Lambda (`us-east-2`, ARM64, custom runtime `provided.al2023`, 512 MB). It validated 24 documents, preserved unchanged files across repeated runs, and preserved valid references on a simulated source failure. The temporary test function and role were deleted; this is not a production deployment.

The intended production setup is:

1. EventBridge Scheduler invokes Lambda every 15 minutes on a best-effort schedule.
2. Lambda retrieves the current references from this repository and works in `/tmp`.
3. All approved sources must fetch, parse, and validate before publication.
4. A GitHub App publishes actual changes to this repository, without copying references to other repositories.
5. App credentials are stored in AWS Secrets Manager, never in Git or the skill.

The Lambda entrypoint, deployment infrastructure, and GitHub publisher still need to be implemented and activated. Create the GitHub App under `franvinas`, allow installation only on this account, select only this repository, and grant **Contents: read and write** with no other optional permissions. No webhook is needed.

Cloudflare challenged RSS/sitemap requests from GitHub-hosted runners during testing. The same sources and the complete Bun indexer succeeded in Lambda. That result is not a guarantee against future source outages or access-policy changes.

### Project structure

- `SKILL.md` — standalone, remotely retrieving documentary skill.
- `references/` — generated India index, manifest, and Markdown.
- `scripts/sources.ts` — event constants and approved public sources.
- `scripts/content.ts` — extraction, XML validation, and ordered Notion traversal.
- `scripts/publish.ts` — deterministic publication and newsletter retention.
- `scripts/index.ts` — public fetching and orchestration.
- `tests/` — offline regression and reference-integrity tests.
- `.github/workflows/test.yml` — validation only; no refresh schedule.

### Public sources

| Source | Input | Output |
| --- | --- | --- |
| India wiki | [Public Notion page](https://edgecity.notion.site/Edge-City-India-2026-Wiki-038d45cdfc5983c7a1fe013fdc77135b) | `references/wiki-content.md` |
| India website/FAQ | [india26](https://www.edgecity.live/india26) | `references/website-content.md` |
| Organization background | [About](https://www.edgecity.live/about) | `references/website/about.md` |
| Public guides/updates | [Substack RSS](https://edgecityindia2026.substack.com/feed) + [sitemap](https://edgecityindia2026.substack.com/sitemap.xml) | `references/newsletter/*.md` |
| Selected residency pages | Explicit URLs in `scripts/sources.ts` | `references/residencies/*.md` |

Headings, links, tables, order, dates, and caveats are preserved. Notion extraction includes only reachable public documentary blocks, not permissions, user records, discussions, or internal metadata. Hidden website templates and form states are excluded without dropping collapsed FAQ answers.

Only approved sources are fetched. Housing spreadsheets, booking forms, Telegram groups, external residency sites, and attendee portals are linked resources, **not crawl targets**.

### Publication and freshness safeguards

- Every source must succeed before publication. Failures leave existing references unchanged.
- Files are staged before swapping the reference directory; a failed final rename restores the previous directory.
- The sitemap backfills newsletter articles outside the RSS window. Disappeared guides are retained and labeled, not deleted.
- Content hashes preserve timestamps on unchanged runs.
- **Last content change indexed** is not the latest fetch, publication date, approval date, or freshness guarantee.
- Source conflicts are preserved, not silently reconciled. Cite conflicting evidence and confirm operational details with the team.
- Historical mentions in legitimate India source text are preserved; they are not India logistics from another event.

### Distribution through AgentVillage

The intended integration installs only `SKILL.md` at `skills/edge-india/SKILL.md`. Registration in AgentVillage's catalogs and installer is a separate change. References stay here and are retrieved remotely for each documentary query; no cross-repository reference synchronization is needed.

Calendar, directory, venue, and RSVP integrations belong to `edgeos`. This repository has no Index Network or Geo Browser placeholders and no authenticated live-event integration.

### Attribution

The initial India-only snapshot derives from [aromeoes/edge-agent-skill](https://github.com/aromeoes/edge-agent-skill), including its public indexer and the India documentary skill attributed to Edge City. Source links and original article attribution remain in the generated references. No upstream license file was present in the imported snapshot; this import does not assign a new license.
