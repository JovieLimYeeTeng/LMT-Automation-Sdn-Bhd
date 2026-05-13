import { describe, expect, it } from "vitest";
import { attendanceReviewId, calculateAttendance, createStandardWeek, findShiftForPunch, getMonthlyReadiness, normalizeShiftRules, payrollFor } from "./domain";
import type { AppData, AttendanceReview, Employee, LeaveEntry, Punch, PunchKind, Shift } from "./types";

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

const flexibleShift: Shift = {
  ...shift,
  id: "shift-flex",
  name: "Flexible base",
  flexibleWork: false,
};

const graceShift: Shift = {
  ...shift,
  id: "shift-grace",
  name: "Grace",
  graceMinutes: 10,
};

const nightShift: Shift = {
  ...shift,
  id: "shift-night",
  name: "Night",
  code: "N",
  days: createStandardWeek("22:00", "02:00", "03:00", "07:00", "07:00", [0, 6]),
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
      leaveDeductPerDay: 100,
    },
    active: true,
    ...overrides,
  };
}

function punch(kind: PunchKind, time: string, date = "2026-04-01"): Punch {
  return {
    id: `p-${kind}-${time}`,
    employeeId: "emp-001",
    date,
    time,
    kind,
    source: "manual",
    note: "",
  };
}

function fullDay(date = "2026-04-01", out = "18:00"): Punch[] {
  return [
    punch("in", "09:00", date),
    punch("breakOut", "12:00", date),
    punch("breakIn", "13:00", date),
    punch("out", out, date),
  ];
}

function leave(type: string, date = "2026-04-01"): LeaveEntry {
  return { id: `leave-${type}`, employeeId: "emp-001", date, type, hours: 8, note: "" };
}

function appData(
  person: Employee,
  punches: Punch[] = [],
  leaves: LeaveEntry[] = [],
  businessDate = "2026-04-01",
  shifts: Shift[] = [shift],
  attendanceReviews: AttendanceReview[] = [],
): AppData {
  return {
    employees: [person],
    shifts,
    holidays: [],
    leaves,
    punches,
    attendanceReviews,
    timecardCorrectionAudits: [],
    settings: {
      businessDate,
      defaultMonth: "2026-04",
      companies: ["Demo Sdn Bhd"],
      departments: ["Ops"],
      positions: ["Operator"],
      nationalities: ["Malaysia"],
      leaveTypes: ["Annual leave", "Unpaid leave"],
      paidLeaveTypes: ["Annual leave"],
      correctionReasons: ["Forgot punch in", "Forgot punch out"],
      device: { fingerprint: true, face: false, card: true, model: "" },
      requirePassword: false,
      usbLicenseRequired: false,
      localPasswordHint: "",
      hrPassword: "1234",
      usbToken: "",
    },
  };
}

