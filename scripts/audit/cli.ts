#!/usr/bin/env bun
// Edge City Operational Facts Auditor & Maintenance Workflow — CLI
// Usage:
//   bun run audit:ops [options]
//   bun run audit:ops --mark <id> <status>

import { writeFileSync } from "node:fs";
import { runOperationalAudit, runOperationalMaintenanceWorkflow } from "./index";
import { updateIssueStatus } from "./state";
import {
  formatMarkdownReport,
  formatJsonReport,
  formatMaintenanceMarkdownReport,
  formatMaintenanceJsonReport,
} from "./reporter";
import type { WorkflowStatus } from "./types";

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Edge City Operational Facts Auditor & Maintenance Workflow
Usage:
  bun run audit:ops [options]

Workflow Options:
  --audit-only     Run raw audit without updating maintenance state ledger
  --state <path>   Path to maintenance state file (default: .maintenance-state.json)
  --benchmark      Run reproducible evaluation of manual effort vs automated workflow
  --json           Format output as machine-readable JSON
  --out <path>     Write report to the specified file path
  --strict         Exit with code 1 if confirmed discrepancies are active
  --mark <id> <s>  Update status of a tracked issue (e.g., "Confirmed", "Awaiting authorized publication")
  --help, -h       Show this help message
`);
    process.exit(0);
  }

  if (args.includes("--benchmark")) {
    const { runEffortBenchmark } = require("./benchmark");
    const result = runEffortBenchmark();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const isJson = args.includes("--json");
  const isStrict = args.includes("--strict");
  const isAuditOnly = args.includes("--audit-only");

  const outIdx = args.indexOf("--out");
  const outputPath = outIdx !== -1 && args[outIdx + 1] ? args[outIdx + 1] : undefined;

  const stateIdx = args.indexOf("--state");
  const statePath = stateIdx !== -1 && args[stateIdx + 1] ? args[stateIdx + 1] : undefined;

  const markIdx = args.indexOf("--mark");
  if (markIdx !== -1 && args[markIdx + 1] && args[markIdx + 2]) {
    const id = args[markIdx + 1]!;
    const status = args[markIdx + 2]! as WorkflowStatus;
    try {
      const updated = updateIssueStatus(statePath ?? ".maintenance-state.json", id, status);
      console.log(`Updated issue ${updated.stableId} -> "${updated.status}"`);
      process.exit(0);
    } catch (err) {
      console.error("Failed to update status:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  try {
    if (isAuditOnly) {
      const report = runOperationalAudit();
      const formatted = isJson ? formatJsonReport(report) : formatMarkdownReport(report);
      if (outputPath) {
        writeFileSync(outputPath, formatted, "utf8");
        console.log(`Audit report written to ${outputPath}`);
      } else {
        console.log(formatted);
      }
      if (isStrict && report.summary.confirmedCount > 0) {
        process.exit(1);
      }
    } else {
      const { maintenanceReport } = runOperationalMaintenanceWorkflow({
        statePath,
        persistState: true,
      });

      const formatted = isJson
        ? formatMaintenanceJsonReport(maintenanceReport)
        : formatMaintenanceMarkdownReport(maintenanceReport);

      if (outputPath) {
        writeFileSync(outputPath, formatted, "utf8");
        console.log(`Maintenance report written to ${outputPath}`);
      } else {
        console.log(formatted);
      }

      if (isStrict && maintenanceReport.summary.totalActive > 0) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error("Workflow failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
