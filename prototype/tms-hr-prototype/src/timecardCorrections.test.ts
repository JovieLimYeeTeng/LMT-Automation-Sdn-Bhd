import { describe, expect, it } from "vitest";
import {
  dedupeTimecardCorrectionAudits,
  timecardCorrectionTargetId,
  upsertTimecardCorrectionAudit,
} from "./timecardCorrections";
import type { TimecardCorrectionAudit } from "./types";

function audit(patch: Partial<TimecardCorrectionAudit> = {}): TimecardCorrectionAudit {
  return {
    id: patch.id ?? "audit-1",
    targetId: patch.targetId,
    employeeId: patch.employeeId ?? "emp-1",
    date: patch.date ?? "2026-04-01",
    action: patch.action ?? "save",
    actor: patch.actor ?? "HR",
    reason: patch.reason ?? "Forgot punch",
    changedAt: patch.changedAt ?? "2026-05-15T10:00:00.000Z",
    beforePunches: patch.beforePunches ?? [],
    afterPunches: patch.afterPunches ?? [],
  };
}

describe("timecard correction identity", () => {
  it("uses one stable target for the same employee and date", () => {
    expect(timecardCorrectionTargetId("emp-1", "2026-04-01")).toBe("correction-emp-1-2026-04-01");
  });

  it("updates an existing correction target instead of appending a duplicate", () => {
    const first = audit({
      id: "stable-row",
      targetId: timecardCorrectionTargetId("emp-1", "2026-04-01"),
      reason: "Forgot clock in",
      changedAt: "2026-05-15T10:00:00.000Z",
    });
    const second = audit({
      id: "new-random-id",
      targetId: timecardCorrectionTargetId("emp-1", "2026-04-01"),
      reason: "Manager approved correction",
      changedAt: "2026-05-15T11:00:00.000Z",
    });

    const result = upsertTimecardCorrectionAudit([first], second);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("stable-row");
    expect(result[0].reason).toBe("Manager approved correction");
    expect(result[0].changedAt).toBe("2026-05-15T11:00:00.000Z");
  });

  it("deduplicates legacy repeated corrections and keeps the latest per target", () => {
    const older = audit({
      id: "older",
      employeeId: "emp-1",
      date: "2026-04-01",
      reason: "Older correction",
      changedAt: "2026-05-15T09:00:00.000Z",
    });
    const latest = audit({
      id: "latest",
      employeeId: "emp-1",
      date: "2026-04-01",
      reason: "Latest correction",
      changedAt: "2026-05-15T12:00:00.000Z",
    });
    const otherDate = audit({
      id: "other",
      employeeId: "emp-1",
      date: "2026-04-02",
      reason: "Different date",
      changedAt: "2026-05-15T13:00:00.000Z",
    });

    const result = dedupeTimecardCorrectionAudits([older, latest, otherDate]);

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.date === "2026-04-01")?.reason).toBe("Latest correction");
    expect(result.find((item) => item.date === "2026-04-02")?.reason).toBe("Different date");
  });
});
