import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexerHash } from "../infra/code-hash";
import { publishReferences, readReferences } from "./publish";
import { decodeSnapshot, MAX_PAYLOAD_BYTES, snapshotDigest, validateSnapshot } from "./reference-state";

async function command(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [exit, output] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (exit !== 0) throw new Error(`${args[0]} command failed (exit ${exit}); no automatic retry or force-push`);
  return output.trim();
}

export async function refreshAws() {
  const region = process.env.AWS_REGION ?? "us-east-2";
  const fn = process.env.INDEXER_FUNCTION_NAME;
  const mode = process.env.REFRESH_MODE ?? "publish";
  if (!fn || !["publish", "dry-run", "verify-write"].includes(mode)) throw new Error("Invalid refresh configuration");
  const origin = new URL(await command(["git", "remote", "get-url", "origin"]));
  if (origin.hostname !== "github.com" || origin.pathname.replace(/\.git$/, "") !== "/p2p-lanes/edge-agent-skill" || origin.username || origin.password) throw new Error("Unexpected publication repository");
  if (await command(["git", "status", "--porcelain", "--untracked-files=no"])) throw new Error("Checkout must be clean before refresh");
  const head = await command(["git", "rev-parse", "HEAD"]);
  const assertHead = async () => {
    const remote = (await command(["git", "ls-remote", "origin", "refs/heads/main"])).split(/\s/)[0];
    if (remote !== head) throw new Error("main changed during refresh; aborting without rebasing or force-pushing");
  };
  await assertHead();
  await command(["git", "config", "user.name", "edge-india-indexer[bot]"]);
  await command(["git", "config", "user.email", "edge-india-indexer@users.noreply.github.com"]);
  if (mode === "verify-write") {
    const branch = `verify/edge-india-publisher-${crypto.randomUUID()}`;
    await command(["git", "commit", "--allow-empty", "-m", "Verify AWS reference publisher (temporary branch)"]);
    await command(["git", "push", "origin", `HEAD:refs/heads/${branch}`]);
    await command(["git", "push", "origin", `:refs/heads/${branch}`]);
    console.log(JSON.stringify({ event: "publisher-write-verified", mainUnchanged: true }));
    return;
  }
  const work = mkdtempSync(join(tmpdir(), "edge-india-refresh-"));
  try {
    const previous = readReferences("references");
    validateSnapshot(previous);
    const hash = await indexerHash();
    const input = JSON.stringify({ protocol: 1, indexerHash: hash, baselineDigest: snapshotDigest(previous), previous: [...previous] });
    if (Buffer.byteLength(input) > MAX_PAYLOAD_BYTES) throw new Error("Input exceeds safe Lambda payload limit");
    const inputPath = join(work, "input.json");
    const outputPath = join(work, "output.json");
    await Bun.write(inputPath, input);
    const metadata = JSON.parse(await command(["aws", "lambda", "invoke", "--region", region, "--function-name", fn,
      "--invocation-type", "RequestResponse", "--cli-binary-format", "raw-in-base64-out", "--cli-read-timeout", "240",
      "--payload", `file://${inputPath}`, "--output", "json", outputPath]));
    if (metadata.FunctionError || metadata.StatusCode !== 200) {
      const result = await Bun.file(outputPath).json();
      throw new Error(typeof result.errorMessage === "string" ? result.errorMessage : "Lambda refresh failed; no publication");
    }
    const result = await Bun.file(outputPath).json();
    if (result.protocol !== 1 || result.indexerHash !== hash || result.baselineDigest !== snapshotDigest(previous)) throw new Error("Unexpected Lambda response");
    const files = decodeSnapshot(result.files);
    if (snapshotDigest(files) !== result.digest) throw new Error("Lambda result digest mismatch");
    const summary = validateSnapshot(files);
    if (mode === "dry-run") {
      console.log(JSON.stringify({ event: "refresh-dry-run", ...summary, changed: snapshotDigest(files) !== snapshotDigest(previous) }));
      return;
    }
    await assertHead();
    if (!publishReferences("references", files)) {
      console.log(JSON.stringify({ event: "refresh-no-changes", ...summary }));
      return;
    }
    await command(["git", "add", "--", "references"]);
    const staged = (await command(["git", "diff", "--cached", "--name-only"])).split("\n").filter(Boolean);
    if (!staged.length || staged.some(path => !path.startsWith("references/"))) throw new Error("Unexpected staged publication paths");
    await command(["git", "diff", "--cached", "--check"]);
    await command(["git", "commit", "-m", "Update India reference content [automated]"]);
    await command(["git", "push", "origin", "HEAD:refs/heads/main"]);
    console.log(JSON.stringify({ event: "refresh-published", ...summary, filesChanged: staged.length }));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (import.meta.main) {
  try { await refreshAws(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Refresh failed"); process.exitCode = 1; }
}
