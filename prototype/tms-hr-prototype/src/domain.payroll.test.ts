import { describe, expect, it } from "vitest";
import { createStandardWeek, getMonthlyReadiness, payrollFor } from "./domain";
import type { AppData, Employee, LeaveEntry, Punch, PunchKind, Shift } from "./types";

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

function appData(person: Employee, punches: Punch[] = [], leaves: LeaveEntry[] = [], businessDate = "2026-04-01"): AppData {
  return {
    employees: [person],
    shifts: [shift],
    holidays: [],
    leaves,
    punches,
    settings: {
      businessDate,
      defaultMonth: "2026-04",
      companies: ["Demo Sdn Bhd"],
      departments: ["Ops"],
      leaveTypes: ["Annual leave", "Unpaid leave"],
      paidLeaveTypes: ["Annual leave"],
      device: { fingerprint: true, face: false, card: true, model: "" },
      requirePassword: false,
      usbLicenseRequired: false,
      localPasswordHint: "",
      hrPassword: "1234",
      usbToken: "",
    },
  };
}

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
    expect(pay.absentDeduct).toBe(100);
    expect(pay.gross).toBe(2900);
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

  it("adds auto-calculated overtime pay as a payroll warning", () => {
    const person = employee();
    const pay = payrollFor(appData(person, fullDay("2026-04-01", "20:00")), person, "2026-04");

    expect(pay.otHours).toBe(2);
    expect(pay.otPay).toBe(60);
    expect(pay.gross).toBe(3060);
    expect(pay.warningFlags).toContain("overtime");
  });

  it("pro-rates monthly salary from a mid-month join date", () => {
    const person = employee({ joinDate: "2026-04-16" });
    const pay = payrollFor(appData(person, fullDay("2026-04-16"), [], "2026-04-16"), person, "2026-04");

    expect(pay.proratedDays).toBe(15);
    expect(pay.totalMonthDays).toBe(30);
    expect(pay.base).toBe(1500);
    expect(pay.gross).toBe(1500);
  });
});

describe("getMonthlyReadiness", () => {
  it("reports empty, pending, and ready month states", () => {
    const person = employee();

    expect(getMonthlyReadiness(appData(person), "2026-04").status).toBe("empty");
    expect(getMonthlyReadiness(appData(person, [punch("in", "09:00")]), "2026-04").missingCount).toBe(1);
    expect(getMonthlyReadiness(appData(person, fullDay()), "2026-04").status).toBe("ready");
  });
});
