import { collectDocuments } from "./index";
import { buildReferenceFiles } from "./publish";
import { decodeSnapshot, MAX_PAYLOAD_BYTES, snapshotDigest, validateSnapshot } from "./reference-state";

export async function refreshSnapshot(input: unknown, options: {
  expectedHash?: string;
  collect?: typeof collectDocuments;
  now?: string;
} = {}) {
  const request = input as { protocol?: number; indexerHash?: string; previous?: unknown; baselineDigest?: string } | null;
  const expectedHash = options.expectedHash ?? process.env.INDEXER_CODE_HASH;
  if (!request || request.protocol !== 1 || !expectedHash || request.indexerHash !== expectedHash) throw new Error("Indexer deployment does not match repository code; redeploy before refreshing");
  const previous = decodeSnapshot(request.previous);
  if (request.baselineDigest !== snapshotDigest(previous)) throw new Error("Baseline digest mismatch");
  const documents = await (options.collect ?? collectDocuments)();
  const files = buildReferenceFiles(documents, previous, options.now);
  const summary = validateSnapshot(files);
  const response = {
    protocol: 1, indexerHash: expectedHash, baselineDigest: request.baselineDigest,
    files: [...files], changed: snapshotDigest(files) !== request.baselineDigest,
    ...summary,
  };
  if (Buffer.byteLength(JSON.stringify(response)) > MAX_PAYLOAD_BYTES) throw new Error("Generated result exceeds synchronous Lambda payload limit; no publication");
  console.log(JSON.stringify({ event: "refresh-generated", documents: summary.documents, changed: response.changed, digest: summary.digest }));
  return response;
}
