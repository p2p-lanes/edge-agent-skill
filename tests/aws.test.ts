import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildReferenceFiles, readReferences } from "../scripts/publish";
import { decodeSnapshot, snapshotDigest, validateSnapshot } from "../scripts/reference-state";
import { refreshSnapshot } from "../scripts/lambda-handler";
import { EVENT } from "../scripts/sources";
import { artifactsTemplate, refreshTemplate } from "../infra/template";
import { indexerHash } from "../infra/code-hash";

const doc = { path: "wiki-content.md", title: "India wiki", kind: "wiki" as const, url: EVENT.wikiUrl, body: "Public India documentation, preserving travel and safety caveats. ".repeat(5) };
const seed = buildReferenceFiles([doc], new Map(), "2026-10-05T10:00:00.000Z");
const request = () => ({ protocol: 1, indexerHash: "test-hash", baselineDigest: snapshotDigest(seed), previous: [...seed] });

describe("Lambda snapshot generation", () => {
  test("validates real references and preserves byte-identical unchanged snapshots", async () => {
    expect(validateSnapshot(readReferences(fileURLToPath(new URL("../references", import.meta.url)))).documents).toBeGreaterThan(0);
    const response = await refreshSnapshot(request(), { expectedHash: "test-hash", collect: async () => [doc], now: "2026-10-05T10:15:00.000Z" });
    expect(response.changed).toBe(false);
    expect(response.digest).toBe(snapshotDigest(seed));
    expect([...decodeSnapshot(response.files)]).toEqual([...seed]);
  });
  test("rejects missing or stale deployments and tampered baselines before fetching", async () => {
    let fetched = false;
    const options = { expectedHash: "test-hash", collect: async () => { fetched = true; return [doc]; } };
    await expect(refreshSnapshot({ ...request(), indexerHash: "old" }, options)).rejects.toThrow("redeploy");
    await expect(refreshSnapshot({ ...request(), baselineDigest: "tampered" }, options)).rejects.toThrow("Baseline digest");
    expect(fetched).toBe(false);
  });
  test("a source failure returns no replacement snapshot and does not mutate the prior one", async () => {
    const input = request();
    const original = JSON.stringify(input);
    await expect(refreshSnapshot(input, { expectedHash: "test-hash", collect: async () => { throw new Error("Source down"); } })).rejects.toThrow("Source down");
    expect(JSON.stringify(input)).toBe(original);
  });
  test("rejects traversal, duplicates, cross-event manifests, orphaned files, and content tampering", () => {
    expect(() => decodeSnapshot([...seed, ["../secret", "bad"]])).toThrow();
    expect(() => decodeSnapshot([...seed, [...seed][0]])).toThrow();
    expect(() => decodeSnapshot([...seed, ["newsletter/unlisted.md", "bad"]])).toThrow();
    const changed = new Map(seed);
    changed.set("wiki-content.md", changed.get("wiki-content.md")! + "tampered");
    expect(() => decodeSnapshot([...changed])).toThrow("hash mismatch");
    changed.set("manifest.json", JSON.stringify({ version: 1, event: "another-event", documents: [] }));
    expect(() => decodeSnapshot([...changed])).toThrow("India manifest");
  });
});

describe("dedicated AWS infrastructure", () => {
  test("has disabled-by-default scheduling, bounded retries, and single concurrency", () => {
    expect(refreshTemplate.Parameters.ScheduleState.Default).toBe("DISABLED");
    expect(refreshTemplate.Resources.Schedule.Properties.ScheduleExpression).toBe("rate(15 minutes)");
    expect(refreshTemplate.Resources.Schedule.Properties.Target.RetryPolicy.MaximumRetryAttempts).toBe(0);
    expect(JSON.parse(refreshTemplate.Resources.Schedule.Properties.Target.Input)).toEqual({ projectName: "edge-india-reference-refresh" });
    expect(refreshTemplate.Resources.Schedule.Properties.Target.DeadLetterConfig).toBeDefined();
    expect(refreshTemplate.Resources.DeliveryQueue.Properties.SqsManagedSseEnabled).toBe(true);
    expect(refreshTemplate.Resources.SchedulerFailureAlarm.Properties.MetricName).toBe("TargetErrorCount");
    expect(refreshTemplate.Resources.Indexer.Properties.ReservedConcurrentExecutions).toBe(1);
    expect(refreshTemplate.Resources.Publisher.Properties.ConcurrentBuildLimit).toBe(1);
  });
  test("uses a source-specific connection and no new permanent GitHub credential", () => {
    expect(refreshTemplate.Resources.Publisher.Properties.Source.Auth.Type).toBe("CODECONNECTIONS");
    expect(refreshTemplate.Resources.Publisher.Properties.Source.Location).toBe("https://github.com/p2p-lanes/edge-agent-skill.git");
    const role = JSON.stringify(refreshTemplate.Resources.LambdaRole);
    expect(role).not.toContain("codeconnections:");
    expect(role).not.toContain("secretsmanager:");
    expect(JSON.stringify(refreshTemplate)).not.toContain("PERSONAL_ACCESS_TOKEN");
    expect(readFileSync(new URL("../infra/buildspec.yml", import.meta.url), "utf8")).toContain("git-credential-helper: yes");
  });
  test("keeps artifacts private and encrypted, without granting application S3 access", () => {
    const bucket = artifactsTemplate.Resources.Artifacts.Properties;
    expect(Object.values(bucket.PublicAccessBlockConfiguration).every(Boolean)).toBe(true);
    expect(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0]!.ServerSideEncryptionByDefault.SSEAlgorithm).toBe("AES256");
    expect(JSON.stringify(refreshTemplate.Resources.LambdaRole)).not.toContain("s3:");
  });
  test("computes a stable hash covering the deployed runtime and dependencies", async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const hash = await indexerHash(root);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await indexerHash(root)).toBe(hash);
  });
});