describe("attendance rule validation", () => {
  it("normalizes legacy flexible-work shifts back into plain time templates", () => {
    const legacyFlexibleShift = { ...flexibleShift, flexibleWork: true, graceMinutes: 15 };

    expect(normalizeShiftRules(legacyFlexibleShift)).toMatchObject({
      flexibleWork: false,
      graceMinutes: 15,
    });
  });

  it("keeps flexible-work employees out of auto shift calculation", () => {
    const nearPunchShift = {
      ...flexibleShift,
      days: createStandardWeek("08:56", "12:00", "13:00", "17:56", "17:56", [0, 6]),
    };
    const person = employee({ autoShift: true, flexibleWork: true, shiftId: shift.id });
    const record = calculateAttendance(
      appData(person, fullDay(), [], "2026-04-01", [nearPunchShift, shift]),
      person,
      "2026-04-01",
    );

    expect(findShiftForPunch([nearPunchShift, shift], "2026-04-01", "08:56")?.id).toBe(nearPunchShift.id);
    expect(record.shiftSource).toBe("employee");
    expect(record.shift?.id).toBe(shift.id);
    expect(record.lateMinutes).toBe(0);
  });

  it("treats flexible work as an employee policy, not a shift template policy", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const record = calculateAttendance(
      appData(person, fullDay(), [], "2026-04-01", [flexibleShift]),
      person,
      "2026-04-01",
    );

    expect(record.status).toBe("present");
    expect(record.shift?.flexibleWork).toBe(false);
    expect(record.workMinutes).toBe(480);
  });

  it("allows a flexible-work employee to manually override the time template", () => {
    const person = employee({ flexibleWork: true, shiftId: shift.id });
    const record = calculateAttendance(
      appData(person, fullDay(), [], "2026-04-01", [shift, flexibleShift]),
      person,
      "2026-04-01",
      flexibleShift.id,
    );

    expect(record.shiftSource).toBe("override");
    expect(record.shift?.id).toBe(flexibleShift.id);
    expect(record.shift?.flexibleWork).toBe(false);
    expect(record.status).toBe("present");
    expect(record.workMinutes).toBe(480);

    const savedOverridePerson = employee({
      flexibleWork: true,
      shiftId: shift.id,
      shiftOverrides: { "2026-04-01": flexibleShift.id },
    });
    const savedOverrideRecord = calculateAttendance(
      appData(savedOverridePerson, fullDay(), [], "2026-04-01", [shift, flexibleShift]),
      savedOverridePerson,
      "2026-04-01",
    );

    expect(savedOverrideRecord.shiftSource).toBe("override");
    expect(savedOverrideRecord.shift?.id).toBe(flexibleShift.id);
    expect(savedOverrideRecord.status).toBe("present");
  });

  it("keeps A+L+G legal with grace and flexible lunch", () => {
    const person = employee({ autoShift: true, shiftId: graceShift.id, graceMinutes: 10, flexibleLunch: true });
    const punches = [
      punch("in", "09:05"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:20"),
      punch("out", "18:20"),
    ];
    const record = calculateAttendance(appData(person, punches, [], "2026-04-01", [graceShift]), person, "2026-04-01");

    expect(record.shiftSource).toBe("auto");
    expect(record.shift?.id).toBe(graceShift.id);
    expect(record.lateMinutes).toBe(0);
    expect(record.flags).toContainEqual({ kind: "lunchOver", minutes: 20 });
  });

  it("keeps W+L legal and still flags short flexible-work days", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const record = calculateAttendance(appData(person, shortDay, [], "2026-04-01", [flexibleShift]), person, "2026-04-01");

    expect(record.shift?.flexibleWork).toBe(false);
    expect(record.flags).toContainEqual({ kind: "underWork", hours: 8 });
  });
});

