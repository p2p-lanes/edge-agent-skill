# Edge City India 2026 — Agent Skill

Public documentary knowledge for Mandrem, North Goa, **October 11–November 1, 2026** (`Asia/Kolkata`). This is the canonical India-only repository, with a new history and no Esmeralda archives or cross-repository synchronization.

## For users

Download [`SKILL.md`](./SKILL.md) and install it in your agent's skill directory, for example `~/.claude/skills/edge-india/SKILL.md`.

Install only the skill, not the reference Markdown. No API keys are needed; internet access is required. For each documentary query, the skill retrieves the remote index and relevant documents without persisting or reusing previous copies.

Reference index: https://raw.githubusercontent.com/p2p-lanes/edge-agent-skill/main/references/index.md

Browse [`references/index.md`](./references/index.md). The skill includes primary-source fallbacks when references are unavailable.

Live calendar, venues, RSVPs, and attendee directory belong to AgentVillage's `edgeos` skill with verified India access. Otherwise consult https://portal.edgecity.live/portal/edge-india.

## For maintainers

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run index
```

`bun run index` refreshes local references only; it does not commit or publish them. GitHub Actions runs offline validation only; it never fetches sources or publishes references.

### Automatic refresh status

**Automatic refresh is not yet enabled.** Deployment and authenticated checks are in progress; the committed documents are snapshots, not a freshness guarantee.

The AWS implementation uses EventBridge Scheduler → a dedicated CodeBuild publisher → Bun in Lambda → CodeBuild publication to this repository. All documentary requests come from Lambda, not GitHub-hosted runners. The existing AWS Connector for GitHub installation in `p2p-lanes` is accessed through project-specific CodeConnections authentication; there is no new GitHub App, PAT, or stored GitHub private key. Existing pipelines and account-level CodeBuild credentials are not changed.

The intended schedule is every 15 minutes, best-effort. A refresh can fail, be delayed, or return unchanged content. **Last content change indexed** is not the latest fetch, publication date, approval date, or freshness guarantee. Check AWS execution logs for the latest attempt.

See [`infra/README.md`](./infra/README.md) for deployment, manual execution, logs, pause/resume, permissions, and costs. Scheduling is enabled only after a real temporary-branch write test, two successful full refresh builds, and a genuine scheduled-delivery proof.

### Project structure

- `SKILL.md` — standalone documentary skill using remote references.
- `references/` — generated India index, manifest, and documents.
- `scripts/sources.ts` — event constants and approved public sources.
- `scripts/content.ts` — extraction, XML validation, ordered Notion traversal.
- `scripts/publish.ts` — deterministic publication and newsletter retention.
- `scripts/reference-state.ts` — snapshot, source, hash, and payload validation.
- `scripts/lambda-handler.ts` — credential-free Lambda generation.
- `scripts/refresh-aws.ts` — CodeBuild invocation and reference-only Git publication.
- `infra/` — versioned AWS configuration, runtime, CloudFormation, deployment, and scheduling controls.
- `tests/` — offline regression, infrastructure, and reference-integrity tests.
- `.github/workflows/test.yml` — offline validation with read-only permissions.

### Public sources

| Source | Input | Output |
| --- | --- | --- |
| India wiki | [Public Notion page](https://edgecity.notion.site/Edge-City-India-2026-Wiki-038d45cdfc5983c7a1fe013fdc77135b) | `references/wiki-content.md` |
| India website/FAQ | [india26](https://www.edgecity.live/india26) | `references/website-content.md` |
| Organization background | [About](https://www.edgecity.live/about) | `references/website/about.md` |
| Public guides/updates | [Substack RSS](https://edgecityindia2026.substack.com/feed) + [sitemap](https://edgecityindia2026.substack.com/sitemap.xml) | `references/newsletter/*.md` |
| Selected residency pages | Explicit URLs in `scripts/sources.ts` | `references/residencies/*.md` |

Headings, links, tables, order, dates, caveats, and conflicts are preserved. Notion extraction includes only reachable public documentary blocks, not permissions, user records, discussions, or internal metadata. Hidden website templates and form states are excluded without losing collapsed FAQ answers.

Only approved sources are fetched. Housing spreadsheets, booking forms, Telegram, external residency sites, and attendee portals are linked resources, **not crawl targets**.

### Publication safeguards

- Every source must fetch, parse, and validate before any publication. Failures leave valid references intact.
- Snapshots have validated source URLs, paths, metadata, content hashes, and index coverage.
- Newsletter articles absent from the RSS/sitemap are retained and labeled, not deleted.
- Unchanged content preserves timestamps and creates no commit.
- Files are staged before swapping local references, then published by a normal fast-forward Git push.
- Only `references/` can be committed by the publisher. Concurrent changes to `main` cause an abort, never a rebase or force-push.
- Lambda must match the checked-out indexer/dependency hash; code changes require redeployment rather than silently running an old parser.
- Oversized requests/results fail without publication. The transport has a conservative 5 MiB payload limit.
- Historical mentions in legitimate India sources are preserved, not used as another event's logistics.

### Distribution through AgentVillage

The intended integration installs only `SKILL.md` at `skills/edge-india/SKILL.md`. Catalog/installer registration is a separate change. References stay here and are fetched remotely for each documentary query.

Calendar, directory, venue, and RSVP integrations belong to `edgeos`; this repo has no Index Network or Geo Browser placeholders or authenticated live-event integrations.

### Attribution

The initial India-only snapshot derives from [aromeoes/edge-agent-skill](https://github.com/aromeoes/edge-agent-skill), including its public indexer and India skill attributed to Edge City. Original source links and article attribution remain. No upstream license file was present in the imported snapshot; this import does not assign a new license.
