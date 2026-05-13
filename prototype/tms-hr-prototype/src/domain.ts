import { dict, makeT, translateDataValue, type Lang } from "./i18n";
import type {
  AppData,
  AttendanceReviewDecision,
  AttendanceRecord,
  AttendanceStatus,
  DaySchedule,
  Employee,
  FlagToken,
  Holiday,
  LeaveEntry,
  Punch,
  PunchKind,
  Shift,
  ShiftSource,
  AttendanceReviewKind,
  Weekday,
} from "./types";

export const weekdayOrder: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const DEFAULT_PAID_LEAVE_TYPES = ["年假", "带薪假"];

export const weekdayLabels: Record<Lang, Record<Weekday, string>> = {
  zh: {
    0: dict.zh.weekday0,
    1: dict.zh.weekday1,
    2: dict.zh.weekday2,
    3: dict.zh.weekday3,
    4: dict.zh.weekday4,
    5: dict.zh.weekday5,
    6: dict.zh.weekday6,
  },
  en: {
    0: dict.en.weekday0,
    1: dict.en.weekday1,
    2: dict.en.weekday2,
    3: dict.en.weekday3,
    4: dict.en.weekday4,
    5: dict.en.weekday5,
    6: dict.en.weekday6,
  },
};

export const punchKindLabels: Record<Lang, Record<PunchKind, string>> = {
  zh: {
    in: dict.zh.punchIn,
    breakOut: dict.zh.punchBreakOut,
    breakIn: dict.zh.punchBreakIn,
    out: dict.zh.punchOut,
  },
  en: {
    in: dict.en.punchIn,
    breakOut: dict.en.punchBreakOut,
    breakIn: dict.en.punchBreakIn,
    out: dict.en.punchOut,
  },
};

export const statusLabels: Record<Lang, Record<AttendanceStatus, string>> = {
  zh: {
    present: dict.zh.statusPresent,
    late: dict.zh.statusLate,
    early: dict.zh.statusEarly,
    ot: dict.zh.statusOt,
    incomplete: dict.zh.statusIncomplete,
    absent: dict.zh.statusAbsent,
    leave: dict.zh.statusLeave,
    holiday: dict.zh.statusHoliday,
    rest: dict.zh.statusRest,
    scheduled: dict.zh.statusScheduled,
  },
  en: {
    present: dict.en.statusPresent,
    late: dict.en.statusLate,
    early: dict.en.statusEarly,
    ot: dict.en.statusOt,
    incomplete: dict.en.statusIncomplete,
    absent: dict.en.statusAbsent,
    leave: dict.en.statusLeave,
    holiday: dict.en.statusHoliday,
    rest: dict.en.statusRest,
    scheduled: dict.en.statusScheduled,
  },
};

export function formatFlag(flag: FlagToken, lang: Lang): string {
  const t = makeT(lang);
  switch (flag.kind) {
    case "late":
      return t("flagLate", { duration: formatDuration(flag.minutes) });
    case "early":
      return t("flagEarly", { duration: formatDuration(flag.minutes) });
    case "ot":
      return t("flagOT", { duration: formatDuration(flag.minutes) });
    case "lunchOver":
      return t("flagLunchOver", { duration: formatDuration(flag.minutes) });
    case "underWork":
      return t("flagUnderWork", { hours: flag.hours });
    case "underWorkAccepted":
      return t("flagUnderWorkAccepted", { hours: flag.hours });
    case "underWorkDeducted":
      return t("flagUnderWorkDeducted", { hours: flag.hours });
    case "noRecord":
      return t("flagNoRecord");
    case "noShift":
      return t("flagNoShift");
    case "missingPunch":
      return t("flagMissingPunch");
    case "holidayWork":
      return `${flag.name} / ${t("flagHolidayWork")}`;
    case "holiday":
      return flag.name;
    case "restDayWork":
      return t("flagRestDayWork");
    case "restDay":
      return t("flagRestDay");
    case "future":
      return t("flagFuture");
    case "inactive":
      return t("flagInactive");
    case "leave":
      return translateDataValue(flag.leaveType, lang);
    case "ok":
      return t("flagOk");
  }
}