describe("payrollFor", () => {
  it("keeps monthly salary whole when attendance is complete", () => {
    const person = employee();
    const pay = payrollFor(appData(person, fullDay()), person, "2026-04");

    expect(pay.base).toBe(3000);
    expect(pay.totalDeduct).toBe(0);
    expect(pay.gross).toBe(3000);
  });

  it("deducts absent days from monthly salary", () => {
    const person = employee();
    const pay = payrollFor(appData(person), person, "2026-04");

    expect(pay.summary.absentDays).toBe(1);
    expect(pay.summary.missingCount).toBe(0);
    expect(pay.absentDeduct).toBe(100);
    expect(pay.gross).toBe(2900);
    expect(pay.warningFlags).toContain("absent");
    expect(pay.warningFlags).not.toContain("missing");
  });

  it("counts incomplete punches as missing punch, not absent", () => {
    const person = employee();
    const pay = payrollFor(appData(person, [punch("in", "09:00")]), person, "2026-04");

    expect(pay.summary.missingCount).toBe(1);
    expect(pay.summary.absentDays).toBe(0);
    expect(pay.warningFlags).toContain("missing");
    expect(pay.warningFlags).not.toContain("absent");
  });

  it("deducts unpaid leave from monthly salary", () => {
    const person = employee();
    const pay = payrollFor(appData(person, [], [leave("Unpaid leave")]), person, "2026-04");

    expect(pay.summary.deductibleLeaveDays).toBe(1);
    expect(pay.unpaidLeaveDeduct).toBe(100);
    expect(pay.gross).toBe(2900);
  });

  it("pays hourly staff from worked hours and paid leave hours", () => {
    const person = employee({
      salary: {
        type: "hourly",
        currency: "MYR",
        monthlyAmount: 0,
        hourlyRate: 10,
        otMultiplier: 1.5,
        leaveDeductPerDay: 100,
      },
    });

    expect(payrollFor(appData(person, fullDay()), person, "2026-04").gross).toBe(80);
    expect(payrollFor(appData(person, [], [leave("Annual leave")]), person, "2026-04").gross).toBe(80);
  });

  it("adds auto-calculated overtime pay as a payroll review item", () => {
    const person = employee();
    const pay = payrollFor(appData(person, fullDay("2026-04-01", "20:00")), person, "2026-04");

    expect(pay.otHours).toBe(2);
    expect(pay.otPay).toBe(60);
    expect(pay.gross).toBe(3060);
    expect(pay.warningFlags).toContain("overtime");
  });

  it("adds short flexible-work days to payroll notes without auto-deducting salary", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const pay = payrollFor(appData(person, shortDay, [], "2026-04-01", [flexibleShift]), person, "2026-04");

    expect(pay.summary.shortHoursCount).toBe(1);
    expect(pay.warningFlags).toContain("shortHours");
    expect(pay.totalDeduct).toBe(0);
    expect(pay.gross).toBe(3000);
  });

  it("keeps accepted short-hours days in payroll notes without pending salary impact", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const acceptedReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "shortHours"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "shortHours",
      decision: "accepted",
      note: "HR accepted",
      updatedAt: "2026-04-24T00:00:00.000Z",
    };
    const data = appData(person, shortDay, [], "2026-04-01", [flexibleShift], [acceptedReview]);
    const pay = payrollFor(data, person, "2026-04");

    expect(pay.summary.shortHoursCount).toBe(0);
    expect(pay.summary.acceptedShortHoursCount).toBe(1);
    expect(pay.warningFlags).not.toContain("shortHours");
    expect(pay.warningFlags).toContain("acceptedShortHours");
    expect(pay.totalDeduct).toBe(0);
    expect(pay.gross).toBe(3000);
  });

  it("deducts reviewed short-hours gaps for monthly staff only", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const deductedReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "shortHours"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "shortHours",
      decision: "deducted",
      note: "Deduct shortage",
      updatedAt: "2026-04-24T00:00:00.000Z",
    };
    const pay = payrollFor(
      appData(person, shortDay, [], "2026-04-01", [flexibleShift], [deductedReview]),
      person,
      "2026-04",
    );

    expect(pay.summary.shortHoursCount).toBe(0);
    expect(pay.summary.deductedShortHoursCount).toBe(1);
    expect(pay.summary.deductedShortHoursMinutes).toBe(90);
    expect(pay.warningFlags).toContain("deductedShortHours");
    expect(pay.shortHoursDeduct).toBe(30);
    expect(pay.totalDeduct).toBe(30);
    expect(pay.gross).toBe(2970);
  });

  it("does not double-deduct reviewed short hours for hourly staff", () => {
    const person = employee({
      shiftId: flexibleShift.id,
      flexibleWork: true,
      salary: {
        type: "hourly",
        currency: "MYR",
        monthlyAmount: 0,
        hourlyRate: 10,
        otMultiplier: 1.5,
        leaveDeductPerDay: 100,
      },
    });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const deductedReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "shortHours"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "shortHours",
      decision: "deducted",
      note: "Deduct shortage",
      updatedAt: "2026-04-24T00:00:00.000Z",
    };
    const pay = payrollFor(
      appData(person, shortDay, [], "2026-04-01", [flexibleShift], [deductedReview]),
      person,
      "2026-04",
    );

    expect(pay.workHours).toBe(6.5);
    expect(pay.shortHoursDeduct).toBe(0);
    expect(pay.totalDeduct).toBe(0);
    expect(pay.gross).toBe(65);
  });

  it("pro-rates monthly salary from a mid-month join date", () => {
    const person = employee({ joinDate: "2026-04-16" });
    const pay = payrollFor(appData(person, fullDay("2026-04-16"), [], "2026-04-16"), person, "2026-04");

    expect(pay.proratedDays).toBe(15);
    expect(pay.totalMonthDays).toBe(30);
    expect(pay.base).toBe(1500);
    expect(pay.gross).toBe(1500);
  });

  it("counts an overnight shift under the shift start date", () => {
    const person = employee({ shiftId: nightShift.id });
    const punches = [
      punch("in", "22:00", "2026-04-01"),
      punch("breakOut", "02:00", "2026-04-02"),
      punch("breakIn", "03:00", "2026-04-02"),
      punch("out", "07:00", "2026-04-02"),
    ];
    const data = appData(person, punches, [], "2026-04-01", [nightShift]);
    const record = calculateAttendance(data, person, "2026-04-01");

    expect(record.overnight).toBe(true);
    expect(record.clockOutDayOffset).toBe(1);
    expect(record.workMinutes).toBe(480);
    expect(record.status).toBe("present");
    expect(payrollFor(data, person, "2026-04").workHours).toBe(8);
  });

  it("does not treat the next-morning out punch as a second work day", () => {
    const person = employee({ shiftId: nightShift.id });
    const punches = [
      punch("in", "22:00", "2026-04-01"),
      punch("out", "07:00", "2026-04-02"),
    ];
    const data = appData(person, punches, [], "2026-04-02", [nightShift]);

    expect(calculateAttendance(data, person, "2026-04-01").workMinutes).toBe(480);
    expect(calculateAttendance(data, person, "2026-04-02").punches).toHaveLength(0);
    expect(calculateAttendance(data, person, "2026-04-02").status).toBe("absent");
  });

  it("keeps consecutive night shifts separated by start date", () => {
    const person = employee({ shiftId: nightShift.id });
    const punches = [
      punch("in", "22:00", "2026-04-01"),
      punch("out", "07:00", "2026-04-02"),
      punch("in", "22:00", "2026-04-02"),
      punch("out", "07:00", "2026-04-03"),
    ];
    const data = appData(person, punches, [], "2026-04-02", [nightShift]);

    expect(calculateAttendance(data, person, "2026-04-01").punches.map((item) => item.date)).toEqual([
      "2026-04-01",
      "2026-04-02",
    ]);
    expect(calculateAttendance(data, person, "2026-04-02").punches.map((item) => item.date)).toEqual([
      "2026-04-02",
      "2026-04-03",
    ]);
    expect(payrollFor(data, person, "2026-04").workHours).toBe(16);
  });

  it("keeps a month-end night shift in the starting month readiness", () => {
    const person = employee({ shiftId: nightShift.id });
    const punches = [
      punch("in", "22:00", "2026-04-30"),
      punch("out", "07:00", "2026-05-01"),
    ];
    const data = appData(person, punches, [], "2026-04-30", [nightShift]);

    expect(payrollFor(data, person, "2026-04").workHours).toBe(8);
    expect(getMonthlyReadiness(data, "2026-04").monthPunchCount).toBe(2);
    expect(getMonthlyReadiness(data, "2026-05").hasOperationalData).toBe(false);
  });
});

