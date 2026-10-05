import config from "./config.json";
import { aws } from "./aws";
const region = ["--region", config.region];

async function build(id: string) {
  return JSON.parse(await aws(["codebuild", "batch-get-builds", ...region, "--ids", id, "--output", "json"])).builds[0];
}
async function wait(id: string) {
  for (let i = 0; i < 240; i++) {
    const result = await build(id);
    if (result.buildStatus === "SUCCEEDED") {
      console.log(JSON.stringify({ event: "verification-passed", id, initiator: result.initiator }));
      return result;
    }
    if (result.buildStatus !== "IN_PROGRESS") throw new Error(`Verification failed: ${id}. Inspect its CodeBuild logs; rate schedule remains disabled.`);
    await Bun.sleep(5000);
  }
  throw new Error(`Timed out waiting for ${id}`);
}
async function start(mode: string) {
  const result = JSON.parse(await aws(["codebuild", "start-build", ...region, "--project-name", config.projectName,
    "--environment-variables-override", `name=REFRESH_MODE,value=${mode},type=PLAINTEXT`, "--output", "json"]));
  return wait(result.build.id);
}

export async function verify() {
  const schedule = JSON.parse(await aws(["scheduler", "get-schedule", ...region, "--group-name", config.scheduleGroup, "--name", config.scheduleName, "--output", "json"]));
  if (schedule.State !== "DISABLED") throw new Error("Pause the rate schedule before running activation verification");
  await start("verify-write");
  await start("publish");
  // Verify real scheduled delivery as the second full refresh, not just StartBuild calls from the CLI.
  const nonce = crypto.randomUUID();
  const name = `edge-india-proof-${Date.now()}`;
  const date = new Date(Date.now() + 90000).toISOString().slice(0, 19);
  const target = { ...schedule.Target, Input: JSON.stringify({ projectName: config.projectName,
    environmentVariablesOverride: [{ name: "REFRESH_TRIGGER", value: nonce, type: "PLAINTEXT" }] }) };
  await Bun.write("dist/proof-target.json", JSON.stringify(target));
  await aws(["scheduler", "create-schedule", ...region, "--group-name", config.scheduleGroup, "--name", name,
    "--schedule-expression", `at(${date})`, "--schedule-expression-timezone", "UTC", "--flexible-time-window", '{"Mode":"OFF"}',
    "--state", "ENABLED", "--action-after-completion", "DELETE", "--target", "file://dist/proof-target.json"]);
  console.log(JSON.stringify({ event: "scheduled-proof-created", name, dateUTC: date }));
  try {
    for (let i = 0; i < 150; i++) {
      const ids = JSON.parse(await aws(["codebuild", "list-builds-for-project", ...region, "--project-name", config.projectName, "--sort-order", "DESCENDING", "--output", "json"])).ids.slice(0, 10);
      const rows = ids.length ? JSON.parse(await aws(["codebuild", "batch-get-builds", ...region, "--ids", ...ids, "--output", "json"])).builds : [];
      const scheduled = rows.find((row: { environment: { environmentVariables: { name: string; value: string }[] } }) => row.environment.environmentVariables.some(v => v.name === "REFRESH_TRIGGER" && v.value === nonce));
      if (scheduled) {
        const result = await wait(scheduled.id);
        await Bun.write("dist/scheduled-proof.json", JSON.stringify({ id: result.id, initiator: result.initiator, startTime: result.startTime, status: result.buildStatus }, null, 2));
        console.log("Authenticated write, full refresh, and genuine scheduled refresh all passed. Run aws:enable.");
        return;
      }
      await Bun.sleep(5000);
    }
    throw new Error("Scheduler did not start the proof build. Inspect the delivery DLQ and scheduler metrics; do not enable the rate schedule.");
  } finally {
    // ActionAfterCompletion deletes the one-time resource. Clean up on errors too.
    try { await aws(["scheduler", "delete-schedule", ...region, "--group-name", config.scheduleGroup, "--name", name]); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("ResourceNotFoundException")) throw error; }
  }
}
if (import.meta.main) await verify();
