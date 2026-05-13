import { addDays, createStandardWeek, dateKey, getWeekday, minutesFromTime, monthDates, timeFromMinutes } from "./domain";
import type { AppData, Employee, Punch, PunchKind, Shift } from "./types";

const morningShift: Shift = {
  id: "shift-morning",
  name: "早班",
  code: "M",
  color: "#2f7d74",
  flexibleWork: false,
  workLengthHours: 8,
  flexibleLunch: true,
  lunchMinutes: 60,
  graceMinutes: 15,
  days: createStandardWeek("09:00", "13:00", "14:00", "18:00", "18:30", [0]),
};

const afternoonShift: Shift = {
  id: "shift-afternoon",
  name: "午班",
  code: "A",
  color: "#b56727",
  flexibleWork: false,
  workLengthHours: 8,
  flexibleLunch: true,
  lunchMinutes: 60,
  graceMinutes: 10,
  days: createStandardWeek("13:00", "17:00", "18:00", "22:00", "22:30", [0]),
};

const officeShift: Shift = {
  id: "shift-office",
  name: "Office 9-6",
  code: "O",
  color: "#405d9a",
  flexibleWork: false,
  workLengthHours: 8,
  flexibleLunch: true,
  lunchMinutes: 60,
  graceMinutes: 15,
  days: createStandardWeek("09:00", "13:00", "14:00", "18:00", "18:30", [0, 6]),
};

const nightShift: Shift = {
  id: "shift-night",
  name: "夜班",
  code: "N",
  color: "#59606f",
  flexibleWork: false,
  workLengthHours: 8,
  flexibleLunch: true,
  lunchMinutes: 60,
  graceMinutes: 15,
  days: createStandardWeek("18:00", "22:00", "23:00", "02:00", "02:00", [0]),
};

