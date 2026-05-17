import type { TimecardCorrectionAudit } from "./types";

export function timecardCorrectionTargetId(employeeId: string, date: string): string {
  return `correction-${employeeId}-${date}`;
}

function auditTargetId(audit: Pick<TimecardCorrectionAudit, "employeeId" | "date" | "targetId">): string {
  return audit.targetId || timecardCorrectionTargetId(audit.employeeId, audit.date);
}

export function normalizeTimecardCorrectionAudit(audit: TimecardCorrectionAudit): TimecardCorrectionAudit {
  return {
    ...audit,
    targetId: auditTargetId(audit),
  };
}

export function upsertTimecardCorrectionAudit(
  audits: TimecardCorrectionAudit[],
  audit: TimecardCorrectionAudit,
): TimecardCorrectionAudit[] {
  const normalizedAudit = normalizeTimecardCorrectionAudit(audit);
  const targetId = auditTargetId(normalizedAudit);
  const existing = audits.find((item) => auditTargetId(item) === targetId);
  return [
    ...audits.filter((item) => auditTargetId(item) !== targetId),
    {
      ...normalizedAudit,
      id: existing?.id ?? normalizedAudit.id,
    },
  ];
}

export function dedupeTimecardCorrectionAudits(audits: TimecardCorrectionAudit[]): TimecardCorrectionAudit[] {
  const latestByTarget = new Map<string, TimecardCorrectionAudit>();

  audits.forEach((audit) => {
    const normalizedAudit = normalizeTimecardCorrectionAudit(audit);
    const targetId = auditTargetId(normalizedAudit);
    const existing = latestByTarget.get(targetId);
    if (!existing || normalizedAudit.changedAt >= existing.changedAt) {
      latestByTarget.set(targetId, {
        ...normalizedAudit,
        id: existing?.id ?? normalizedAudit.id,
      });
    }
  });

  return Array.from(latestByTarget.values());
}
