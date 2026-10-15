// Edge City Operational Facts Auditor — Actionable Correction Drafter
// Generates reviewable correction packages for detected discrepancies without declaring unilateral authority.

import type { Discrepancy, CorrectionPackage, CorrectionDraft } from "./types";

export function prepareCorrectionPackage(discrepancy: Discrepancy): CorrectionPackage {
  const affectedDocuments = [...new Set(discrepancy.facts.map((f) => f.sourcePath))];
  const originalSourceUrls = [...new Set(discrepancy.facts.map((f) => f.sourceUrl))];

  const conflictingValues = discrepancy.facts.map((f) => ({
    sourcePath: f.sourcePath,
    value: f.value,
    publishedDate: f.publishedDate,
  }));

  const supportingQuotations = discrepancy.facts.map((f) => ({
    sourcePath: f.sourcePath,
    quote: f.supportingText,
  }));

  const publicationDates: Record<string, string | undefined> = {};
  for (const f of discrepancy.facts) {
    publicationDates[f.sourcePath] = f.publishedDate ?? f.indexedDate;
  }

  // Determine likely outdated source using publication chronology
  const sortedByDate = [...discrepancy.facts].sort((a, b) => {
    const da = a.publishedDate ?? a.indexedDate ?? "";
    const db = b.publishedDate ?? b.indexedDate ?? "";
    return da.localeCompare(db);
  });

  const oldest = sortedByDate[0];
  const newest = sortedByDate[sortedByDate.length - 1];

  let likelySource = oldest ? oldest.sourcePath : affectedDocuments[0]!;
  let expectedAudience = "Attendees referencing official public guides for daily logistics.";
  let severity: "low" | "medium" | "high" = "medium";
  let severityRationale = "Operational discrepancy causes attendee confusion and staff inquiries.";
  const drafts: CorrectionDraft[] = [];

  if (discrepancy.topic === "venue_hours") {
    severity = "medium";
    severityRationale =
      "Conflicting coworking venue hours cause attendees to arrive at locked spaces (e.g., 8:00 AM) or leave prematurely (midnight instead of 1:00 AM).";
    expectedAudience = "Attendees seeking early morning or late night coworking at The Circle.";

    if (discrepancy.subject.includes("the_circle")) {
      likelySource = oldest?.sourcePath ?? "newsletter/a-typical-day-and-week-at-edge-city.md";

      drafts.push({
        optionName: "Option A: Confirm 09:00 to 01:00 (Wiki & Opening Guide schedule)",
        targetDocumentPath: "newsletter/a-typical-day-and-week-at-edge-city.md",
        targetSourceUrl: "https://edgecityindia2026.substack.com/p/a-typical-day-and-week-at-edge-city",
        existingText: "open 8am to midnight with meeting rooms and fast WiFi.",
        proposedReplacementText: "open 9am to 1am with meeting rooms and fast WiFi.",
        rationale:
          "Aligns the earlier September 24 newsletter overview with the October 9 arrival guide and official Notion Wiki.",
      });

      drafts.push({
        optionName: "Option B: Confirm 8am to midnight (Early builder schedule)",
        targetDocumentPath: "wiki-content.md",
        targetSourceUrl: "https://edgecity.notion.site/Edge-City-India-2026-Wiki-038d45cdfc5983c7a1fe013fdc77135b",
        existingText: "The Circle opens at 9am and closes at 1am.",
        proposedReplacementText: "The Circle opens at 8am and closes at midnight.",
        rationale:
          "Updates the Notion Wiki if organizers agreed on earlier 8:00 AM opening for morning workers.",
      });
    }
  } else if (discrepancy.topic === "accommodation") {
    severity = "medium";
    severityRationale =
      "Active booking links for sold-out properties result in failed reservation attempts and support emails to organizers.";
    expectedAudience = "New and incoming attendees arranging accommodation in Mandrem.";

    if (discrepancy.subject.includes("riva")) {
      likelySource = "website-content.md";

      drafts.push({
        optionName: "Option A: Confirm Riva Sold Out (Update Website Landing Page)",
        targetDocumentPath: "website-content.md",
        targetSourceUrl: "https://www.edgecity.live/india26",
        existingText: "[Book at Riva here!](https://forms.fillout.com/t/eGE4xizEwbus)",
        proposedReplacementText:
          "**Riva Beach Resort is now sold out.** [Find alternative options in our Community Housing Sheet](https://docs.google.com/spreadsheets/d/1U0iLx54TBN7tjhXvhnvnE893EllAfC-fMRxakObB4F0/edit?gid=721593883#gid=721593883)",
        rationale:
          "Stops attendees from filling out a booking form for rooms that are no longer available, aligning with Wiki announcement.",
      });

      drafts.push({
        optionName: "Option B: Confirm Additional Rooms Released (Update Wiki)",
        targetDocumentPath: "wiki-content.md",
        targetSourceUrl: "https://edgecity.notion.site/Edge-City-India-2026-Wiki-038d45cdfc5983c7a1fe013fdc77135b",
        existingText: "Riva Beach Resort is now sold out.",
        proposedReplacementText: "Riva Beach Resort: limited additional rooms available via the official booking link.",
        rationale:
          "Updates the Wiki if hotel management released an additional room block.",
      });
    }
  } else if (discrepancy.topic === "meal_plan") {
    severity = "high";
    severityRationale =
      "Conflicting order deadlines risk attendees missing kitchen preparation windows or attempting to place orders after kitchen cutoffs.";
    expectedAudience = "Attendees ordering weekday lunch plans.";

    drafts.push({
      optionName: "Option A: Align all sources with authorized kitchen cutoff",
      targetDocumentPath: likelySource,
      targetSourceUrl: oldest?.sourceUrl ?? originalSourceUrls[0]!,
      existingText: oldest?.supportingText ?? "",
      proposedReplacementText: `[DRAFT PROPOSAL]: Update deadline to match confirmed kitchen cutoff: ${newest?.value ?? ""}`,
      rationale: "Ensures attendees and kitchens share the exact same order deadline.",
    });
  } else {
    drafts.push({
      optionName: "Option A: Align earlier document with latest notice",
      targetDocumentPath: likelySource,
      targetSourceUrl: oldest?.sourceUrl ?? originalSourceUrls[0]!,
      existingText: oldest?.supportingText ?? "",
      proposedReplacementText: `[DRAFT PROPOSAL]: Update to reflect confirmed policy: ${newest?.value ?? ""}`,
      rationale: "Harmonizes conflicting documentation across official sources.",
    });
  }

  const suggestedReplacement = drafts
    .map(
      (d) =>
        `### ${d.optionName}\nTarget: \`${d.targetDocumentPath}\`\n- **Existing:** "${d.existingText}"\n- **Proposed:** "${d.proposedReplacementText}"\n*Rationale:* ${d.rationale}`
    )
    .join("\n\n");

  return {
    exactIssue: discrepancy.description,
    affectedDocuments,
    originalSourceUrls,
    conflictingValues,
    supportingQuotations,
    publicationDates,
    likelySourceRequiringCorrection: likelySource,
    suggestedReplacementWording: suggestedReplacement,
    drafts,
    organizerConfirmationRequired: discrepancy.suggestedQuestion,
    expectedAffectedAudience: expectedAudience,
    severity,
    severityRationale,
  };
}
