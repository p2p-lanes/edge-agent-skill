import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { indexerHash } from "./code-hash";
import { artifactsTemplate, refreshTemplate } from "./template";
import config from "./config.json";
import { aws, run } from "./aws";

if (Bun.version !== "1.4.2") throw new Error("Deploy with Bun 1.4.2, matching the tested runtime and CodeBuild");
if (await run(["git", "status", "--porcelain"])) throw new Error("Commit deployment code before deploying");
const head = await run(["git", "rev-parse", "HEAD"]);
const remote = (await run(["git", "ls-remote", "origin", "refs/heads/main"])).split(/\s/)[0];
if (head !== remote) throw new Error("Push this revision to main before deploying");
mkdirSync("dist", { recursive: true });
await Bun.write("dist/artifacts.json", JSON.stringify(artifactsTemplate));
await Bun.write("dist/refresh.json", JSON.stringify(refreshTemplate));
const hash = await indexerHash();
console.log(JSON.stringify({ event: "deploy-start", revision: head, indexerHash: hash }));
await run(["bun", "build", "infra/runtime.ts", "--compile", "--target=bun-linux-arm64", "--define", "import.meta.main=false", "--outfile", "dist/bootstrap"]);
await run(["chmod", "755", "dist/bootstrap"]);
rmSync("dist/lambda.zip", { force: true });
await run(["zip", "-q", "-j", "dist/lambda.zip", "dist/bootstrap"]);
const region = ["--region", config.region];
await aws(["cloudformation", "deploy", ...region, "--stack-name", config.artifactStack, "--template-file", "dist/artifacts.json", "--no-fail-on-empty-changeset", "--tags", "Project=edge-india-docs"]);
const bucket = await aws(["cloudformation", "describe-stacks", ...region, "--stack-name", config.artifactStack, "--query", "Stacks[0].Outputs[?OutputKey==`Bucket`].OutputValue | [0]", "--output", "text"]);
const zipHash = createHash("sha256").update(Buffer.from(await Bun.file("dist/lambda.zip").arrayBuffer())).digest("hex");
const key = `lambda/${zipHash}.zip`;
await aws(["s3", "cp", "dist/lambda.zip", `s3://${bucket}/${key}`, ...region, "--sse", "AES256", "--only-show-errors"]);
// Every deployment pauses scheduling. Re-enable only after authenticated checks.
console.log("Deploying with schedule DISABLED; run verification builds before enabling.");
await aws(["cloudformation", "deploy", ...region, "--stack-name", config.stack, "--template-file", "dist/refresh.json", "--capabilities", "CAPABILITY_IAM", "--no-fail-on-empty-changeset",
  "--parameter-overrides", `ArtifactBucket=${bucket}`, `ArtifactKey=${key}`, `IndexerHash=${hash}`, `ConnectionArn=${config.connectionArn}`, "ScheduleState=DISABLED", "--tags", "Project=edge-india-docs"]);
await Bun.write("dist/deployment.json", JSON.stringify({ revision: head, indexerHash: hash, bucket, key, ...config }, null, 2));
console.log(JSON.stringify({ event: "deploy-ready", function: config.functionName, project: config.projectName, scheduleState: "DISABLED", indexerHash: hash }));
