// Edge City Operational Facts Auditor — Reporter
// Deterministically formats audit findings and maintenance workflow states into Markdown and JSON reports.

import type { AuditReport, Discrepancy, MaintenanceReport, TrackedMaintenanceIssue } from "./types";

export function formatMarkdownReport(report: AuditReport): string {
  const lines: string[] = [];

  lines.push("# Edge City India 2026 — Operational Facts Audit Report\n");
  lines.push(
    `Audited **${report.documentCount}** documents across Edge City India public sources (Wiki, Website, Substack newsletters).`
  );
  lines.push(`Timezone: \`${report.timezone}\` | Extracted facts: **${report.factsExtracted}**\n`);

  lines.push("## Summary\n");
  lines.push("| Metric | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Total Discrepancies | ${report.summary.totalDiscrepancies} |`);
  lines.push(`| Confirmed Inconsistencies | ${report.summary.confirmedCount} |`);
  lines.push(`| Superseded State / Stale Listings | ${report.summary.supersededCount} |`);
  lines.push(`| Possible Inconsistencies | ${report.summary.possibleCount} |`);
  lines.push(`| Date-Specific Exceptions | ${report.summary.exceptionCount} |`);
  lines.push(`| Clean Scan | ${report.summary.cleanScan ? "YES" : "NO"} |\n`);

  if (report.findings.length === 0) {
    lines.push("## Result: Clean Scan\n");
    lines.push(
      "No operational fact contradictions or discrepancies were detected across the audited reference snapshot. All deadlines, hours, shuttle arrangements, and attendee instructions are consistent.\n"
    );
    return lines.join("\n");
  }

  lines.push("## Findings\n");

  report.findings.forEach((finding: Discrepancy, index: number) => {
    lines.push(`### ${index + 1}. ${finding.description}\n`);
    lines.push(`- **Topic:** \`${finding.topic}\``);
    lines.push(`- **Subject:** \`${finding.subject}\``);
    lines.push(`- **Classification:** \`${finding.classification}\``);
    lines.push(`- **Status:** \`${finding.status}\`\n`);

    lines.push("#### Conflicting / Divergent Claims:\n");
    finding.facts.forEach((fact, fIdx) => {
      lines.push(`**Claim ${String.fromCharCode(65 + fIdx)}:**`);
      lines.push(`- **Stated Value:** \`${fact.value}\``);
      lines.push(`- **Source Document:** [\`${fact.sourcePath}\`](${fact.sourceUrl})`);
      if (fact.publishedDate) lines.push(`- **Published:** \`${fact.publishedDate}\``);
      if (fact.indexedDate) lines.push(`- **Last Indexed:** \`${fact.indexedDate}\``);
      lines.push(`- **Supporting Evidence:** > "${fact.supportingText}"\n`);
    });

    lines.push("#### Why Inconsistent:");
    lines.push(`${finding.whyInconsistent}\n`);

    lines.push("#### Suggested Organizer Verification Question:");
    lines.push(`> "${finding.suggestedQuestion}"\n`);

    lines.push("#### Proposed Correction Location:");
    lines.push(`\`${finding.proposedCorrectionLocation}\`\n`);

    lines.push("---\n");
  });

  lines.push("## Verification Safeguards\n");
  lines.push("- **Read-Only:** This audit inspected existing public references without modifying files or external sources.");
  lines.push("- **Deterministic:** Generated from verifiable document text and temporal metadata without paid API calls.");
  lines.push("- **Organizer Confirmation Required:** Do not modify live operations or attendee instructions without explicit organizer review.\n");

  return lines.join("\n");
}

export function formatJsonReport(report: AuditReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}

export function formatMaintenanceMarkdownReport(report: MaintenanceReport): string {
  const lines: string[] = [];

  lines.push("# Edge City India 2026 — Operational Maintenance Queue\n");
  lines.push(
    `Audited **${report.documentCount}** verified public documents. Active maintenance issues: **${report.summary.totalActive}**.\n`
  );

  lines.push("## Workflow Status Summary\n");
  lines.push("| State Category | Count | Meaning |");
  lines.push("| --- | --- | --- |");
  lines.push(`| **NEW** | ${report.summary.newCount} | Newly detected; requires first review |`);
  lines.push(`| **EXISTING_UNRESOLVED** | ${report.summary.existingUnresolvedCount} | Already tracked; duplicate alert avoided |`);
  lines.push(`| **UPDATED** | ${report.summary.updatedCount} | Document claims or evidence modified |`);
  lines.push(`| **REOPENED** | ${report.summary.reopenedCount} | Reappeared after prior resolution |`);
  lines.push(`| **VERIFIED_RESOLVED** | ${report.summary.verifiedResolvedCount} | Conflict confirmed absent in updated references |`);
  lines.push(`| **TOTAL ACTIVE** | ${report.summary.totalActive} | Total pending issues |\n`);

  if (report.activeIssues.length === 0) {
    lines.push("## Queue Status: All Issues Resolved\n");
    lines.push("All operational information across public references is currently consistent. No active correction packages are pending review.\n");
  } else {
    lines.push("## Active Correction Packages\n");

    report.activeIssues.forEach((issue: TrackedMaintenanceIssue, idx: number) => {
      const pkg = issue.correctionPackage;
      lines.push(`### ${idx + 1}. [${issue.lifecycle}] ${issue.discrepancy.description}\n`);
      lines.push(`- **Stable Issue ID:** \`${issue.stableId}\``);
      lines.push(`- **Workflow Status:** \`${issue.status}\``);
      lines.push(`- **Lifecycle State:** \`${issue.lifecycle}\` (Observed across ${issue.runCount} audit runs)`);
      lines.push(`- **Severity:** \`${pkg.severity.toUpperCase()}\` — *${pkg.severityRationale}*`);
      lines.push(`- **Affected Audience:** ${pkg.expectedAffectedAudience}\n`);

      lines.push("#### Conflicting Documentation Claims:\n");
      pkg.conflictingValues.forEach((claim, cIdx) => {
        lines.push(`**Source ${String.fromCharCode(65 + cIdx)}:** \`${claim.sourcePath}\``);
        lines.push(`- **Stated Value:** \`${claim.value}\``);
        if (claim.publishedDate) lines.push(`- **Published:** \`${claim.publishedDate}\``);
        const quote = pkg.supportingQuotations.find((q) => q.sourcePath === claim.sourcePath)?.quote;
        if (quote) lines.push(`- **Quoted Text:** > "${quote}"\n`);
      });

      lines.push("#### Organizer Decision Needed:");
      lines.push(`> "${pkg.organizerConfirmationRequired}"\n`);

      lines.push("#### Actionable Correction Proposals:\n");
      pkg.drafts.forEach((draft, dIdx) => {
        lines.push(`**${draft.optionName}**`);
        lines.push(`- **Target Document:** [\`${draft.targetDocumentPath}\`](${draft.targetSourceUrl})`);
        lines.push(`- **Existing Text:** \`${draft.existingText}\``);
        lines.push(`- **Proposed Draft:** \`${draft.proposedReplacementText}\``);
        lines.push(`- **Rationale:** ${draft.rationale}\n`);
      });

      lines.push("---\n");
    });
  }

  if (report.resolvedIssues.length > 0) {
    lines.push("## Recently Verified Resolved Issues\n");
    report.resolvedIssues.forEach((res) => {
      lines.push(`- **${res.discrepancy.description}** (\`${res.stableId}\`)`);
      if (res.resolutionEvidence) {
        lines.push(`  - *Verified Resolved At:* \`${res.resolutionEvidence.resolvedAt}\``);
        lines.push(
          `  - *Resolution Evidence:* Confirmed absent across ${res.resolutionEvidence.verifiedAgainstDocCount} documents.`
        );
        lines.push(`  - *Prior Conflicting Claims:* ${res.resolutionEvidence.priorConflictingValues.join(" vs ")}`);
      }
    });
    lines.push("");
  }

  lines.push("## Maintainer Next Steps\n");
  lines.push("1. Review the proposed draft correction above.");
  lines.push("2. Confirm the intended operational policy with the responsible event organizer.");
  lines.push("3. Apply the correction to the official Notion, Substack, or Webflow source.");
  lines.push("4. Rerun `bun run audit:ops` after index refresh to verify that the issue transitions to `VERIFIED_RESOLVED`.\n");

  return lines.join("\n");
}

export function formatMaintenanceJsonReport(report: MaintenanceReport): string {
  return JSON.stringify(report, null, 2) + "\n";
}
