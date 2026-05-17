import { describe, expect, it } from "vitest";
import {
  attendanceReviewId,
  calculateAttendance,
  createStandardWeek,
  getDeductionReviewItems,
  getMonthlyReadiness,
  payrollFor,
} from "./domain";
import { timecardCorrectionTargetId, upsertTimecardCorrectionAudit } from "./timecardCorrections";
import type {
  AppData,
  AttendanceReview,
  Employee,
  LeaveEntry,
  Punch,
  PunchKind,
  Shift,
  TimecardCorrectionAudit,
} from "./types";

const shift: Shift = {
  id: "shift-day",
  name: "Day",
  code: "D",
  color: "#2f7d74",
  flexibleWork: false,
  workLengthHours: 8,
  flexibleLunch: true,
  lunchMinutes: 60,
  graceMinutes: 0,
  days: createStandardWeek("09:00", "12:00", "13:00", "18:00", "18:00", [0, 6]),
};

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-001",
    enrollNo: "1001",
    workNo: "EMP-001",
    firstName: "Wei",
    lastName: "Tan",
    gender: "male",
    idNo: "",
    birthDate: "",
    birthPlace: "",
    address: "",
    nationality: "Malaysia",
    company: "Demo Sdn Bhd",
    department: "Ops",
    position: "Crew",
    joinDate: "2026-01-01",
    shiftId: shift.id,
    autoShift: false,
    flexibleWork: false,
    workLengthHours: 8,
    flexibleLunch: true,
    lunchMinutes: 60,
    graceMinutes: 0,
    restDays: [0, 6],
    shiftOverrides: {},
    restOverrides: {},
    exemptions: { late: false, early: false, lunchPunch: false, overtime: false },
    salary: {
      type: "monthly",
      currency: "MYR",
      monthlyAmount: 3000,
      hourlyRate: 20,
      otMultiplier: 1.5,
      leaveDeductPerDay: 0,
    },
    active: true,
    ...overrides,
  };
}

function punch(kind: PunchKind, time: string, date = "2026-04-01"): Punch {
  return {
    id: `${date}-${kind}-${time}`,
    employeeId: "emp-001",
    date,
    time,
    kind,
    source: "manual",
    note: "",
  };
}

function punchSet(date = "2026-04-01", clockIn = "09:00", clockOut = "18:00"): Punch[] {
  return [
    punch("in", clockIn, date),
    punch("breakOut", "12:00", date),
    punch("breakIn", "13:00", date),
    punch("out", clockOut, date),
  ];
}

function appData(
  person: Employee,
  punches: Punch[] = [],
  leaves: LeaveEntry[] = [],
  attendanceReviews: AttendanceReview[] = [],
): AppData {
  return {
    employees: [person],
    shifts: [shift],
    holidays: [],
    leaves,
    punches,
    attendanceReviews,
    timecardCorrectionAudits: [],
    settings: {
      businessDate: "2026-04-01",
      defaultMonth: "2026-04",
      companies: ["Demo Sdn Bhd"],
      departments: ["Ops"],
      positions: ["Crew"],
      nationalities: ["Malaysia"],
      leaveTypes: ["Annual leave", "Sick leave", "Unpaid leave"],
      paidLeaveTypes: ["Annual leave", "Sick leave"],
      mcRequiredLeaveTypes: ["Sick leave"],
      correctionReasons: ["Forgot punch in"],
      deductionReasons: ["First-time late"],
      deductionAmounts: {
        source: "settings",
        fullDayDeductPerDay: 100,
        minuteDeductHourlyRate: 20,
      },
      deductionAmountOptions: [
        { id: "minor", label: "Minor deduction", amount: 12 },
      ],
      device: { fingerprint: true, face: false, card: true, model: "" },
      requirePassword: false,
      usbLicenseRequired: false,
      localPasswordHint: "",
      hrPassword: "1234",
      usbToken: "",
    },
  };
}