describe("getMonthlyReadiness", () => {
  it("reports empty, pending, and ready month states", () => {
    const person = employee();

    expect(getMonthlyReadiness(appData(person), "2026-04").status).toBe("empty");
    expect(getMonthlyReadiness(appData(person, [punch("in", "09:00")]), "2026-04").missingCount).toBe(1);
    expect(getMonthlyReadiness(appData(person, fullDay()), "2026-04").status).toBe("ready");
  });

  it("marks short-hours months as pending for HR review", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const readiness = getMonthlyReadiness(appData(person, shortDay, [], "2026-04-01", [flexibleShift]), "2026-04");

    expect(readiness.shortHoursCount).toBe(1);
    expect(readiness.unresolvedCount).toBe(1);
    expect(readiness.status).toBe("pending");
  });

  it("does not keep accepted short-hours days pending", () => {
    const person = employee({ shiftId: flexibleShift.id, flexibleWork: true });
    const shortDay = [
      punch("in", "10:30"),
      punch("breakOut", "12:00"),
      punch("breakIn", "13:00"),
      punch("out", "18:00"),
    ];
    const acceptedReview: AttendanceReview = {
      id: attendanceReviewId(person.id, "2026-04-01", "shortHours"),
      employeeId: person.id,
      date: "2026-04-01",
      kind: "shortHours",
      decision: "accepted",
      note: "HR accepted",
      updatedAt: "2026-04-24T00:00:00.000Z",
    };
    const readiness = getMonthlyReadiness(
      appData(person, shortDay, [], "2026-04-01", [flexibleShift], [acceptedReview]),
      "2026-04",
    );

    expect(readiness.shortHoursCount).toBe(0);
    expect(readiness.unresolvedCount).toBe(0);
    expect(readiness.status).toBe("ready");
  });
});
