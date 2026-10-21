import { describe, expect, it } from "vitest";
import { reminderFromTags, withReminderTag } from "../src/services/reminders";

describe("note reminders", () => {
  it("adds, replaces, and removes the hidden reminder tag", () => {
    const first = withReminderTag(["email"], "2026-10-26T09:00:00.000Z");
    expect(reminderFromTags(first)).toBe("2026-10-26T09:00:00.000Z");
    const replacement = withReminderTag(first, "2026-10-27T09:00:00.000Z");
    expect(replacement.filter((tag) => tag.startsWith("reminder:"))).toHaveLength(1);
    expect(withReminderTag(replacement)).toEqual(["email"]);
  });
});
