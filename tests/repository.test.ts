import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => Bun.file(new URL(path, root)).text();

describe("India-only repository", () => {
  test("does not ship legacy archives, migration code, or the old refresh workflow", async () => {
    expect(existsSync(new URL("archives", root))).toBe(false);
    expect(existsSync(new URL(".github/workflows/index.yml", root))).toBe(false);
    expect(await read("scripts/publish.ts")).not.toContain("archiveEsmeralda");
    expect(await read("scripts/index.ts")).not.toContain("archiveEsmeralda");
  });

  test("CI validates offline with read-only permissions and no publisher or schedule", async () => {
    const workflow = await read(".github/workflows/test.yml");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("bun run test");
    expect(workflow).toContain("bun run typecheck");
    for (const forbidden of ["schedule:", "cron:", "bun run index", "git push", "contents: write"]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  test("documents verified AWS operation without claiming guaranteed freshness", async () => {
    const readme = await read("README.md");
    expect(readme).toContain("Automatic refresh is enabled on AWS");
    expect(readme).toContain("This is not a freshness guarantee");
    const status = JSON.parse(await read("infra/deployment-status.json"));
    expect(status.repository).toBe("p2p-lanes/edge-agent-skill");
    expect(status.scheduleState).toBe("ENABLED");
    expect(status.scheduledProofBuild).toContain("edge-india-reference-refresh:");
    expect(status.note).toContain("not live status");
    expect(readme).toContain("https://raw.githubusercontent.com/p2p-lanes/edge-agent-skill/main/references/index.md");
    expect(readme).toContain("GitHub Actions runs offline validation only");
  });
});