export function formatFlags(flags: FlagToken[], lang: Lang, separator = " / "): string {
  return flags.map((flag) => formatFlag(flag, lang)).join(separator);
}

export function createStandardWeek(
  start: string,
  lunchStart: string,
  lunchEnd: string,
  end: string,
  otStart: string,
  offDays: Weekday[] = [0],
): Record<Weekday, DaySchedule> {
  return [0, 1, 2, 3, 4, 5, 6].reduce(
    (week, day) => {
      week[day as Weekday] = {
        start,
        lunchStart,
        lunchEnd,
        end,
        otStart,
        otEnd: "23:59",
        off: offDays.includes(day as Weekday),
      };
      return week;
    },
    {} as Record<Weekday, DaySchedule>,
  );
}

export function attendanceReviewId(employeeId: string, date: string, kind: AttendanceReviewKind): string {
  return `review-${employeeId}-${date}-${kind}`;
}

export function isAttendanceReviewAccepted(
  data: AppData,
  employeeId: string,
  date: string,
  kind: AttendanceReviewKind,
): boolean {
  return getAttendanceReviewDecision(data, employeeId, date, kind) === "accepted";
}

export function getAttendanceReviewDecision(
  data: AppData,
  employeeId: string,
  date: string,
  kind: AttendanceReviewKind,
): AttendanceReviewDecision | undefined {
  return (data.attendanceReviews ?? []).find(
    (review) =>
      review.employeeId === employeeId &&
      review.date === date &&
      review.kind === kind,
  )?.decision;
}

export function parseDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const cursor = parseDate(date);
  cursor.setDate(cursor.getDate() + days);
  return dateKey(cursor);
}

export function dateDiffDays(from: string, to: string): number {
  const dayMs = 86400000;
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / dayMs);
}