const employees: Employee[] = [
  {
    id: "emp-001",
    enrollNo: "1001",
    workNo: "EMP-001",
    firstName: "Wei",
    lastName: "Tan",
    gender: "male",
    idNo: "900101-10-1001",
    birthDate: "1990-01-01",
    birthPlace: "Johor Bahru",
    address: "Taman Molek, Johor",
    nationality: "Malaysia",
    company: "Duo Demo Sdn Bhd",
    department: "餐饮",
    position: "Supervisor",
    joinDate: "2022-03-15",
    shiftId: "shift-morning",
    autoShift: false,
    flexibleWork: false,
    workLengthHours: 8,
    restDays: [0],
    shiftOverrides: { "2026-04-15": "shift-afternoon" },
    restOverrides: {},
    exemptions: { late: false, early: false, lunchPunch: false, overtime: false },
    salary: { type: "monthly", currency: "MYR", monthlyAmount: 3500, hourlyRate: 18, otMultiplier: 1.5, leaveDeductPerDay: 130 },
    active: true,
  },
  {
    id: "emp-002",
    enrollNo: "1002",
    workNo: "EMP-002",
    firstName: "Mei",
    lastName: "Lim",
    gender: "female",
    idNo: "930622-01-2202",
    birthDate: "1993-06-22",
    birthPlace: "Kuala Lumpur",
    address: "Cheras, Kuala Lumpur",
    nationality: "Malaysia",
    company: "Duo Demo Sdn Bhd",
    department: "餐饮",
    position: "Service Crew",
    joinDate: "2023-07-01",
    shiftId: "shift-afternoon",
    autoShift: true,
    flexibleWork: false,
    workLengthHours: 8,
    restDays: [2],
    shiftOverrides: {},
    restOverrides: {},
    exemptions: { late: false, early: false, lunchPunch: false, overtime: false },
    salary: { type: "hourly", currency: "MYR", monthlyAmount: 0, hourlyRate: 14, otMultiplier: 1.5, leaveDeductPerDay: 0 },
    active: true,
  },
  {
    id: "emp-003",
    enrollNo: "1003",
    workNo: "EMP-003",
    firstName: "Aisyah",
    lastName: "Rahman",
    gender: "female",
    idNo: "880504-08-3003",
    birthDate: "1988-05-04",
    birthPlace: "Melaka",
    address: "Bukit Beruang, Melaka",
    nationality: "Malaysia",
    company: "Duo Demo Sdn Bhd",
    department: "办公室",
    position: "HR Admin",
    joinDate: "2021-11-10",
    shiftId: "shift-office",
    autoShift: false,
    flexibleWork: true,
    workLengthHours: 8,
    restDays: [0, 6],
    shiftOverrides: {},
    restOverrides: { "2026-04-18": false },
    exemptions: { late: true, early: false, lunchPunch: false, overtime: false },
    salary: { type: "monthly", currency: "MYR", monthlyAmount: 4200, hourlyRate: 22, otMultiplier: 1.5, leaveDeductPerDay: 160 },
    active: true,
  },
  {
    id: "emp-004",
    enrollNo: "1004",
    workNo: "EMP-004",
    firstName: "Kumar",
    lastName: "Ravi",
    gender: "male",
    idNo: "950909-14-4404",
    birthDate: "1995-09-09",
    birthPlace: "Ipoh",
    address: "Silibin, Ipoh",
    nationality: "Malaysia",
    company: "Branch Two Sdn Bhd",
    department: "仓库",
    position: "Store Assistant",
    joinDate: "2024-02-12",
    shiftId: "shift-morning",
    autoShift: false,
    flexibleWork: false,
    workLengthHours: 8,
    restDays: [5],
    shiftOverrides: {},
    restOverrides: {},
    exemptions: { late: false, early: false, lunchPunch: true, overtime: false },
    salary: { type: "monthly", currency: "MYR", monthlyAmount: 2800, hourlyRate: 14, otMultiplier: 1.5, leaveDeductPerDay: 110 },
    active: true,
  },
  {
    id: "emp-005",
    enrollNo: "1005",
    workNo: "EMP-005",
    firstName: "Xin",
    lastName: "Chong",
    gender: "female",
    idNo: "960204-10-5505",
    birthDate: "1996-02-04",
    birthPlace: "Kuantan",
    address: "Indera Mahkota, Kuantan",
    nationality: "Malaysia",
    company: "Duo Demo Sdn Bhd",
    department: "餐饮",
    position: "Part Time",
    joinDate: "2025-12-01",
    shiftId: "shift-afternoon",
    autoShift: false,
    flexibleWork: false,
    workLengthHours: 8,
    restDays: [1, 3],
    shiftOverrides: {},
    restOverrides: {},
    exemptions: { late: false, early: false, lunchPunch: false, overtime: true },
    salary: { type: "hourly", currency: "MYR", monthlyAmount: 0, hourlyRate: 12, otMultiplier: 1.5, leaveDeductPerDay: 0 },
    active: false,
  },
  {
    id: "emp-006",
    enrollNo: "1006",
    workNo: "EMP-006",
    firstName: "Nadia",
    lastName: "Night",
    gender: "female",
    idNo: "970808-10-6606",
    birthDate: "1997-08-08",
    birthPlace: "Klang",
    address: "Bandar Bukit Tinggi, Klang",
    nationality: "Malaysia",
    company: "Branch Two Sdn Bhd",
    department: "仓库",
    position: "夜班操作员",
    joinDate: "2024-06-01",
    shiftId: "shift-night",
    autoShift: false,
    flexibleWork: false,
    workLengthHours: 8,
    restDays: [0],
    shiftOverrides: {},
    restOverrides: {},
    exemptions: { late: false, early: false, lunchPunch: false, overtime: false },
    salary: { type: "monthly", currency: "MYR", monthlyAmount: 3200, hourlyRate: 16, otMultiplier: 1.5, leaveDeductPerDay: 120 },
    active: true,
  },
];

function makePunch(employeeId: string, date: string, kind: PunchKind, time: string, note = ""): Punch {
  return {
    id: `${employeeId}-${date}-${kind}`,
    employeeId,
    date,
    time,
    kind,
    source: "seed",
    note,
  };
}

function seedDay(employee: Employee, date: string, start: string, end: string, variance: number): Punch[] {
  const inTime = timeFromMinutes(minutesFromTime(start) + variance);
  const outTime = timeFromMinutes(minutesFromTime(end) + Math.max(0, 8 - variance));
  return [
    makePunch(employee.id, date, "in", inTime),
    makePunch(employee.id, date, "breakOut", timeFromMinutes(minutesFromTime(start) + 180)),
    makePunch(employee.id, date, "breakIn", timeFromMinutes(minutesFromTime(start) + 240)),
    makePunch(employee.id, date, "out", outTime),
  ];
}

