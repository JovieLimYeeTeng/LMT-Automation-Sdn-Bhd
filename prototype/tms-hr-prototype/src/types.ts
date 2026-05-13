export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type PunchKind = "in" | "breakOut" | "breakIn" | "out";

export type Gender = "male" | "female";

export type AttendanceStatus =
  | "present"
  | "late"
  | "early"
  | "ot"
  | "incomplete"
  | "absent"
  | "leave"
  | "holiday"
  | "rest"
  | "scheduled";

export interface DaySchedule {
  start: string;
  lunchStart: string;
  lunchEnd: string;
  end: string;
  otStart: string;
  otEnd: string;
  off: boolean;
}

export interface Shift {
  id: string;
  name: string;
  code: string;
  color: string;
  flexibleWork: boolean;
  workLengthHours: number;
  flexibleLunch: boolean;
  lunchMinutes: number;
  graceMinutes: number;
  days: Record<Weekday, DaySchedule>;
}

export interface Employee {
  id: string;
  enrollNo: string;
  workNo: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  idNo: string;
  birthDate: string;
  birthPlace: string;
  address: string;
  nationality: string;
  company: string;
  department: string;
  position: string;
  joinDate: string;
  shiftId: string;
  autoShift: boolean;
  restDays: Weekday[];
  shiftOverrides: Record<string, string>;
  restOverrides: Record<string, boolean>;
  exemptions: {
    late: boolean;
    early: boolean;
    lunchPunch: boolean;
    overtime: boolean;
  };
  salary: SalaryConfig;
  active: boolean;
}

export type SalaryType = "monthly" | "hourly";

export interface SalaryConfig {
  type: SalaryType;
  currency: string;
  monthlyAmount: number;
  hourlyRate: number;
  otMultiplier: number;
  leaveDeductPerDay: number;
}

export interface PunchDeviceSettings {
  fingerprint: boolean;
  face: boolean;
  card: boolean;
  model: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export interface LeaveEntry {
  id: string;
  employeeId: string;
  date: string;
  type: string;
  hours: number;
  note: string;
}

export interface Punch {
  id: string;
  employeeId: string;
  date: string;
  time: string;
  kind: PunchKind;
  source: "manual" | "import" | "seed";
  note: string;
  rawNo?: string;
  machineNo?: string;
  deviceEnrollNo?: string;
  deviceName?: string;
  inoutCode?: string;
  verifyMode?: string;
  rawDateTime?: string;
}

export type AttendanceReviewKind = "shortHours";
export type AttendanceReviewDecision = "accepted" | "deducted";

export interface AttendanceReview {
  id: string;
  employeeId: string;
  date: string;
  kind: AttendanceReviewKind;
  decision: AttendanceReviewDecision;
  note: string;
  updatedAt: string;
}

export interface AppSettings {
  businessDate: string;
  defaultMonth: string;
  companies: string[];
  departments: string[];
  positions: string[];
  nationalities: string[];
  leaveTypes: string[];
  paidLeaveTypes: string[];
  device: PunchDeviceSettings;
  requirePassword: boolean;
  usbLicenseRequired: boolean;
  localPasswordHint: string;
  hrPassword: string;
  usbToken: string;
}

export interface AppData {
  employees: Employee[];
  shifts: Shift[];
  holidays: Holiday[];
  leaves: LeaveEntry[];
  punches: Punch[];
  attendanceReviews: AttendanceReview[];
  settings: AppSettings;
}

export type ShiftSource = "employee" | "override" | "auto";

export type FlagToken =
  | { kind: "late"; minutes: number }
  | { kind: "early"; minutes: number }
  | { kind: "ot"; minutes: number }
  | { kind: "lunchOver"; minutes: number }
  | { kind: "underWork"; hours: number }
  | { kind: "underWorkAccepted"; hours: number }
  | { kind: "underWorkDeducted"; hours: number }
  | { kind: "noRecord" }
  | { kind: "noShift" }
  | { kind: "missingPunch" }
  | { kind: "holidayWork"; name: string }
  | { kind: "holiday"; name: string }
  | { kind: "restDayWork" }
  | { kind: "restDay" }
  | { kind: "future" }
  | { kind: "inactive" }
  | { kind: "leave"; leaveType: string }
  | { kind: "ok" };

export interface AttendanceRecord {
  date: string;
  weekday: Weekday;
  employee: Employee;
  shift: Shift | undefined;
  shiftSource: ShiftSource;
  schedule: DaySchedule | undefined;
  holiday: Holiday | undefined;
  leave: LeaveEntry | undefined;
  punches: Punch[];
  clockIn: string;
  breakOut: string;
  breakIn: string;
  clockOut: string;
  clockInDayOffset: number;
  breakOutDayOffset: number;
  breakInDayOffset: number;
  clockOutDayOffset: number;
  overnight: boolean;
  workMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
  flags: FlagToken[];
  missing: boolean;
}
