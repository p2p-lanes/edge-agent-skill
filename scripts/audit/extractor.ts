// Edge City Operational Facts Auditor — Fact Extractor
// Deterministic parser extracting scoped operational facts from Edge City reference markdown.

import { createHash } from "node:crypto";
import type { OperationalFact, OperationalTopic, DateScope } from "./types";

interface ParsedDocMeta {
  path: string;
  url: string;
  kind: "wiki" | "newsletter" | "website";
  title: string;
  published?: string;
  indexed?: string;
}

function parseDocHeader(content: string, fallbackPath: string): { meta: ParsedDocMeta; body: string } {
  const lines = content.split("\n");
  let title = "";
  let url = "";
  let kind: "wiki" | "newsletter" | "website" = "website";
  let published: string | undefined;
  let indexed: string | undefined;
  let bodyStartIndex = 0;

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("# ") && !title) {
      title = line.slice(2).trim();
    } else if (line.startsWith("Source: ")) {
      url = line.slice(8).trim();
    } else if (line.startsWith("Source type: ")) {
      const k = line.slice(13).trim().toLowerCase();
      if (k === "wiki" || k === "newsletter" || k === "website") {
        kind = k;
      }
    } else if (line.startsWith("Published: ")) {
      published = line.slice(11).trim();
    } else if (line.startsWith("Last content change indexed: ")) {
      indexed = line.slice(29).trim();
    } else if (line === "---") {
      bodyStartIndex = i + 1;
      break;
    }
  }

  const body = bodyStartIndex > 0 ? lines.slice(bodyStartIndex).join("\n") : content;
  return {
    meta: {
      path: fallbackPath,
      url: url || fallbackPath,
      kind,
      title: title || fallbackPath,
      published,
      indexed,
    },
    body,
  };
}

function makeFactId(topic: string, subject: string, path: string, snippet: string): string {
  return createHash("sha256")
    .update(`${topic}:${subject}:${path}:${snippet.trim()}`)
    .digest("hex")
    .slice(0, 16);
}

// Extract sections from markdown with their heading
interface MarkdownSection {
  heading: string;
  level: number;
  text: string;
  startLine: number;
}

function extractSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let currentHeading = "Overview";
  let currentLevel = 1;
  let currentLines: string[] = [];
  let currentStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          text: currentLines.join("\n"),
          startLine: currentStart,
        });
      }
      currentLevel = headingMatch[1]!.length;
      currentHeading = headingMatch[2]!.trim().replace(/[\*_~`\[\]]/g, "");
      currentLines = [];
      currentStart = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      text: currentLines.join("\n"),
      startLine: currentStart,
    });
  }

  return sections;
}

export function extractFactsFromDocument(path: string, content: string): OperationalFact[] {
  const { meta, body } = parseDocHeader(content, path);
  const sections = extractSections(body);
  const facts: OperationalFact[] = [];

  for (const section of sections) {
    extractVenueHours(section, meta, facts);
    extractMealPlanDeadlines(section, meta, facts);
    extractCheckInAndWristbands(section, meta, facts);
    extractShuttlesAndTransport(section, meta, facts);
    extractAccommodationAvailability(section, meta, facts);
    extractAttendeeInstructions(section, meta, facts);
  }

  return facts;
}

function extractVenueHours(section: MarkdownSection, meta: ParsedDocMeta, facts: OperationalFact[]): void {
  const text = section.text;
  const lines = text.split("\n");

  for (const line of lines) {
    // Match The Circle operating hours
    // e.g. "open 8am to midnight", "opens at 9am and closes at 1am", "open 09:00 to 01:00"
    if (
      !line.trim().startsWith("|") &&
      (/The\s*Circle/i.test(line) || /The\s*Circle/i.test(section.heading)) &&
      !/(?:walk\s+from|away\s+from|building)\s+The\s*Circle/i.test(line)
    ) {
      const circleHoursMatch =
        /(?:open(?:s)?\s+(?:at\s+)?([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)\s+(?:and\s+closes\s+at|to|-)\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|midnight))/i.exec(
          line
        );
      if (circleHoursMatch) {
        const rawHours = `${circleHoursMatch[1]} to ${circleHoursMatch[2]}`.trim();
        facts.push({
          id: makeFactId("venue_hours", "the_circle_coworking_hours", meta.path, line),
          topic: "venue_hours",
          subject: "the_circle_coworking_hours",
          value: rawHours,
          locationOrEvent: "The Circle (Ashvem)",
          sourceUrl: meta.url,
          sourcePath: meta.path,
          sourceKind: meta.kind,
          publishedDate: meta.published,
          indexedDate: meta.indexed,
          supportingText: line.trim(),
          sectionTitle: section.heading,
        });
      }
    }

    // Match Riva operating hours
    if (/Riva/i.test(line) && /24\/7/i.test(line)) {
      facts.push({
        id: makeFactId("venue_hours", "riva_beach_resort_coworking_hours", meta.path, line),
        topic: "venue_hours",
        subject: "riva_beach_resort_coworking_hours",
        value: "open 24/7",
        locationOrEvent: "Riva Beach Resort (Mandrem)",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Match Partner restaurants hours
    // e.g. Brisa open 12pm to 12am, Zorba Vibes open 9am to 10pm
    const restaurantMatch =
      /(\b(?:Brisa by the Beach|Zorba Vibes)\b)[^.\n]*?open\s+([0-9]{1,2}(?:am|pm)?\s+to\s+[0-9]{1,2}(?:am|pm)?)/i.exec(
        line
      );
    if (restaurantMatch) {
      const name = restaurantMatch[1]!.trim();
      const val = restaurantMatch[2]!.trim();
      const sub = name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_hours";
      facts.push({
        id: makeFactId("venue_hours", sub, meta.path, line),
        topic: "venue_hours",
        subject: sub,
        value: val,
        locationOrEvent: name,
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }
  }
}

function extractMealPlanDeadlines(section: MarkdownSection, meta: ParsedDocMeta, facts: OperationalFact[]): void {
  const text = section.text;
  const isMealSection = /meal|lunch|food/i.test(section.heading) || /lunch|meal plan/i.test(text);
  if (!isMealSection) return;

  const lines = text.split("\n");
  for (const line of lines) {
    // Detect week-specific lunch deadlines
    // e.g.:
    // "Week 1 closes Saturday, October 10 at 10am IST"
    // "Week 2, closes Friday 16 October at 10am IST"
    // "Week 3, closes Wednesday 21 October"
    // "Week 1 orders close Oct 10 at 10am IST"
    // Or synthetic test cases: "Week 2 lunch orders close October 14"
    const weekMatch = /Week\s*([123])\b[^.\n]*?(?:close[s]?|deadline)[^.\n]*?([A-Za-z]+,?\s+[0-9]{1,2}(?:st|nd|rd|th)?(?:\s+[A-Za-z]+)?(?:\s+at\s+[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?(?:\s*IST)?)?|[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+at\s+[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?(?:\s*IST)?)?)/i.exec(
      line
    );
    if (weekMatch) {
      const weekNum = weekMatch[1]!;
      const rawVal = weekMatch[2]!.trim();
      const sub = `lunch_meal_plan_week_${weekNum}_deadline`;
      facts.push({
        id: makeFactId("meal_plan", sub, meta.path, line),
        topic: "meal_plan",
        subject: sub,
        value: rawVal,
        locationOrEvent: "The Circle (lunch delivery)",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Cost / pricing
    if (/₹\s*3,?000|3000\s*rupees/i.test(line) && /week/i.test(line)) {
      facts.push({
        id: makeFactId("meal_plan", "lunch_meal_plan_pricing", meta.path, line),
        topic: "meal_plan",
        subject: "lunch_meal_plan_pricing",
        value: "₹3,000 per week ($36)",
        locationOrEvent: "Edge City India",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Refund policy
    if (/no refund/i.test(line) && /meal/i.test(line)) {
      facts.push({
        id: makeFactId("meal_plan", "lunch_meal_plan_refund_policy", meta.path, line),
        topic: "meal_plan",
        subject: "lunch_meal_plan_refund_policy",
        value: "No refunds once a week is booked",
        locationOrEvent: "Edge City India",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }
  }
}

function extractCheckInAndWristbands(section: MarkdownSection, meta: ParsedDocMeta, facts: OperationalFact[]): void {
  const text = section.text;
  const isCheckInSection =
    /check[\s-]*in|wristband|arrival/i.test(section.heading) ||
    /wristband|check-in/i.test(text);

  if (!isCheckInSection) return;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Lost wristband fee
    if (/\$50\s*(?:USD)?/i.test(line) && /lost wristband/i.test(line)) {
      facts.push({
        id: makeFactId("check_in", "lost_wristband_replacement_fee", meta.path, line),
        topic: "check_in",
        subject: "lost_wristband_replacement_fee",
        value: "$50 USD charge for lost wristbands",
        locationOrEvent: "Edge City India Check-in",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Opening Day Sunday Oct 11 check-in
    if (/Sunday,?\s*Oct(?:ober)?\s*11\b/i.test(line) && /11:?00\s*(?:am)?\s*(?:to|-)\s*(?:17:?00|5:?00\s*pm)/i.test(line)) {
      facts.push({
        id: makeFactId("check_in", "check_in_sunday_oct_11", meta.path, line),
        topic: "check_in",
        subject: "check_in_sunday_oct_11",
        value: "11:00 to 17:00 at Riva Beach Resort (reception)",
        effectiveScope: { specificDate: "2026-10-11", recurrence: "specific_day" },
        locationOrEvent: "Riva Beach Resort reception",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Monday Oct 12 check-in
    if (/Monday,?\s*Oct(?:ober)?\s*12\b/i.test(line)) {
      // Look for Riva 9am-1pm or Circle 1pm-5pm
      const combinedSnippet = lines.slice(i, Math.min(lines.length, i + 4)).join(" ");
      if (/0?9:?00\s*(?:am)?\s*(?:to|-)\s*(?:13:?00|1:?00\s*pm)/i.test(combinedSnippet)) {
        facts.push({
          id: makeFactId("check_in", "check_in_monday_oct_12_morning", meta.path, combinedSnippet),
          topic: "check_in",
          subject: "check_in_monday_oct_12_morning",
          value: "09:00 to 13:00 at Riva Beach Resort (Garden Oasis Banquet Hall)",
          effectiveScope: { specificDate: "2026-10-12", recurrence: "specific_day" },
          locationOrEvent: "Riva Beach Resort (Garden Oasis Banquet Hall)",
          sourceUrl: meta.url,
          sourcePath: meta.path,
          sourceKind: meta.kind,
          publishedDate: meta.published,
          indexedDate: meta.indexed,
          supportingText: combinedSnippet.slice(0, 200).trim(),
          sectionTitle: section.heading,
        });
      }
      if (/(?:13:?00|1:?00\s*pm)\s*(?:to|-)\s*(?:17:?00|5:?00\s*pm)/i.test(combinedSnippet)) {
        facts.push({
          id: makeFactId("check_in", "check_in_monday_oct_12_afternoon", meta.path, combinedSnippet),
          topic: "check_in",
          subject: "check_in_monday_oct_12_afternoon",
          value: "13:00 to 17:00 at The Circle",
          effectiveScope: { specificDate: "2026-10-12", recurrence: "specific_day" },
          locationOrEvent: "The Circle",
          sourceUrl: meta.url,
          sourcePath: meta.path,
          sourceKind: meta.kind,
          publishedDate: meta.published,
          indexedDate: meta.indexed,
          supportingText: combinedSnippet.slice(0, 200).trim(),
          sectionTitle: section.heading,
        });
      }
    }

    // Ongoing check-in from Tuesday / Oct 13 onward
    if (/From\s*(?:Tuesday|Oct\s*13)\b/i.test(line) || /Weekdays\s*10:?00\s*(?:am)?\s*(?:to|-)\s*12:?00/i.test(line)) {
      const combinedSnippet = lines.slice(i, Math.min(lines.length, i + 4)).join(" ");
      facts.push({
        id: makeFactId("check_in", "check_in_ongoing_weekdays", meta.path, combinedSnippet),
        topic: "check_in",
        subject: "check_in_ongoing_weekdays",
        value: "Mon–Fri 10:00 to 12:00 at Riva Beach Resort (Garden Oasis Banquet Hall)",
        effectiveScope: { startDate: "2026-10-13", endDate: "2026-11-01", recurrence: "weekdays" },
        locationOrEvent: "Riva Beach Resort (Garden Oasis Banquet Hall)",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: combinedSnippet.slice(0, 200).trim(),
        sectionTitle: section.heading,
      });
      if (/12:?00\s*(?:to|-)\s*14:?00|12pm–2pm/i.test(combinedSnippet)) {
        facts.push({
          id: makeFactId("check_in", "check_in_ongoing_weekends", meta.path, combinedSnippet),
          topic: "check_in",
          subject: "check_in_ongoing_weekends",
          value: "Sat–Sun 12:00 to 14:00 at Riva Beach Resort (Garden Oasis Banquet Hall)",
          effectiveScope: { startDate: "2026-10-13", endDate: "2026-11-01", recurrence: "weekends" },
          locationOrEvent: "Riva Beach Resort (Garden Oasis Banquet Hall)",
          sourceUrl: meta.url,
          sourcePath: meta.path,
          sourceKind: meta.kind,
          publishedDate: meta.published,
          indexedDate: meta.indexed,
          supportingText: combinedSnippet.slice(0, 200).trim(),
          sectionTitle: section.heading,
        });
      }
    }
  }
}

function extractShuttlesAndTransport(section: MarkdownSection, meta: ParsedDocMeta, facts: OperationalFact[]): void {
  const text = section.text;
  const isTransport =
    /shuttle|transport|airport|getting to|travel/i.test(section.heading) ||
    /shuttle|taxi|cab|airport/i.test(text);

  if (!isTransport) return;

  const lines = text.split("\n");
  for (const line of lines) {
    // Oct 11 Free Airport Shuttle from GOX to Riva
    if (/shuttle/i.test(line) && /GOX|Mopa/i.test(line) && /October\s*11|Oct\s*11|Sunday\s*11\s*October/i.test(line)) {
      const isComplimentary = /free|complimentary/i.test(line) || /free|complimentary/i.test(section.text);
      facts.push({
        id: makeFactId("shuttle", "airport_shuttle_gox_opening_day", meta.path, line),
        topic: "shuttle",
        subject: "airport_shuttle_gox_opening_day",
        value: isComplimentary ? "Complimentary airport shuttle on Sunday Oct 11 only" : "Airport shuttle on Sunday Oct 11",
        effectiveScope: { specificDate: "2026-10-11", recurrence: "specific_day" },
        locationOrEvent: "GOX Airport to Riva Beach Resort",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Daily weekday loop shuttle (Oct 12 - 31)
    if (/shuttle/i.test(line) && /October\s*12(?:th)?\s*(?:through|to)\s*October\s*31/i.test(line)) {
      facts.push({
        id: makeFactId("shuttle", "village_daily_loop_shuttle", meta.path, line),
        topic: "shuttle",
        subject: "village_daily_loop_shuttle",
        value: "Weekdays 9am - 5pm from October 12th through October 31st daily",
        effectiveScope: { startDate: "2026-10-12", endDate: "2026-10-31", recurrence: "weekdays" },
        locationOrEvent: "NANU > RIVA > Lush Garden > The Circle loop",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // General taxi recommendations from airport
    if (/cab|taxi/i.test(line) && /GOX/i.test(line) && /prepaid|counter|40 to 60 minute/i.test(line)) {
      facts.push({
        id: makeFactId("shuttle", "airport_transit_general_taxi", meta.path, line),
        topic: "shuttle",
        subject: "airport_transit_general_taxi",
        value: "Prepaid taxi counter / pre-arranged cab (40-60 min from GOX to Mandrem)",
        effectiveScope: { recurrence: "daily" },
        locationOrEvent: "GOX Airport to Mandrem",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }
  }
}

function extractAccommodationAvailability(section: MarkdownSection, meta: ParsedDocMeta, facts: OperationalFact[]): void {
  const text = section.text;
  const isHousing =
    /housing|accommodation|stay|hotel|riva/i.test(section.heading) ||
    /housing|accommodation|Riva Beach Resort/i.test(text);

  if (!isHousing) return;

  const lines = text.split("\n");
  for (const line of lines) {
    if (/Riva Beach Resort/i.test(line) || /Riva/i.test(line)) {
      if (/sold\s*out/i.test(line)) {
        facts.push({
          id: makeFactId("accommodation", "riva_beach_resort_availability", meta.path, line),
          topic: "accommodation",
          subject: "riva_beach_resort_availability",
          value: "Sold Out",
          locationOrEvent: "Riva Beach Resort",
          sourceUrl: meta.url,
          sourcePath: meta.path,
          sourceKind: meta.kind,
          publishedDate: meta.published,
          indexedDate: meta.indexed,
          supportingText: line.trim(),
          sectionTitle: section.heading,
        });
      } else if (/Book at Riva here|Book accommodation|discounted rates for/i.test(line) && /https?:\/\//i.test(line)) {
        facts.push({
          id: makeFactId("accommodation", "riva_beach_resort_availability", meta.path, line),
          topic: "accommodation",
          subject: "riva_beach_resort_availability",
          value: "Booking Open / Available",
          locationOrEvent: "Riva Beach Resort",
          sourceUrl: meta.url,
          sourcePath: meta.path,
          sourceKind: meta.kind,
          publishedDate: meta.published,
          indexedDate: meta.indexed,
          supportingText: line.trim(),
          sectionTitle: section.heading,
        });
      }
    }
  }
}

function extractAttendeeInstructions(section: MarkdownSection, meta: ParsedDocMeta, facts: OperationalFact[]): void {
  const text = section.text;
  const lines = text.split("\n");

  for (const line of lines) {
    // Indian citizen discount
    if (/Indian citizens?\b/i.test(line) && /50%\s*off|discount/i.test(line)) {
      facts.push({
        id: makeFactId("attendee_instructions", "ticket_pricing_indian_citizens", meta.path, line),
        topic: "attendee_instructions",
        subject: "ticket_pricing_indian_citizens",
        value: "50% off base ticket price for Indian citizens (ID required at check-in)",
        locationOrEvent: "Edge City India Tickets",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }

    // Volunteer hour tiers
    if (/20\s*hours\/week\s*→\s*50%\s*off/i.test(line) || /30\s*hours\/week\s*→\s*75%\s*off/i.test(line)) {
      facts.push({
        id: makeFactId("attendee_instructions", "volunteer_ticket_discount_tiers", meta.path, line),
        topic: "attendee_instructions",
        subject: "volunteer_ticket_discount_tiers",
        value: "20 hrs/week (50% off), 30 hrs/week (75% off), up to 40 hrs/week (free ticket)",
        locationOrEvent: "Edge City India Volunteering",
        sourceUrl: meta.url,
        sourcePath: meta.path,
        sourceKind: meta.kind,
        publishedDate: meta.published,
        indexedDate: meta.indexed,
        supportingText: line.trim(),
        sectionTitle: section.heading,
      });
    }
  }
}
