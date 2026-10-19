// Edge City Operational Facts Auditor — Maintenance State Ledger
// Manages incremental finding lifecycles, issue deduplication, and resolution verification across runs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareCorrectionPackage } from "./correction-drafter";
import type {
  Discrepancy,
  MaintenanceState,
  TrackedMaintenanceIssue,
  MaintenanceReport,
  WorkflowStatus,
  LifecycleChange,
} from "./types";

export function computeStableId(topic: string, subject: string): string {
  return `${topic}:${subject}`;
}

export function loadMaintenanceState(statePath: string): MaintenanceState {
  if (existsSync(statePath)) {
    try {
      const data = JSON.parse(readFileSync(statePath, "utf8")) as MaintenanceState;
      if (data && data.version === 1 && typeof data.issues === "object") {
        return data;
      }
    } catch {
      // Fallback on malformed or unreadable file
    }
  }
  return {
    version: 1,
    lastRun: new Date().toISOString(),
    runCount: 0,
    issues: {},
  };
}

export function saveMaintenanceState(statePath: string, state: MaintenanceState): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export interface SyncOptions {
  statePath?: string;
  now?: string;
  persist?: boolean;
  state?: MaintenanceState;
}

export function syncMaintenanceWorkflow(
  discrepancies: Discrepancy[],
  documentCount: number,
  options: SyncOptions = {}
): { state: MaintenanceState; report: MaintenanceReport } {
  const statePath = options.statePath ?? join(process.cwd(), ".maintenance-state.json");
  const now = options.now ?? new Date().toISOString();
  const state =
    options.state != null
      ? structuredClone(options.state)
      : options.persist === false && !options.statePath
      ? { version: 1 as const, lastRun: now, runCount: 0, issues: {} }
      : loadMaintenanceState(statePath);

  state.runCount += 1;
  state.lastRun = now;

  const currentStableIds = new Set<string>();
  const activeIssues: TrackedMaintenanceIssue[] = [];
  const resolvedIssues: TrackedMaintenanceIssue[] = [];

  let newCount = 0;
  let existingUnresolvedCount = 0;
  let updatedCount = 0;
  let verifiedResolvedCount = 0;
  let reopenedCount = 0;

  for (const discrepancy of discrepancies) {
    const stableId = computeStableId(discrepancy.topic, discrepancy.subject);
    currentStableIds.add(stableId);

    const existing = state.issues[stableId];
    const correctionPackage = prepareCorrectionPackage(discrepancy);

    if (!existing) {
      // 1. Newly detected issue
      const newIssue: TrackedMaintenanceIssue = {
        stableId,
        topic: discrepancy.topic,
        subject: discrepancy.subject,
        status: "Correction prepared",
        lifecycle: "NEW",
        firstDetected: now,
        lastSeen: now,
        runCount: 1,
        discrepancy,
        correctionPackage,
        history: [{ timestamp: now, event: "NEW", detail: "Initially detected in public references" }],
      };
      state.issues[stableId] = newIssue;
      activeIssues.push(newIssue);
      newCount++;
    } else {
      // Check if previously resolved or dismissed
      const wasResolved = existing.status === "Verified resolved" || existing.status === "Dismissed";

      if (wasResolved) {
        // Reopened issue!
        existing.status = "Needs verification";
        existing.lifecycle = "REOPENED";
        existing.lastSeen = now;
        existing.runCount += 1;
        existing.discrepancy = discrepancy;
        existing.correctionPackage = correctionPackage;
        existing.history.push({
          timestamp: now,
          event: "REOPENED",
          detail: "Reappeared after being previously marked resolved",
        });
        activeIssues.push(existing);
        reopenedCount++;
      } else {
        // Check for updates to evidence or claims
        const priorValues = existing.discrepancy.facts.map((f) => f.value).sort().join("|");
        const currentValues = discrepancy.facts.map((f) => f.value).sort().join("|");
        const isUpdated = priorValues !== currentValues;

        existing.lastSeen = now;
        existing.runCount += 1;
        existing.discrepancy = discrepancy;
        existing.correctionPackage = correctionPackage;

        if (isUpdated) {
          existing.lifecycle = "UPDATED";
          existing.history.push({
            timestamp: now,
            event: "UPDATED",
            detail: "Conflicting claims or source documents changed",
          });
          updatedCount++;
        } else {
          existing.lifecycle = "EXISTING_UNRESOLVED";
          existingUnresolvedCount++;
        }
        activeIssues.push(existing);
      }
    }
  }

  // Check for issues that were previously open but have disappeared -> VERIFIED RESOLVED!
  for (const [stableId, tracked] of Object.entries(state.issues)) {
    if (currentStableIds.has(stableId)) continue;

    if (tracked.status !== "Verified resolved" && tracked.status !== "Dismissed") {
      tracked.status = "Verified resolved";
      tracked.lifecycle = "VERIFIED_RESOLVED";
      tracked.resolutionEvidence = {
        resolvedAt: now,
        priorConflictingValues: tracked.discrepancy.facts.map((f) => `${f.sourcePath}: ${f.value}`),
        verifiedAgainstDocCount: documentCount,
      };
      tracked.history.push({
        timestamp: now,
        event: "VERIFIED_RESOLVED",
        detail: `Verified resolved: conflict absent across ${documentCount} validated documents`,
      });
      verifiedResolvedCount++;
      resolvedIssues.push(tracked);
    } else if (tracked.status === "Verified resolved") {
      resolvedIssues.push(tracked);
    }
  }

  if (options.persist !== false) {
    saveMaintenanceState(statePath, state);
  }

  const report: MaintenanceReport = {
    generatedAt: now,
    event: "Edge City India 2026",
    timezone: "Asia/Kolkata",
    documentCount,
    activeIssues,
    resolvedIssues,
    summary: {
      newCount,
      existingUnresolvedCount,
      updatedCount,
      verifiedResolvedCount,
      reopenedCount,
      totalActive: activeIssues.length,
      cleanScan: activeIssues.length === 0,
    },
  };

  return { state, report };
}

export function updateIssueStatus(
  statePath: string,
  stableId: string,
  newStatus: WorkflowStatus,
  note?: string
): TrackedMaintenanceIssue {
  const state = loadMaintenanceState(statePath);
  const issue = state.issues[stableId];
  if (!issue) {
    throw new Error(`Issue not found in maintenance state: ${stableId}`);
  }

  issue.status = newStatus;
  issue.history.push({
    timestamp: new Date().toISOString(),
    event: newStatus,
    detail: note,
  });

  saveMaintenanceState(statePath, state);
  return issue;
}