describe("cross-module data consistency", () => {
  it("uses corrected punches as the attendance source and does not let stale late decisions keep deducting payroll", () => {
    const person = employee();
    const lateReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "late"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "late",
      decision: "deducted",
      note: "Deduct confirmed",
      reviewedBy: "HR",
      updatedAt: "2026-04-01T10:00:00.000Z",
      amountMode: "rules",
      finalDeductionAmount: 5,
      payrollImpact: 5,
      payrollImpactCurrency: "MYR",
    };
    const data = appData(person, punchSet("2026-04-01", "09:15"), [], [lateReview]);

    expect(calculateAttendance(data, person, "2026-04-01").lateMinutes).toBe(15);
    expect(payrollFor(data, person, "2026-04").lateEarlyDeduct).toBe(5);

    const correctionAudit: TimecardCorrectionAudit = {
      id: timecardCorrectionTargetId(person.id, "2026-04-01"),
      targetId: timecardCorrectionTargetId(person.id, "2026-04-01"),
      employeeId: person.id,
      date: "2026-04-01",
      action: "save",
      actor: "HR",
      reason: "Corrected punch",
      changedAt: "2026-04-01T11:00:00.000Z",
      beforePunches: [],
      afterPunches: [],
    };
    const correctedData: AppData = {
      ...data,
      punches: punchSet("2026-04-01", "09:00"),
      timecardCorrectionAudits: upsertTimecardCorrectionAudit(data.timecardCorrectionAudits, correctionAudit),
    };

    expect(calculateAttendance(correctedData, person, "2026-04-01").lateMinutes).toBe(0);
    expect(getDeductionReviewItems(correctedData, "2026-04", [person]).some((item) => item.kind === "late")).toBe(false);
    expect(correctedData.attendanceReviews).toHaveLength(1);
    expect(getMonthlyReadiness(correctedData, "2026-04", [person]).monthReviewCount).toBe(0);
    expect(payrollFor(correctedData, person, "2026-04").lateEarlyDeduct).toBe(0);
    expect(payrollFor(correctedData, person, "2026-04").totalDeduct).toBe(0);
  });

  it("uses latest leave data and stops payroll deduction when sick leave is edited to approved MC-provided paid leave", () => {
    const person = employee();
    const unpaidLeaveReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "unpaidLeave"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "unpaidLeave",
      decision: "deducted",
      note: "No MC",
      reviewedBy: "HR",
      updatedAt: "2026-04-01T10:00:00.000Z",
      amountMode: "rules",
      finalDeductionAmount: 100,
      payrollImpact: 100,
      payrollImpactCurrency: "MYR",
      relatedLeaveType: "Sick leave",
      leavePayRule: "deduct",
    };
    const pendingSickLeave: LeaveEntry = {
      id: "leave-1",
      employeeId: person.id,
      date: "2026-04-01",
      type: "Sick leave",
      hours: 8,
      mcStatus: "notProvided",
      approvalStatus: "pending",
      note: "",
    };
    const data = appData(person, [], [pendingSickLeave], [unpaidLeaveReview]);

    expect(getDeductionReviewItems(data, "2026-04", [person]).some((item) => item.kind === "unpaidLeave")).toBe(true);
    expect(payrollFor(data, person, "2026-04").unpaidLeaveDeduct).toBe(100);

    const updatedLeave: LeaveEntry = {
      ...pendingSickLeave,
      mcStatus: "provided",
      approvalStatus: "approved",
      mcAttachment: {
        id: "mc-1",
        name: "mc.pdf",
        type: "application/pdf",
        size: 1024,
        dataUrl: "data:application/pdf;base64,AA==",
        uploadedBy: "HR",
        uploadedAt: "2026-04-01T12:00:00.000Z",
      },
    };
    const editedData: AppData = { ...data, leaves: [updatedLeave] };

    expect(getDeductionReviewItems(editedData, "2026-04", [person]).some((item) => item.kind === "unpaidLeave")).toBe(false);
    expect(payrollFor(editedData, person, "2026-04").unpaidLeaveDeduct).toBe(0);
    expect(payrollFor(editedData, person, "2026-04").totalDeduct).toBe(0);
  });

  it("keeps a saved Settings deduction option amount as the payroll source even if Settings options later change", () => {
    const person = employee();
    const savedOptionReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "late"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "late",
      decision: "deducted",
      note: "Minor penalty",
      reviewedBy: "HR",
      updatedAt: "2026-04-01T10:00:00.000Z",
      amountMode: "settingsOption",
      deductionOptionId: "minor",
      deductionOptionLabel: "Minor deduction",
      finalDeductionAmount: 12,
      payrollImpact: 12,
      payrollImpactCurrency: "MYR",
    };
    const data = appData(person, punchSet("2026-04-01", "09:15"), [], [savedOptionReview]);
    const changedSettingsData: AppData = {
      ...data,
      settings: {
        ...data.settings,
        deductionAmountOptions: [],
      },
    };

    expect(payrollFor(changedSettingsData, person, "2026-04").lateEarlyDeduct).toBe(12);
  });

  it("uses employee hourly rate before Settings fallback for time-based rule deductions", () => {
    const person = employee({ salary: { ...employee().salary, hourlyRate: 30 } });
    const reviewWithoutSavedAmount: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "late"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "late",
      decision: "deducted",
      note: "Legacy saved decision",
      reviewedBy: "HR",
      updatedAt: "2026-04-01T10:00:00.000Z",
      amountMode: "rules",
    };
    const data = appData(person, punchSet("2026-04-01", "09:30"), [], [reviewWithoutSavedAmount]);
    const highFallbackData: AppData = {
      ...data,
      settings: {
        ...data.settings,
        deductionAmounts: {
          ...data.settings.deductionAmounts,
          minuteDeductHourlyRate: 99,
        },
      },
    };

    expect(payrollFor(highFallbackData, person, "2026-04").lateEarlyDeduct).toBe(15);
  });
});
