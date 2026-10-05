import { refreshSnapshot } from "../scripts/lambda-handler";

const runtime = process.env.AWS_LAMBDA_RUNTIME_API;
if (!runtime) throw new Error("This entrypoint must run in AWS Lambda");
const base = `http://${runtime}/2018-06-01/runtime`;
while (true) {
  const next = await fetch(`${base}/invocation/next`);
  if (!next.ok) throw new Error("Lambda Runtime API request failed");
  const id = next.headers.get("lambda-runtime-aws-request-id");
  if (!id) throw new Error("Missing Lambda invocation ID");
  let suffix = "response";
  let result: unknown;
  try {
    result = await refreshSnapshot(await next.json());
  } catch (error) {
    suffix = "error";
    result = { errorType: "PublicIndexerError", errorMessage: error instanceof Error ? error.message : "Public indexer failed" };
    console.error(JSON.stringify(result));
  }
  const response = await fetch(`${base}/invocation/${encodeURIComponent(id)}/${suffix}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error("Lambda Runtime API response failed");
}