export function monthDates(month: string): string[] {
  const [year, monthIndex] = month.split("-").map(Number);
  const cursor = new Date(year, monthIndex - 1, 1);
  const dates: string[] = [];
  while (cursor.getMonth() === monthIndex - 1) {
    dates.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function getWeekday(date: string): Weekday {
  return parseDate(date).getDay() as Weekday;
}

export function minutesFromTime(time: string): number {
  if (!time) return 0;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isOvernightSchedule(schedule: DaySchedule | undefined): boolean {
  if (!schedule) return false;
  return minutesFromTime(schedule.end) <= minutesFromTime(schedule.start);
}

function scheduleTimeMinutes(schedule: DaySchedule, time: string): number {
  const minutes = minutesFromTime(time);
  return isOvernightSchedule(schedule) && minutes < minutesFromTime(schedule.start) ? minutes + 1440 : minutes;
}

function punchAbsoluteMinutes(punch: Pick<Punch, "date" | "time">, baseDate: string): number {
  return dateDiffDays(baseDate, punch.date) * 1440 + minutesFromTime(punch.time);
}

export function punchDateForAttendanceTime(
  date: string,
  schedule: DaySchedule | undefined,
  kind: PunchKind,
  time: string,
): string {
  if (!schedule || !isOvernightSchedule(schedule) || !time || kind === "in") return date;
  return minutesFromTime(time) < minutesFromTime(schedule.start) ? addDays(date, 1) : date;
}

function attendanceWindowPunches(
  punches: Punch[],
  employeeId: string,
  date: string,
  schedule: DaySchedule | undefined,
): Punch[] {
  if (!schedule || !isOvernightSchedule(schedule)) {
    return sortByDateTime(punches.filter((item) => item.employeeId === employeeId && item.date === date));
  }

  const nextDate = addDays(date, 1);
  const startMinutes = scheduleTimeMinutes(schedule, schedule.start);
  const endMinutes = scheduleTimeMinutes(schedule, schedule.end);
  const otStartMinutes = scheduleTimeMinutes(schedule, schedule.otStart || schedule.end);
  let otEndMinutes = scheduleTimeMinutes(schedule, schedule.otEnd || schedule.end);
  if (otEndMinutes <= otStartMinutes) otEndMinutes += 1440;
  const windowStart = startMinutes - 240;
  const windowEnd = Math.max(endMinutes, otStartMinutes, Math.min(otEndMinutes, endMinutes + 720));

  return punches
    .filter((item) => item.employeeId === employeeId && (item.date === date || item.date === nextDate))
    .filter((item) => {
      const absolute = punchAbsoluteMinutes(item, date);
      return absolute >= windowStart && absolute <= windowEnd;
    })
    .sort((a, b) => punchAbsoluteMinutes(a, date) - punchAbsoluteMinutes(b, date));
}

export function timeFromMinutes(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "-";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatHours(minutes: number): string {
  if (minutes <= 0) return "-";
  return (minutes / 60).toFixed(1);
}

export function displayEmployeeName(employee: Employee): string {
  return `${employee.lastName} ${employee.firstName}`.trim();
}

export function isPaidLeaveType(type: string, data?: AppData): boolean {
  const configured = data?.settings.paidLeaveTypes;
  if (configured) return configured.includes(type);

  const normalized = type.trim().toLowerCase();
  return DEFAULT_PAID_LEAVE_TYPES.some((item) => item.toLowerCase() === normalized)
    || ["annual leave", "paid leave"].includes(normalized);
}

export function sortByDateTime<T extends { date: string; time?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
}

export function normalizeShiftRules(shift: Shift): Shift {
  if (!shift.flexibleWork) return shift;
  return { ...shift, flexibleWork: false };
}

export function isAutoShiftCandidate(shift: Shift, date: string): boolean {
  const weekday = getWeekday(date);
  return !shift.days[weekday].off;
}

export function findShiftForPunch(
  shifts: Shift[],
  date: string,
  punchTime: string,
): Shift | undefined {
  const weekday = getWeekday(date);
  const punchMinutes = minutesFromTime(punchTime);

  return [...shifts]
    .filter((shift) => !shift.days[weekday].off)
    .sort((a, b) => {
      const aStart = minutesFromTime(a.days[weekday].start);
      const bStart = minutesFromTime(b.days[weekday].start);
      return Math.abs(aStart - punchMinutes) - Math.abs(bStart - punchMinutes);
    })[0];
}

export function resolveShiftForEmployee(
  data: AppData,
  employee: Employee,
  date: string,
  shiftOverrideId?: string,
): { shift: Shift | undefined; source: ShiftSource } {
  if (shiftOverrideId) {
    const shift = data.shifts.find((item) => item.id === shiftOverrideId);
    return { shift: shift ? normalizeShiftRules(shift) : undefined, source: "override" };
  }
  const perDate = employee.shiftOverrides?.[date];
  if (perDate) {
    const shift = data.shifts.find((item) => item.id === perDate);
    if (shift) {
      return { shift: normalizeShiftRules(shift), source: "override" };
    }
  }
  if (employee.autoShift && !employee.flexibleWork) {
    const firstPunch = sortByDateTime(
      data.punches.filter((item) => item.employeeId === employee.id && item.date === date),
    )[0];
    if (firstPunch) {
      const shift = findShiftForPunch(data.shifts, date, firstPunch.time);
      return { shift: shift ? normalizeShiftRules(shift) : undefined, source: "auto" };
    }
  }
  const defaultShift = data.shifts.find((item) => item.id === employee.shiftId);
  return { shift: defaultShift ? normalizeShiftRules(defaultShift) : undefined, source: "employee" };
}

export function effectiveRestDay(employee: Employee, date: string, scheduleOff: boolean): boolean {
  const override = employee.restOverrides?.[date];
  if (override === true) return true;
  if (override === false) return false;
  const weekday = getWeekday(date);
  return employee.restDays.includes(weekday) || scheduleOff;
}

function calculateHolidayWork(
  employee: Employee,
  punches: Punch[],
  shift: Shift | undefined,
  schedule: DaySchedule | undefined,
  date: string,
): Pick<AttendanceRecord, "workMinutes" | "overtimeMinutes"> {
  const byKind = (kind: PunchKind) => punches.find((item) => item.kind === kind);
  const clockInPunch = byKind("in") || punches[0];
  const clockOutPunch = byKind("out") || punches[punches.length - 1];
  const breakOutPunch = byKind("breakOut");
  const breakInPunch = byKind("breakIn");
  if (!clockInPunch || !clockOutPunch) return { workMinutes: 0, overtimeMinutes: 0 };

  const inMinutes = punchAbsoluteMinutes(clockInPunch, date);
  const outMinutes = punchAbsoluteMinutes(clockOutPunch, date);
  const { lunchMinutes } = resolveLunch(employee, shift, schedule, breakOutPunch, breakInPunch, date);
  const workMinutes = Math.max(0, outMinutes - inMinutes - lunchMinutes);
  const overtimeMinutes = employee.exemptions.overtime ? 0 : workMinutes;
  return { workMinutes, overtimeMinutes };
}

function resolveLunch(
  employee: Employee,
  shift: Shift | undefined,
  schedule: DaySchedule | undefined,
  breakOut: Punch | undefined,
  breakIn: Punch | undefined,
  date: string,
): { lunchMinutes: number; lunchOverMinutes: number } {
  if (employee.exemptions.lunchPunch) return { lunchMinutes: 0, lunchOverMinutes: 0 };

  const fallbackLunchMinutes = schedule
    ? Math.max(0, scheduleTimeMinutes(schedule, schedule.lunchEnd) - scheduleTimeMinutes(schedule, schedule.lunchStart))
    : (shift?.lunchMinutes ?? 0);
  const hasLunchPunches = Boolean(breakOut && breakIn);
  const actualLunchMinutes = hasLunchPunches
    ? Math.max(0, punchAbsoluteMinutes(breakIn!, date) - punchAbsoluteMinutes(breakOut!, date))
    : fallbackLunchMinutes;
  const lunchOverMinutes =
    hasLunchPunches && shift?.flexibleLunch ? Math.max(0, actualLunchMinutes - shift.lunchMinutes) : 0;

  return { lunchMinutes: actualLunchMinutes, lunchOverMinutes };
}

export function calculateAttendance(
  data: AppData,
  employee: Employee,
  date: string,
  shiftOverrideId?: string,
): AttendanceRecord {
  const weekday = getWeekday(date);
  const { shift, source: shiftSource } = resolveShiftForEmployee(data, employee, date, shiftOverrideId);
  const schedule = shift?.days[weekday];
  const holiday = data.holidays.find((item) => item.date === date);
  const leave = data.leaves.find((item) => item.employeeId === employee.id && item.date === date);
  const punches = attendanceWindowPunches(data.punches, employee.id, date, schedule);
  const byKind = (kind: PunchKind) => punches.find((item) => item.kind === kind);
  const clockInPunch = byKind("in") || punches[0];
  const clockOutPunch = byKind("out") || punches[punches.length - 1];
  const breakOutPunch = byKind("breakOut");
  const breakInPunch = byKind("breakIn");
  const clockIn = clockInPunch?.time ?? "";
  const clockOut = clockOutPunch?.time ?? "";
  const breakOut = breakOutPunch?.time ?? "";
  const breakIn = breakInPunch?.time ?? "";
  const futureDate = date > data.settings.businessDate;
  const isRestDay = effectiveRestDay(employee, date, schedule?.off ?? false);
  const overnight = isOvernightSchedule(schedule);

  const base: AttendanceRecord = {
    date,
    weekday,
    employee,
    shift,
    shiftSource,
    schedule,
    holiday,
    leave,
    punches,
    clockIn,
    breakOut,
    breakIn,
    clockOut,
    clockInDayOffset: clockInPunch ? Math.max(0, dateDiffDays(date, clockInPunch.date)) : 0,
    breakOutDayOffset: breakOutPunch ? Math.max(0, dateDiffDays(date, breakOutPunch.date)) : 0,
    breakInDayOffset: breakInPunch ? Math.max(0, dateDiffDays(date, breakInPunch.date)) : 0,
    clockOutDayOffset: clockOutPunch ? Math.max(0, dateDiffDays(date, clockOutPunch.date)) : 0,
    overnight,
    workMinutes: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    overtimeMinutes: 0,
    status: "present",
    flags: [],
    missing: false,
  };

  if (futureDate) {
    return { ...base, status: "scheduled", flags: [{ kind: "future" }] };
  }

  if (!employee.active) {
    return { ...base, status: "scheduled", flags: [{ kind: "inactive" }] };
  }

  if (employee.joinDate && date < employee.joinDate) {
    return { ...base, status: "scheduled", flags: [{ kind: "future" }] };
  }

  if (holiday) {
    if (punches.length > 0) {
      const extra = calculateHolidayWork(employee, punches, shift, schedule, date);
      return {
        ...base,
        ...extra,
        status: "holiday",
        flags: [{ kind: "holidayWork", name: holiday.name }],
      };
    }
    return { ...base, status: "holiday", flags: [{ kind: "holiday", name: holiday.name }] };
  }

  if (isRestDay) {
    if (punches.length > 0) {
      const extra = calculateHolidayWork(employee, punches, shift, schedule, date);
      return { ...base, ...extra, status: "rest", flags: [{ kind: "restDayWork" }] };
    }
    return { ...base, status: "rest", flags: [{ kind: "restDay" }] };
  }

  if (leave) {
    return { ...base, status: "leave", flags: [{ kind: "leave", leaveType: leave.type }] };
  }

  if (!schedule || !shift) {
    return { ...base, status: "incomplete", flags: [{ kind: "noShift" }], missing: true };
  }

  if (punches.length === 0) {
    return { ...base, status: "absent", flags: [{ kind: "noRecord" }], missing: true };
  }

  if (!clockIn || !clockOut || clockIn === clockOut) {
    return { ...base, status: "incomplete", flags: [{ kind: "missingPunch" }], missing: true };
  }

  const inMinutes = punchAbsoluteMinutes(clockInPunch!, date);
  const outMinutes = punchAbsoluteMinutes(clockOutPunch!, date);
  const startMinutes = scheduleTimeMinutes(schedule, schedule.start);
  const endMinutes = scheduleTimeMinutes(schedule, schedule.end);
  const otStartMinutes = scheduleTimeMinutes(schedule, schedule.otStart || schedule.end);
  let otEndMinutes = scheduleTimeMinutes(schedule, schedule.otEnd || "23:59");
  if (otEndMinutes <= otStartMinutes) otEndMinutes += 1440;
  const { lunchMinutes, lunchOverMinutes } = resolveLunch(employee, shift, schedule, breakOutPunch, breakInPunch, date);
  const workMinutes = Math.max(0, outMinutes - inMinutes - lunchMinutes);
  const flexibleWork = employee.flexibleWork;
  const requiredWorkHours = employee.workLengthHours || shift.workLengthHours;
  const lateMinutes =
    employee.exemptions.late || flexibleWork
      ? 0
      : Math.max(0, inMinutes - startMinutes - shift.graceMinutes);
  const earlyMinutes =
    employee.exemptions.early || flexibleWork ? 0 : Math.max(0, endMinutes - outMinutes);
  const overtimeMinutes = employee.exemptions.overtime
    ? 0
    : Math.max(0, Math.min(outMinutes, otEndMinutes) - otStartMinutes);
  const flags: FlagToken[] = [];

  if (lateMinutes > 0) flags.push({ kind: "late", minutes: lateMinutes });
  if (earlyMinutes > 0) flags.push({ kind: "early", minutes: earlyMinutes });
  if (overtimeMinutes > 0) flags.push({ kind: "ot", minutes: overtimeMinutes });
  if (lunchOverMinutes > 0) flags.push({ kind: "lunchOver", minutes: lunchOverMinutes });
  if (flexibleWork && workMinutes < requiredWorkHours * 60) {
    const shortHoursDecision = getAttendanceReviewDecision(data, employee.id, date, "shortHours");
    flags.push({
      kind:
        shortHoursDecision === "accepted"
          ? "underWorkAccepted"
          : shortHoursDecision === "deducted"
            ? "underWorkDeducted"
            : "underWork",
      hours: requiredWorkHours,
    });
  }

  let status: AttendanceStatus = "present";
  if (lateMinutes > 0) status = "late";
  if (earlyMinutes > 0 && status === "present") status = "early";
  if (overtimeMinutes > 0 && status === "present") status = "ot";

  return {
    ...base,
    workMinutes,
    lateMinutes,
    earlyMinutes,
    overtimeMinutes,
    status,
    flags: flags.length ? flags : [{ kind: "ok" }],
  };
}

export function getRecordsForMonth(data: AppData, month: string, employees = data.employees): AttendanceRecord[] {
  return employees.flatMap((employee) => monthDates(month).map((date) => calculateAttendance(data, employee, date)));
}

export function makePunchId(employeeId: string, date: string, kind: PunchKind): string {
  return `${employeeId}-${date}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function payrollFor(data: AppData, employee: Employee, month: string) {
  const summary = summarizeEmployee(data, employee, month);
  const workHours = summary.workMinutes / 60;
  const otHours = summary.overtimeMinutes / 60;
  const baseHours = Math.max(0, workHours - otHours);

  // Pro-ration: monthly-salary employees only earn the share of the month they
  // were on the payroll. If join date is mid-month, base is scaled by
  // (calendar days from max(monthStart, joinDate) to monthEnd) / totalMonthDays.
  const dates = monthDates(month);
  const monthStart = dates[0] ?? `${month}-01`;
  const monthEnd = dates[dates.length - 1] ?? monthStart;
  const totalMonthDays = dates.length || 1;
  const effectiveStart =
    employee.joinDate && employee.joinDate > monthStart ? employee.joinDate : monthStart;
  const dayMs = 86400000;
  const proratedDays =
    effectiveStart > monthEnd
      ? 0
      : Math.max(
          0,
          Math.round((parseDate(monthEnd).getTime() - parseDate(effectiveStart).getTime()) / dayMs) + 1,
        );
  const proration = Math.min(1, proratedDays / totalMonthDays);

  const monthlyBase = employee.salary.monthlyAmount * proration;
  const paidLeaveHours = summary.paidLeaveHours;
  const base =
    employee.salary.type === "monthly"
      ? monthlyBase
      : (baseHours + paidLeaveHours) * employee.salary.hourlyRate;
  const otPay = otHours * employee.salary.hourlyRate * employee.salary.otMultiplier;
  const absentDeduct =
    employee.salary.type === "monthly" ? summary.absentDays * employee.salary.leaveDeductPerDay : 0;
  const unpaidLeaveDeduct =
    employee.salary.type === "monthly" ? summary.deductibleLeaveDays * employee.salary.leaveDeductPerDay : 0;
  const shortHoursDeduct =
    employee.salary.type === "monthly" ? (summary.deductedShortHoursMinutes / 60) * employee.salary.hourlyRate : 0;
  const totalDeduct = absentDeduct + unpaidLeaveDeduct + shortHoursDeduct;
  const leaveDeduct = unpaidLeaveDeduct;
  const gross = base + otPay - totalDeduct;
  const warningFlags = [
    summary.missingCount > 0 ? "missing" : "",
    summary.absentDays > 0 ? "absent" : "",
    summary.shortHoursCount > 0 ? "shortHours" : "",
    summary.acceptedShortHoursCount > 0 ? "acceptedShortHours" : "",
    summary.deductedShortHoursCount > 0 ? "deductedShortHours" : "",
    summary.lateCount > 0 || summary.earlyCount > 0 ? "lateEarly" : "",
    summary.overtimeMinutes > 0 ? "overtime" : "",
    summary.deductibleLeaveDays > 0 ? "unpaidLeave" : "",
  ].filter(Boolean);

  return {
    employee,
    summary,
    workHours,
    otHours,
    baseHours,
    proration,
    proratedDays,
    totalMonthDays,
    base,
    otPay,
    absentDeduct,
    unpaidLeaveDeduct,
    shortHoursDeduct,
    leaveDeduct,
    totalDeduct,
    gross,
    warningFlags,
    currency: employee.salary.currency || "MYR",
  };
}

export function getMonthlyReadiness(data: AppData, month: string, employees = data.employees) {
  const records = getRecordsForMonth(data, month, employees.filter((employee) => employee.active));
  const monthPunchIds = new Set(records.flatMap((record) => record.punches.map((punch) => punch.id)));
  const monthPunchCount = monthPunchIds.size;
  const monthLeaveCount = data.leaves.filter((leave) => leave.date.startsWith(month)).length;
  const missingCount = records.filter((record) => record.status === "incomplete").length;
  const absentCount = records.filter((record) => record.status === "absent").length;
  const shortHoursCount = records.filter((record) => record.flags.some((flag) => flag.kind === "underWork")).length;
  const lateEarlyCount = records.filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0).length;
  const lunchOverCount = records.filter((record) => record.flags.some((flag) => flag.kind === "lunchOver")).length;
  const overtimeCount = records.filter((record) => record.overtimeMinutes > 0).length;
  const unresolvedCount = missingCount + absentCount + shortHoursCount + lateEarlyCount + lunchOverCount + overtimeCount;
  const hasOperationalData = monthPunchCount > 0 || monthLeaveCount > 0;

  return {
    hasOperationalData,
    monthPunchCount,
    monthLeaveCount,
    missingCount: hasOperationalData ? missingCount : 0,
    absentCount: hasOperationalData ? absentCount : 0,
    shortHoursCount: hasOperationalData ? shortHoursCount : 0,
    lateEarlyCount: hasOperationalData ? lateEarlyCount : 0,
    lunchOverCount: hasOperationalData ? lunchOverCount : 0,
    overtimeCount: hasOperationalData ? overtimeCount : 0,
    unresolvedCount: hasOperationalData ? unresolvedCount : 0,
    status: !hasOperationalData ? "empty" : unresolvedCount > 0 ? "pending" : "ready",
  } as const;
}

export function summarizeEmployee(data: AppData, employee: Employee, month: string) {
  const records = monthDates(month).map((date) => calculateAttendance(data, employee, date));
  const leaveRecords = records.filter((record) => record.status === "leave" && record.leave);
  return {
    employee,
    workDays: records.filter((record) => ["present", "late", "early", "ot", "incomplete"].includes(record.status))
      .length,
    absentDays: records.filter((record) => record.status === "absent").length,
    leaveDays: leaveRecords.length,
    paidLeaveDays: leaveRecords.filter((record) => isPaidLeaveType(record.leave!.type, data)).length,
    paidLeaveHours: leaveRecords
      .filter((record) => isPaidLeaveType(record.leave!.type, data))
      .reduce((sum, record) => sum + record.leave!.hours, 0),
    deductibleLeaveDays: leaveRecords.filter((record) => !isPaidLeaveType(record.leave!.type, data)).length,
    lateCount: records.filter((record) => record.lateMinutes > 0).length,
    earlyCount: records.filter((record) => record.earlyMinutes > 0).length,
    missingCount: records.filter((record) => record.status === "incomplete").length,
    shortHoursCount: records.filter((record) => record.flags.some((flag) => flag.kind === "underWork")).length,
    acceptedShortHoursCount: records.filter((record) => record.flags.some((flag) => flag.kind === "underWorkAccepted")).length,
    deductedShortHoursCount: records.filter((record) => record.flags.some((flag) => flag.kind === "underWorkDeducted")).length,
    deductedShortHoursMinutes: records.reduce((sum, record) => {
      const deductedFlag = record.flags.find((flag) => flag.kind === "underWorkDeducted");
      if (!deductedFlag || record.workMinutes <= 0) return sum;
      return sum + Math.max(0, deductedFlag.hours * 60 - record.workMinutes);
    }, 0),
    workMinutes: records.reduce((sum, record) => sum + record.workMinutes, 0),
    overtimeMinutes: records.reduce((sum, record) => sum + record.overtimeMinutes, 0),
  };
}

export function parsePunchKind(value: string): PunchKind | undefined {
  const normalized = value.trim().toLowerCase();
  if (["in", "checkin", "check-in", "上班", "ci"].includes(normalized)) return "in";
  if (["breakout", "break-out", "lunchout", "午饭出", "bo"].includes(normalized)) return "breakOut";
  if (["breakin", "break-in", "lunchin", "午饭回", "bi"].includes(normalized)) return "breakIn";
  if (["out", "checkout", "check-out", "下班", "co"].includes(normalized)) return "out";
  return undefined;
}

export function holidayForDate(holidays: Holiday[], date: string): Holiday | undefined {
  return holidays.find((holiday) => holiday.date === date);
}

export function leaveForDate(leaves: LeaveEntry[], employeeId: string, date: string): LeaveEntry | undefined {
  return leaves.find((leave) => leave.employeeId === employeeId && leave.date === date);
}
