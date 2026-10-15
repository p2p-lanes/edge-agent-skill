// Edge City Operational Facts Auditor & Maintenance Workflow — Type Definitions

export type OperationalTopic =
  | "check_in"
  | "shuttle"
  | "meal_plan"
  | "venue_hours"
  | "accommodation"
  | "deadline"
  | "attendee_instructions";

export type ConflictClassification =
  | "confirmed_inconsistency"
  | "possible_inconsistency"
  | "superseded_state"
  | "date_specific_exception";

export type ConflictStatus = "unverified" | "confirmed" | "resolved" | "dismissed";

// Maintenance Workflow Statuses (Prompt Section 3.C)
export type WorkflowStatus =
  | "Detected"
  | "Needs verification"
  | "Confirmed"
  | "Correction prepared"
  | "Awaiting authorized publication"
  | "Published"
  | "Verified resolved"
  | "Dismissed";

// Incremental Lifecycle Transitions (Prompt Section 3.E)
export type LifecycleChange =
  | "NEW"
  | "EXISTING_UNRESOLVED"
  | "UPDATED"
  | "VERIFIED_RESOLVED"
  | "REOPENED";

export interface DateScope {
  specificDate?: string; // YYYY-MM-DD
  startDate?: string;
  endDate?: string;
  recurrence?: "weekdays" | "weekends" | "daily" | "specific_day";
  dayOfWeek?: string;
}

export interface OperationalFact {
  id: string;
  topic: OperationalTopic;
  subject: string;
  value: string;
  normalizedValue?: string;
  effectiveScope?: DateScope;
  locationOrEvent?: string;
  sourceUrl: string;
  sourcePath: string;
  sourceKind: "wiki" | "newsletter" | "website";
  publishedDate?: string;
  indexedDate?: string;
  supportingText: string;
  sectionTitle?: string;
}

export interface Discrepancy {
  id: string;
  topic: OperationalTopic;
  subject: string;
  description: string;
  classification: ConflictClassification;
  facts: OperationalFact[];
  whyInconsistent: string;
  suggestedQuestion: string;
  proposedCorrectionLocation: string;
  status: ConflictStatus;
}

export interface CorrectionDraft {
  optionName: string;
  targetDocumentPath: string;
  targetSourceUrl: string;
  existingText: string;
  proposedReplacementText: string;
  rationale: string;
}

export interface CorrectionPackage {
  exactIssue: string;
  affectedDocuments: string[];
  originalSourceUrls: string[];
  conflictingValues: Array<{
    sourcePath: string;
    value: string;
    publishedDate?: string;
  }>;
  supportingQuotations: Array<{
    sourcePath: string;
    quote: string;
  }>;
  publicationDates: Record<string, string | undefined>;
  likelySourceRequiringCorrection: string;
  suggestedReplacementWording: string;
  drafts: CorrectionDraft[];
  organizerConfirmationRequired: string;
  expectedAffectedAudience: string;
  severity: "low" | "medium" | "high";
  severityRationale: string;
}

export interface TrackedMaintenanceIssue {
  stableId: string;
  topic: OperationalTopic;
  subject: string;
  status: WorkflowStatus;
  lifecycle: LifecycleChange;
  firstDetected: string;
  lastSeen: string;
  runCount: number;
  discrepancy: Discrepancy;
  correctionPackage: CorrectionPackage;
  history: Array<{
    timestamp: string;
    event: LifecycleChange | WorkflowStatus;
    detail?: string;
  }>;
  resolutionEvidence?: {
    resolvedAt: string;
    priorConflictingValues: string[];
    verifiedAgainstDocCount: number;
  };
}

export interface MaintenanceState {
  version: 1;
  lastRun: string;
  runCount: number;
  issues: Record<string, TrackedMaintenanceIssue>;
}

export interface MaintenanceReport {
  generatedAt: string;
  event: string;
  timezone: string;
  documentCount: number;
  activeIssues: TrackedMaintenanceIssue[];
  resolvedIssues: TrackedMaintenanceIssue[];
  summary: {
    newCount: number;
    existingUnresolvedCount: number;
    updatedCount: number;
    verifiedResolvedCount: number;
    reopenedCount: number;
    totalActive: number;
    cleanScan: boolean;
  };
}

export interface AuditReport {
  generatedAt: string;
  event: string;
  timezone: string;
  documentCount: number;
  factsExtracted: number;
  findings: Discrepancy[];
  summary: {
    totalDiscrepancies: number;
    confirmedCount: number;
    possibleCount: number;
    supersededCount: number;
    exceptionCount: number;
    cleanScan: boolean;
  };
}

export interface AuditOptions {
  strict?: boolean;
  format?: "markdown" | "json";
  outputPath?: string;
  quiet?: boolean;
  statePath?: string;
  showCorrections?: boolean;
}