function seedNightDay(employee: Employee, date: string, variance: number): Punch[] {
  const nextDate = addDays(date, 1);
  const inTime = timeFromMinutes(minutesFromTime("18:00") + Math.min(variance, 12));
  const outTime = timeFromMinutes(minutesFromTime("02:00") + Math.max(0, 8 - variance));
  return [
    makePunch(employee.id, date, "in", inTime, "夜班样例"),
    makePunch(employee.id, date, "breakOut", "22:00", "夜班午休"),
    makePunch(employee.id, date, "breakIn", "23:00", "夜班午休"),
    makePunch(employee.id, nextDate, "out", outTime, "夜班跨天"),
  ];
}

function buildSeedPunches(): Punch[] {
  const shifts = [morningShift, afternoonShift, officeShift, nightShift];
  const punches: Punch[] = [];
  const activeEmployees = employees.filter((employee) => employee.active);
  const dates = monthDates("2026-04").filter((date) => date <= "2026-04-24");
  const leaveDates = new Set(["emp-002:2026-04-22", "emp-003:2026-04-17"]);
  const holidays = new Set(["2026-04-10"]);

  activeEmployees.forEach((employee, employeeIndex) => {
    const shift = shifts.find((item) => item.id === employee.shiftId) ?? morningShift;
    dates.forEach((date, dateIndex) => {
      const weekday = getWeekday(date);
      const schedule = shift.days[weekday];
      if (employee.restDays.includes(weekday) || schedule.off || holidays.has(date)) return;
      if (leaveDates.has(`${employee.id}:${date}`)) return;
      if (employee.id === "emp-001" && date === "2026-04-09") return;
      if (employee.id === "emp-002" && date === "2026-04-16") return;

      if (employee.id === "emp-004" && date === "2026-04-08") {
        punches.push(makePunch(employee.id, date, "in", "10:05", "忘记打下班"));
        return;
      }

      const variance = (employeeIndex * 4 + dateIndex * 3) % 18;
      punches.push(
        ...(employee.shiftId === "shift-night"
          ? seedNightDay(employee, date, variance)
          : seedDay(employee, date, schedule.start, schedule.end, variance)),
      );
    });
  });

  punches.push(makePunch("emp-001", "2026-04-09", "in", "10:42", "迟到样例"));
  punches.push(makePunch("emp-001", "2026-04-09", "breakOut", "13:12"));
  punches.push(makePunch("emp-001", "2026-04-09", "breakIn", "14:00"));
  punches.push(makePunch("emp-001", "2026-04-09", "out", "18:14"));

  punches.push(makePunch("emp-002", "2026-04-16", "in", "13:52"));
  punches.push(makePunch("emp-002", "2026-04-16", "breakOut", "17:31"));
  punches.push(makePunch("emp-002", "2026-04-16", "breakIn", "18:20"));
  punches.push(makePunch("emp-002", "2026-04-16", "out", "23:15", "加班样例"));

  return punches;
}

export function createSeedData(): AppData {
  return {
    employees,
    shifts: [morningShift, afternoonShift, officeShift, nightShift],
    holidays: [
      { id: "holiday-001", date: "2026-04-10", name: "Public Holiday" },
      { id: "holiday-002", date: "2026-05-01", name: "Labour Day" },
    ],
    leaves: [
      { id: "leave-001", employeeId: "emp-002", date: "2026-04-22", type: "年假", hours: 8, note: "Approved" },
      { id: "leave-002", employeeId: "emp-003", date: "2026-04-17", type: "病假", hours: 8, note: "MC" },
    ],
    punches: buildSeedPunches(),
    attendanceReviews: [],
    timecardCorrectionAudits: [],
    settings: {
      businessDate: dateKey(new Date(2026, 3, 24)),
      defaultMonth: "2026-04",
      companies: ["Duo Demo Sdn Bhd", "Branch Two Sdn Bhd"],
      departments: ["餐饮", "办公室", "仓库"],
      positions: ["Supervisor", "Service Crew", "HR Admin", "Store Assistant", "Part Time", "Night Operator"],
      nationalities: ["Malaysia", "Singapore", "Indonesia", "China", "Bangladesh", "Nepal", "Myanmar"],
      leaveTypes: ["病假", "年假", "带薪假", "无薪假"],
      paidLeaveTypes: ["年假", "带薪假"],
      correctionReasons: ["Forgot punch in", "Forgot punch out", "Wrong punch time", "Device issue", "Approved manual correction"],
      device: {
        fingerprint: true,
        face: false,
        card: true,
        model: "ZKTeco K40 (sample)",
      },
      requirePassword: true,
      usbLicenseRequired: false,
      localPasswordHint: "默认密码 1234 / Default password 1234",
      hrPassword: "1234",
      usbToken: "",
    },
  };
}
