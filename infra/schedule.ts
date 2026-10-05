import config from "./config.json";
import { indexerHash } from "./code-hash";
import { aws } from "./aws";

const state = Bun.argv[2]?.toUpperCase();
if (!["ENABLED", "DISABLED"].includes(state ?? "")) throw new Error("Usage: bun run infra/schedule.ts enabled|disabled");
const region = ["--region", config.region];
const stack = JSON.parse(await aws(["cloudformation", "describe-stacks", ...region, "--stack-name", config.stack, "--output", "json"])).Stacks[0];
const currentState = stack.Parameters.find((p: { ParameterKey: string }) => p.ParameterKey === "ScheduleState")?.ParameterValue;
if (state === "ENABLED" && currentState !== state) {
  const deployedHash = stack.Parameters.find((p: { ParameterKey: string }) => p.ParameterKey === "IndexerHash")?.ParameterValue;
  if (deployedHash !== await indexerHash()) throw new Error("Local indexer code does not match deployed Lambda");
  const ids = JSON.parse(await aws(["codebuild", "list-builds-for-project", ...region, "--project-name", config.projectName, "--sort-order", "DESCENDING", "--output", "json"])).ids.slice(0, 20);
  if (!ids.length) throw new Error("Run authenticated verification builds before enabling");
  const builds = JSON.parse(await aws(["codebuild", "batch-get-builds", ...region, "--ids", ...ids, "--output", "json"])).builds;
  // Pause/resume updates the stack, not the runtime. Require fresh verification
  // after a Lambda deployment without invalidating it on a simple pause.
  const deployedAt = await aws(["lambda", "get-function-configuration", ...region, "--function-name", config.functionName, "--query", "LastModified", "--output", "text"]);
  const successful = builds.filter((build: { buildStatus: string; startTime: string }) => build.buildStatus === "SUCCEEDED" && new Date(build.startTime) >= new Date(deployedAt));
  const mode = (build: { environment: { environmentVariables: { name: string; value: string }[] } }) => build.environment.environmentVariables.find(v => v.name === "REFRESH_MODE")?.value ?? "publish";
  const scheduledProof = successful.some((b: Parameters<typeof mode>[0]) => mode(b) === "publish" && b.environment.environmentVariables.some(v => v.name === "REFRESH_TRIGGER" && Boolean(v.value)));
  if (!successful.some((b: Parameters<typeof mode>[0]) => mode(b) === "verify-write") || successful.filter((b: Parameters<typeof mode>[0]) => mode(b) === "publish").length < 2 || !scheduledProof) {
    throw new Error("Need write verification, two full refresh builds, and a scheduled delivery proof after deployment. Run bun run infra/verify.ts.");
  }
}
if (currentState === state) {
  console.log(`Schedule already ${state}.`);
} else {
  const parameters = stack.Parameters.map((p: { ParameterKey: string }) => p.ParameterKey === "ScheduleState" ? { ParameterKey: p.ParameterKey, ParameterValue: state } : { ParameterKey: p.ParameterKey, UsePreviousValue: true });
  const path = "dist/schedule-parameters.json";
  await Bun.write(path, JSON.stringify(parameters));
  await aws(["cloudformation", "update-stack", ...region, "--stack-name", config.stack, "--use-previous-template", "--capabilities", "CAPABILITY_IAM", "--parameters", `file://${path}`]);
  await aws(["cloudformation", "wait", "stack-update-complete", ...region, "--stack-name", config.stack]);
  console.log(`Schedule ${state}: ${config.scheduleName}, rate(15 minutes).`);
}
