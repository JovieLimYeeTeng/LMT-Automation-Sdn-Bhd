import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  CreditCard,
  Database,
  Download,
  FileText,
  FileSpreadsheet,
  Fingerprint,
  KeyRound,
  ListFilter,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  Printer,
  RefreshCcw,
  Save,
  ScanFace,
  Search,
  Settings2,
  Shuffle,
  Trash2,
  Unlock,
  Upload,
  Users,
  Wallet,
  Wand2,
  WifiOff,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  calculateAttendance,
  calculateRuleDeductionAmount,
  DEFAULT_PAID_LEAVE_TYPES,
  attendanceReviewId,
  displayEmployeeName,
  findShiftForPunch,
  formatDuration,
  formatFlag,
  formatFlags,
  formatHours,
  formatHoursLabel,
  getDeductionReviewItems,
  getMonthlyReadiness,
  getRecordsForMonth,
  getWeekday,
  isAutoShiftCandidate,
  isMcRequiredLeaveType,
  isPaidLeaveType,
  leaveNeedsDeductionReview,
  makePunchId,
  monthDates,
  minutesFromTime,
  normalizeShiftRules,
  parsePunchKind,
  payrollFor,
  punchDateForAttendanceTime,
  punchKindLabels,
  resolvedLeaveApprovalStatus,
  resolvedLeaveMcStatus,
  statusLabels,
  summarizeEmployee,
  type DeductionReviewItem,
  type DeductionReviewOccurrence,
  weekdayLabels,
  weekdayOrder,
} from "./domain";
import { createSeedData } from "./seed";
import {
  dict,
  LANG_STORAGE_KEY,
  loadInitialLang,
  makeT,
  normalizeDataValue,
  translate,
  translateDataValue,
  type Lang,
} from "./i18n";
import { buildXlsxReportBuffer, XLSX_MIME_TYPE as XLSX_WORKBOOK_MIME_TYPE } from "./xlsxExport";
import { buildDocxReportBuffer, buildPunchGridDocxReportBuffer, DOCX_MIME_TYPE } from "./docxExport";
import {
  dedupeTimecardCorrectionAudits,
  normalizeTimecardCorrectionAudit,
  timecardCorrectionTargetId,
  upsertTimecardCorrectionAudit,
} from "./timecardCorrections";
import type {
  AppData,
  AttendanceReview,
  AttendanceReviewAmountMode,
  AttendanceReviewDecision,
  AttendanceReviewKind,
  AttendanceRecord,
  DeductionAmountOption,
  DeductionAmountSettings,
  DaySchedule,
  Employee,
  Gender,
  LeaveEntry,
  LeaveAuditEntry,
  LeaveMcAttachment,
  LeaveMcAuditEntry,
  Punch,
  PunchKind,
  Shift,
  TimecardCorrectionAudit,
  TimecardCorrectionAuditPunch,
  Weekday,
} from "./types";

const STORAGE_KEY = "tms-hr-prototype-state-v2";
const SESSION_KEY = "tms-hr-prototype-session-v1";
const FOCUS_EMPLOYEE_KEY = "tms-hr-focus-employee-v1";

type ViewId = "thisMonth" | "employees" | "reports" | "settings";
type MonthStage = "home" | "import" | "timecards" | "leave" | "payroll";
type ConditionWorkMode = "fixed" | "auto" | "flexible";
type EmployeeStatusFilter = "all" | "active" | "inactive";
type EmployeeReviewFilter = "all" | "missing" | "absent" | "shortHours" | "lateEarly" | "lunch" | "ot" | "unpaidLeave";
type LeaveFormDraft = {
  employeeId: string;
  date: string;
  type: string;
  hours: number;
  mcStatus: NonNullable<LeaveEntry["mcStatus"]>;
  approvalStatus: NonNullable<LeaveEntry["approvalStatus"]>;
  mcAttachment?: LeaveMcAttachment;
  note: string;
};

const VIEW_IDS: ReadonlyArray<ViewId> = [
  "thisMonth",
  "employees",
  "reports",
  "settings",
];

const MONTH_STAGES: ReadonlyArray<MonthStage> = ["home", "import", "timecards", "leave", "payroll"];

type SettingsTab = "shifts" | "holidays" | "permissions" | "devices" | "lists" | "data";
const SETTINGS_TABS: ReadonlyArray<SettingsTab> = ["shifts", "holidays", "permissions", "devices", "lists", "data"];
const emptyPunchTimes: Record<PunchKind, string> = { in: "", breakOut: "", breakIn: "", out: "" };
const LEGACY_SHIFT_ID_REPLACEMENTS: Record<string, string> = {
  "shift-office": "shift-morning",
};
const defaultExemptions: Employee["exemptions"] = { late: false, early: false, lunchPunch: false, overtime: false };
const defaultEmployeeFilters = {
  status: "all" as EmployeeStatusFilter,
  company: "all",
  department: "all",
  position: "all",
  shiftId: "all",
  enrollFrom: "",
  enrollTo: "",
  birthFrom: "",
  birthTo: "",
};

const defaultDeviceSettings = {
  fingerprint: true,
  face: false,
  card: true,
  model: "",
};

const defaultDeductionAmountSettings: DeductionAmountSettings = {
  source: "settings",
  fullDayDeductPerDay: 130,
  minuteDeductHourlyRate: 18,
};

function formatDecimalHours(hours: number, lang: Lang): string {
  return lang === "zh" ? `${hours.toFixed(2)}小时` : `${hours.toFixed(2)}h`;
}

function normalizeDataList(values: string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map(normalizeDataValue).filter(Boolean)));
}

function buildPositionList(raw: AppData, seed: AppData): string[] {
  return normalizeDataList([
    ...(raw.settings.positions ?? []),
    ...seed.settings.positions,
    ...raw.employees.map((employee) => employee.position),
    ...seed.employees.map((employee) => employee.position),
  ]);
}

function buildNationalityList(raw: AppData, seed: AppData): string[] {
  return normalizeDataList([
    ...(raw.settings.nationalities ?? []),
    ...seed.settings.nationalities,
    ...raw.employees.map((employee) => employee.nationality),
    ...seed.employees.map((employee) => employee.nationality),
  ]);
}

function buildCorrectionReasonList(raw: AppData, seed: AppData): string[] {
  return normalizeDataList([
    ...(raw.settings.correctionReasons ?? []),
    ...seed.settings.correctionReasons,
  ]);
}

function buildDeductionReasonList(raw: AppData, seed: AppData): string[] {
  return normalizeDataList([
    ...(raw.settings.deductionReasons ?? []),
    ...seed.settings.deductionReasons,
  ]);
}

function normalizeDeductionAmountOptions(options: DeductionAmountOption[] | undefined): DeductionAmountOption[] {
  const seen = new Set<string>();
  return (options ?? []).flatMap((option) => {
    const label = normalizeDataValue(option.label);
    const amount = Number(option.amount);
    if (!label || !Number.isFinite(amount) || amount < 0 || seen.has(label)) return [];
    seen.add(label);
    return [{
      id: option.id || `deduct-option-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || Date.now()}`,
      label,
      amount,
    }];
  });
}

function migrateShiftId(shiftId: string): string {
  return LEGACY_SHIFT_ID_REPLACEMENTS[shiftId] ?? shiftId;
}

function migrateShiftOverrides(overrides: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).map(([date, shiftId]) => [date, migrateShiftId(shiftId)]),
  );
}

function normalizeEmployeeConditions(employee: Employee): Employee {
  return {
    ...employee,
    autoShift: employee.flexibleWork ? false : employee.autoShift,
    workLengthHours: Math.max(1, employee.workLengthHours || 8),
    lunchMinutes: Math.max(0, employee.lunchMinutes || 0),
    graceMinutes: Math.max(0, employee.graceMinutes || 0),
  };
}

function compareEmployeeNo(value: string, boundary: string): number {
  const valueNumber = Number(value);
  const boundaryNumber = Number(boundary);
  if (Number.isFinite(valueNumber) && Number.isFinite(boundaryNumber)) {
    return valueNumber - boundaryNumber;
  }
  return value.localeCompare(boundary, undefined, { numeric: true, sensitivity: "base" });
}

function hydrateEmployee(raw: Employee, legacyShift?: Shift): Employee {
  const legacyFlexibleWork = Boolean(legacyShift?.flexibleWork);
  return normalizeEmployeeConditions({
    ...raw,
    nationality: normalizeDataValue(raw.nationality),
    department: normalizeDataValue(raw.department),
    position: normalizeDataValue(raw.position),
    shiftId: migrateShiftId(raw.shiftId),
    autoShift: raw.autoShift ?? false,
    flexibleWork: raw.flexibleWork ?? legacyFlexibleWork,
    workLengthHours: raw.workLengthHours ?? legacyShift?.workLengthHours ?? 8,
    flexibleLunch: raw.flexibleLunch ?? legacyShift?.flexibleLunch ?? false,
    lunchMinutes: raw.lunchMinutes ?? legacyShift?.lunchMinutes ?? 60,
    graceMinutes: raw.graceMinutes ?? legacyShift?.graceMinutes ?? 0,
    shiftOverrides: migrateShiftOverrides(raw.shiftOverrides),
    restOverrides: raw.restOverrides ?? {},
    salary: raw.salary ?? {
      type: "monthly",
      currency: "MYR",
      monthlyAmount: 0,
      hourlyRate: 0,
      otMultiplier: 1.5,
      leaveDeductPerDay: 0,
    },
  });
}

function hydrateShift(raw: Shift): Shift {
  return normalizeShiftRules({
    ...raw,
    name: normalizeDataValue(raw.name),
  });
}

function isLegacySeedShift(raw: Shift): boolean {
  const monday = raw.days?.[1];
  if (!monday) return false;
  if (raw.id === "shift-office") return raw.flexibleWork || ["Admin shift", "行政班"].includes(raw.name);
  if (raw.id === "shift-morning") return monday.start === "10:00" && monday.end === "18:00";
  if (raw.id === "shift-afternoon") return monday.start === "14:00" && monday.end === "22:00";
  if (raw.id === "shift-night") return monday.start === "22:00" && monday.end === "07:00";
  return false;
}

function migrateSeedShift(raw: Shift, seedShift: Shift | undefined): Shift | undefined {
  if (raw.id === "shift-office") return undefined;
  return seedShift && isLegacySeedShift(raw) ? seedShift : raw;
}

function hydrateLeave(raw: LeaveEntry): LeaveEntry {
  const mcStatuses: Array<NonNullable<LeaveEntry["mcStatus"]>> = ["provided", "notProvided", "pending", "notRequired"];
  const approvalStatuses: Array<NonNullable<LeaveEntry["approvalStatus"]>> = ["approved", "pending", "rejected"];
  const auditActions: LeaveMcAuditEntry["action"][] = ["upload", "change", "remove", "mcStatus", "approvalStatus", "field", "delete"];
  return {
    ...raw,
    type: normalizeDataValue(raw.type),
    note: normalizeDataValue(raw.note),
    mcStatus: raw.mcStatus && mcStatuses.includes(raw.mcStatus) ? raw.mcStatus : undefined,
    approvalStatus: raw.approvalStatus && approvalStatuses.includes(raw.approvalStatus) ? raw.approvalStatus : undefined,
    mcAttachment: raw.mcAttachment && raw.mcAttachment.dataUrl
      ? {
          ...raw.mcAttachment,
          name: normalizeDataValue(raw.mcAttachment.name),
          uploadedBy: raw.mcAttachment.uploadedBy ? normalizeDataValue(raw.mcAttachment.uploadedBy) : "HR",
        }
      : undefined,
    mcAuditTrail: (raw.mcAuditTrail ?? [])
      .filter((entry) => auditActions.includes(entry.action))
      .map((entry) => ({
        ...entry,
        actor: entry.actor ? normalizeDataValue(entry.actor) : "HR",
        oldValue: entry.oldValue ? normalizeDataValue(entry.oldValue) : undefined,
        newValue: entry.newValue ? normalizeDataValue(entry.newValue) : undefined,
      })),
  };
}

function hydrateLeaveAudit(raw: LeaveAuditEntry): LeaveAuditEntry {
  const auditActions: LeaveAuditEntry["action"][] = ["create", "update", "delete"];
  return {
    ...raw,
    action: auditActions.includes(raw.action) ? raw.action : "update",
    actor: raw.actor ? normalizeDataValue(raw.actor) : "HR",
    field: raw.field ? normalizeDataValue(raw.field) : undefined,
    oldValue: raw.oldValue ? normalizeDataValue(raw.oldValue) : undefined,
    newValue: raw.newValue ? normalizeDataValue(raw.newValue) : undefined,
    remark: raw.remark ? normalizeDataValue(raw.remark) : undefined,
  };
}

function hydratePunch(raw: Punch): Punch {
  return { ...raw, note: normalizeDataValue(raw.note) };
}

function hydrateAttendanceReview(raw: AttendanceReview): AttendanceReview {
  const legacyRaw = raw as Omit<AttendanceReview, "amountMode"> & {
    amountMode?: AttendanceReviewAmountMode | "suggested" | "custom";
    suggestedPayrollImpact?: number;
  };
  const rawAmountMode = legacyRaw.amountMode;
  const amountMode: AttendanceReviewAmountMode | undefined =
    rawAmountMode === "suggested"
      ? "rules"
      : rawAmountMode === "custom"
        ? "settingsOption"
        : rawAmountMode;
  return {
    ...raw,
    note: normalizeDataValue(raw.note),
    reviewedBy: raw.reviewedBy ?? "",
    amountMode,
    ruleDeductionAmount: raw.ruleDeductionAmount ?? legacyRaw.suggestedPayrollImpact,
    finalDeductionAmount: raw.finalDeductionAmount ?? raw.payrollImpact,
    deductionOptionId: raw.deductionOptionId,
    deductionOptionLabel: raw.deductionOptionLabel ? normalizeDataValue(raw.deductionOptionLabel) : undefined,
    relatedLeaveType: raw.relatedLeaveType ? normalizeDataValue(raw.relatedLeaveType) : undefined,
    relatedCorrectionReason: raw.relatedCorrectionReason ? normalizeDataValue(raw.relatedCorrectionReason) : undefined,
  };
}

function hydrateTimecardCorrectionAudit(raw: TimecardCorrectionAudit): TimecardCorrectionAudit {
  return normalizeTimecardCorrectionAudit({ ...raw, reason: normalizeDataValue(raw.reason) });
}

function hydrateData(raw: AppData): AppData {
  const leaveTypes = normalizeDataList(raw.settings.leaveTypes);
  const paidLeaveTypes = normalizeDataList(raw.settings.paidLeaveTypes);
  const seed = createSeedData();
  const mcRequiredLeaveTypes = normalizeDataList(raw.settings.mcRequiredLeaveTypes ?? seed.settings.mcRequiredLeaveTypes)
    .filter((type) => leaveTypes.includes(type));
  const positions = buildPositionList(raw, seed);
  const nationalities = buildNationalityList(raw, seed);
  const correctionReasons = buildCorrectionReasonList(raw, seed);
  const deductionReasons = buildDeductionReasonList(raw, seed);
  const deductionAmountOptions = normalizeDeductionAmountOptions([
    ...(raw.settings.deductionAmountOptions ?? []),
    ...seed.settings.deductionAmountOptions,
  ]);
  const rawEmployeeIds = new Set(raw.employees.map((employee) => employee.id));
  const rawShiftById = new Map(raw.shifts.map((shift) => [shift.id, shift]));
  const seedShiftById = new Map(seed.shifts.map((shift) => [shift.id, shift]));
  const migratedRawShifts = raw.shifts.flatMap((shift) => {
    const migrated = migrateSeedShift(shift, seedShiftById.get(shift.id));
    return migrated ? [migrated] : [];
  });
  const migratedRawShiftIds = new Set(migratedRawShifts.map((shift) => shift.id));
  return {
    ...raw,
    employees: [
      ...raw.employees.map((employee) => hydrateEmployee(employee, rawShiftById.get(employee.shiftId))),
      ...seed.employees.filter((employee) => !rawEmployeeIds.has(employee.id)).map((employee) => hydrateEmployee(employee, seedShiftById.get(employee.shiftId))),
    ],
    shifts: [
      ...migratedRawShifts.map(hydrateShift),
      ...seed.shifts.filter((shift) => !migratedRawShiftIds.has(shift.id)).map(hydrateShift),
    ],
    leaves: raw.leaves.map(hydrateLeave),
    leaveAuditTrail: (raw.leaveAuditTrail ?? []).map(hydrateLeaveAudit),
    punches: raw.punches.map(hydratePunch),
    attendanceReviews: (raw.attendanceReviews ?? []).map(hydrateAttendanceReview),
    timecardCorrectionAudits: dedupeTimecardCorrectionAudits((raw.timecardCorrectionAudits ?? []).map(hydrateTimecardCorrectionAudit)),
    settings: {
      ...raw.settings,
      departments: normalizeDataList(raw.settings.departments),
      positions,
      nationalities,
      leaveTypes,
      paidLeaveTypes: paidLeaveTypes.length ? paidLeaveTypes : DEFAULT_PAID_LEAVE_TYPES.filter((type) => leaveTypes.includes(type)),
      mcRequiredLeaveTypes,
      correctionReasons,
      deductionReasons,
      deductionAmounts: {
        ...defaultDeductionAmountSettings,
        ...(raw.settings.deductionAmounts ?? {}),
        source: "settings",
        fullDayDeductPerDay: Math.max(0, raw.settings.deductionAmounts?.fullDayDeductPerDay ?? defaultDeductionAmountSettings.fullDayDeductPerDay),
        minuteDeductHourlyRate: Math.max(0, raw.settings.deductionAmounts?.minuteDeductHourlyRate ?? defaultDeductionAmountSettings.minuteDeductHourlyRate),
      },
      deductionAmountOptions,
      device: {
        ...defaultDeviceSettings,
        ...(raw.settings.device ?? {}),
      },
      hrPassword: raw.settings.hrPassword ?? "1234",
      usbToken: raw.settings.usbToken ?? "",
      localPasswordHint:
        raw.settings.localPasswordHint && raw.settings.localPasswordHint.trim().length > 0
          ? normalizeDataValue(raw.settings.localPasswordHint)
          : "Default password 1234",
    },
  };
}

type ReportId = "personal" | "summary" | "punchGrid" | "lateEarly" | "leave" | "overtime" | "absent" | "raw";
type TimecardStatusFilter = "all" | "absent" | "incomplete" | "shortHours" | "lateEarly" | "unpaidLeave";
type TimecardWorkflowTab = "monthly" | "deduction" | "fix" | "audit";
type TimecardQueueMode = "employee" | "date";
type TimecardWorkflowPrompt =
  | { kind: "deductionSaved"; itemId: string; nextItemId?: string; needsFix: boolean }
  | { kind: "fixSaved"; stillPending: boolean }
  | { kind: "fixCleared" };

const copy = dict;

const navItems: Array<{ id: ViewId; label: Record<Lang, string>; icon: LucideIcon }> = [
  { id: "thisMonth", label: { zh: dict.zh.navThisMonth, en: dict.en.navThisMonth }, icon: CalendarClock },
  { id: "employees", label: { zh: dict.zh.navEmployees, en: dict.en.navEmployees }, icon: Users },
  { id: "reports", label: { zh: dict.zh.navReports, en: dict.en.navReports }, icon: FileSpreadsheet },
  { id: "settings", label: { zh: dict.zh.navSettings, en: dict.en.navSettings }, icon: Settings2 },
];

const reportOptions: Array<{ id: ReportId; label: Record<Lang, string> }> = [
  { id: "summary", label: { zh: dict.zh.reportSummary, en: dict.en.reportSummary } },
  { id: "punchGrid", label: { zh: dict.zh.reportPunchGrid, en: dict.en.reportPunchGrid } },
  { id: "personal", label: { zh: dict.zh.reportPersonal, en: dict.en.reportPersonal } },
  { id: "raw", label: { zh: dict.zh.reportRaw, en: dict.en.reportRaw } },
  { id: "lateEarly", label: { zh: dict.zh.reportLateEarly, en: dict.en.reportLateEarly } },
  { id: "leave", label: { zh: dict.zh.reportLeave, en: dict.en.reportLeave } },
  { id: "overtime", label: { zh: dict.zh.reportOvertime, en: dict.en.reportOvertime } },
  { id: "absent", label: { zh: dict.zh.reportAbsent, en: dict.en.reportAbsent } },
];

function loadInitialData(): AppData {
  // Demo behavior: punches and leaves are transient — every page reload starts
  // with an empty attendance state so the import / correction / payroll flow
  // can be walked through cleanly each time. Employees, shifts, holidays,
  // settings persist across reloads via localStorage.
  const saved = window.localStorage.getItem(STORAGE_KEY);
  const base = (() => {
    if (!saved) return createSeedData();
    try { return hydrateData(JSON.parse(saved) as AppData); }
    catch { return createSeedData(); }
  })();
  return { ...base, punches: [], leaves: [], attendanceReviews: [], timecardCorrectionAudits: [] };
}

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function reportColumnClassName(column: string): string {
  if (/\u5907\u6CE8|\u539F\u56E0|\u8BF4\u660E|\u63CF\u8FF0|remark|reason|description|note|notes|warning/i.test(column)) {
    return "report-text-col";
  }
  if (/\u59D3\u540D|name/i.test(column)) return "report-name-col";
  if (/\u7F16\u53F7|\u5DE5\u53F7|employee\s*no|enroll|machine\s*no|raw\s*no/i.test(column)) return "report-id-col";
  return "report-center-col";
}

function reportCellClassName(column: string, value: string | number | undefined): string {
  return cx(
    reportColumnClassName(column),
    typeof value === "string" && value.includes("\n") && "report-multiline-col",
  );
}

type ReportRow = Record<string, string | number>;

const PUNCH_GRID_FIXED_COLUMNS = 4;
const PUNCH_GRID_PRINT_GROUP_SIZE = 7;
const PUNCH_GRID_PRINT_MISSING_LINE = "-----";
const PUNCH_GRID_DETAIL_PRINT_ROW_LIMIT = 2;

type PunchGridPrintDay = {
  day: string;
  label: string;
  value: string;
};

type PunchGridPrintWeek = {
  label: string;
  days: PunchGridPrintDay[];
};

type PunchGridPrintEmployee = {
  employeeNoLabel: string;
  employeeNo: string | number;
  nameLabel: string;
  name: string | number;
  departmentLabel: string;
  department: string | number;
  shiftLabel: string;
  shift: string | number;
  heading: string;
  weeks: PunchGridPrintWeek[];
};

type PunchGridPrintLayout = "employee" | "matrix";

type PunchGridPrintMatrixWeek = {
  label: string;
  days: Array<{ day: string; label: string }>;
  rows: Array<{
    key: string;
    employeeNo: string | number;
    name: string | number;
    department: string | number;
    shift: string | number;
    dayValues: PunchGridPrintDay[];
  }>;
};

function punchGridRangeLabel(dayColumns: string[], lang: Lang): string {
  const start = dayColumns[0] ?? "";
  const end = dayColumns[dayColumns.length - 1] ?? start;
  return translate(lang, "punchGridDaysRange", { start, end });
}

function punchGridDayPrintLabel(day: string, lang: Lang): string {
  return translate(lang, "punchGridDayHeader", { day });
}

function compactPunchGridPrintValue(value: string | number | undefined, lang: Lang): string {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return "-";

  const labels = [
    translate(lang, "punchGridInShort"),
    translate(lang, "punchGridLunchOutShort"),
    translate(lang, "punchGridLunchInShort"),
    translate(lang, "punchGridOutShort"),
  ];
  const missingText = translate(lang, "punchGridMissingShort");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasPunchLabels = lines.some((line) => labels.some((label) => line === label || line.startsWith(`${label} `)));

  if (!hasPunchLabels) return text;

  return labels.map((label) => {
    const line = lines.find((candidate) => candidate === label || candidate.startsWith(`${label} `));
    if (!line) return PUNCH_GRID_PRINT_MISSING_LINE;
    const punchTime = line.slice(label.length).trim();
    if (!punchTime || punchTime === "-" || punchTime === missingText) return PUNCH_GRID_PRINT_MISSING_LINE;
    return punchTime;
  }).join("\n");
}

function punchGridEmployeePrintSections(columns: string[], rows: ReportRow[], lang: Lang): PunchGridPrintEmployee[] {
  if (columns.length <= PUNCH_GRID_FIXED_COLUMNS) return [];
  const [employeeNoColumn, nameColumn, departmentColumn, shiftColumn] = columns;
  const dayColumns = columns.slice(PUNCH_GRID_FIXED_COLUMNS);

  return rows.map((row) => {
    const employeeNo = row[employeeNoColumn] ?? "";
    const name = row[nameColumn] ?? "";
    const department = row[departmentColumn] ?? "";
    const shift = row[shiftColumn] ?? "";
    const weeks: PunchGridPrintWeek[] = [];

    for (let index = 0; index < dayColumns.length; index += PUNCH_GRID_PRINT_GROUP_SIZE) {
      const days = dayColumns.slice(index, index + PUNCH_GRID_PRINT_GROUP_SIZE);
      weeks.push({
        label: punchGridRangeLabel(days, lang),
        days: days.map((day) => ({
          day,
          label: punchGridDayPrintLabel(day, lang),
          value: compactPunchGridPrintValue(row[day], lang),
        })),
      });
    }

    return {
      employeeNoLabel: employeeNoColumn,
      employeeNo,
      nameLabel: nameColumn,
      name,
      departmentLabel: departmentColumn,
      department,
      shiftLabel: shiftColumn,
      shift,
      heading: `${name} (${employeeNo}) | ${department} | ${shift}`,
      weeks,
    };
  });
}

function punchGridMatrixPrintWeeks(columns: string[], rows: ReportRow[], lang: Lang): PunchGridPrintMatrixWeek[] {
  if (columns.length <= PUNCH_GRID_FIXED_COLUMNS) return [];
  const [employeeNoColumn, nameColumn, departmentColumn, shiftColumn] = columns;
  const dayColumns = columns.slice(PUNCH_GRID_FIXED_COLUMNS);
  const weeks: PunchGridPrintMatrixWeek[] = [];

  for (let index = 0; index < dayColumns.length; index += PUNCH_GRID_PRINT_GROUP_SIZE) {
    const days = dayColumns.slice(index, index + PUNCH_GRID_PRINT_GROUP_SIZE);
    weeks.push({
      label: punchGridRangeLabel(days, lang),
      days: days.map((day) => ({ day, label: punchGridDayPrintLabel(day, lang) })),
      rows: rows.map((row, rowIndex) => {
        const employeeNo = row[employeeNoColumn] ?? "";
        const name = row[nameColumn] ?? "";
        const department = row[departmentColumn] ?? "";
        const shift = row[shiftColumn] ?? "";
        return {
          key: `${employeeNo || name || "employee"}-${rowIndex}-${index}`,
          employeeNo,
          name,
          department,
          shift,
          dayValues: days.map((day) => ({
            day,
            label: punchGridDayPrintLabel(day, lang),
            value: compactPunchGridPrintValue(row[day], lang),
          })),
        };
      }),
    });
  }

  return weeks;
}

function punchGridGroupedReportShape(columns: string[], rows: ReportRow[], lang: Lang): { columns: string[]; rows: ReportRow[] } {
  if (columns.length <= PUNCH_GRID_FIXED_COLUMNS + 2) return { columns, rows };

  const fixedColumns = columns.slice(0, PUNCH_GRID_FIXED_COLUMNS);
  const dayColumns = columns.slice(PUNCH_GRID_FIXED_COLUMNS);
  const groups: Array<{ label: string; days: string[] }> = [];

  for (let index = 0; index < dayColumns.length; index += PUNCH_GRID_PRINT_GROUP_SIZE) {
    const days = dayColumns.slice(index, index + PUNCH_GRID_PRINT_GROUP_SIZE);
    groups.push({ label: punchGridRangeLabel(days, lang), days });
  }

  return {
    columns: [...fixedColumns, ...groups.map((group) => group.label)],
    rows: rows.map((row) => {
      const compactRow: ReportRow = {};
      fixedColumns.forEach((column) => {
        compactRow[column] = row[column] ?? "";
      });
      groups.forEach((group) => {
        compactRow[group.label] = group.days
          .map((day) => {
            const value = String(row[day] ?? "").trim() || "-";
            return `${day}\n${value}`;
          })
          .join("\n\n");
      });
      return compactRow;
    }),
  };
}

type PrintViewLabels = {
  previewTitle: string;
  print: string;
  close: string;
  hint: string;
  portrait: string;
  landscape: string;
};

type PrintOrientation = "portrait" | "landscape";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selectPrintableTable(printable: HTMLElement): HTMLTableElement | null {
  return printable.querySelector<HTMLTableElement>("table[data-print-table='true']")
    ?? printable.querySelector<HTMLTableElement>("table");
}

function printableTableHtml(table: HTMLTableElement): string {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelectorAll(".report-select-col").forEach((node) => node.remove());
  return clone.outerHTML;
}

function buildPrintableDocumentHtml(printable: HTMLElement): string {
  const header = printable.querySelector<HTMLElement>(".report-print-header")?.outerHTML ?? "";
  const customPrintContent = printable.querySelector<HTMLElement>("[data-print-content='true']");
  const table = selectPrintableTable(printable);
  const reportPrintClasses = Array.from(printable.classList).filter((className) => className.startsWith("report-print-"));
  const classes = [
    "clean-print-section",
    ...reportPrintClasses,
    printable.classList.contains("payroll-print-panel") ? "payroll-print-panel" : "",
  ].filter(Boolean).join(" ");
  if (customPrintContent) {
    return `<section class="${classes}">${header}<div class="clean-print-table">${customPrintContent.outerHTML}</div></section>`;
  }
  if (!table) return printable.outerHTML;
  return `<section class="${classes}">${header}<div class="clean-print-table">${printableTableHtml(table)}</div></section>`;
}

function printPageStyle(orientation: PrintOrientation): string {
  return `@page { size: A4 ${orientation}; margin: 7mm; }`;
}

function printDocumentCss(orientation: PrintOrientation): string {
  return `
    ${printPageStyle(orientation)}
    html,
    body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #111;
      font-family: Arial, "Noto Sans SC", sans-serif;
      font-size: 9pt;
      line-height: 1.25;
    }
    * {
      box-sizing: border-box;
      background: transparent !important;
      box-shadow: none !important;
      print-color-adjust: economy;
      -webkit-print-color-adjust: economy;
    }
    .clean-print-section {
      width: 100%;
      margin: 0;
      padding: 0;
    }
    .report-export-bar,
    .report-select-col {
      display: none !important;
    }
    .report-print-header {
      display: grid;
      gap: 2mm;
      margin: 0 0 3mm;
      padding: 0 0 2.2mm;
      border-bottom: 1.5px solid #111;
    }
    .report-print-title {
      display: grid;
      gap: 0.8mm;
      min-width: 0;
    }
    .report-print-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.8mm 3.2mm;
      min-width: 0;
    }
    .report-print-title strong,
    .report-print-title span {
      display: block;
    }
    .report-print-title strong {
      font-size: 12.6pt;
      line-height: 1.12;
    }
    .report-print-title span,
    .report-print-meta span {
      color: #222;
      font-size: 7.6pt;
      line-height: 1.18;
      overflow-wrap: anywhere;
    }
    .report-print-meta span:not(:last-child) {
      padding-right: 3.2mm;
      border-right: 0.4px solid #999;
    }
    .clean-print-table {
      width: 100%;
      margin: 0;
      padding: 0;
    }
    table {
      width: 100%;
      min-width: 0;
      border-collapse: collapse;
      table-layout: auto;
      font-size: 7.9pt;
      page-break-inside: auto;
    }
    thead {
      display: table-header-group;
    }
    tfoot {
      display: table-row-group;
    }
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    th,
    td {
      border: 0.7px solid #777;
      padding: 1.45mm 1.15mm;
      text-align: center;
      vertical-align: middle;
      color: #111;
      overflow-wrap: break-word;
      word-break: normal;
      line-height: 1.16;
    }
    th {
      font-weight: 700;
      text-align: center;
      vertical-align: middle;
      white-space: normal;
      overflow-wrap: normal;
      word-break: normal;
    }
    .num {
      text-align: right;
      white-space: nowrap;
    }
    td.report-id-col,
    td.report-center-col {
      text-align: center;
      white-space: nowrap;
      word-break: keep-all;
      overflow-wrap: normal;
    }
    td.report-name-col,
    td.report-text-col {
      text-align: left;
      white-space: normal;
      word-break: normal;
      overflow-wrap: break-word;
    }
    td.report-text-col {
      white-space: pre-line;
    }
    .payroll-table {
      table-layout: fixed;
      font-size: 7pt;
    }
    .payroll-compact-table {
      table-layout: auto;
      font-size: 7.8pt;
    }
    .report-print-summary table,
    .report-print-device table {
      font-size: 7.2pt;
    }
    .report-print-summary th,
    .report-print-summary td,
    .report-print-device th,
    .report-print-device td {
      padding: 1.35mm 1mm;
      line-height: 1.14;
    }
    .payroll-compact-col-enroll { width: 20mm; }
    .payroll-compact-col-name { width: 34mm; }
    .payroll-compact-col-dept { width: 27mm; }
    .payroll-compact-col-type { width: 22mm; }
    .payroll-compact-col-hours { width: 20mm; }
    .payroll-compact-col-money { width: 28mm; }
    .payroll-compact-col-notes { width: 52mm; }
    .report-print-summary th,
    .report-print-device th {
      font-size: 6.9pt;
    }
    .payroll-table th,
    .payroll-table td {
      padding: 1.5mm 1.2mm;
      line-height: 1.16;
    }
    .payroll-compact-table th,
    .payroll-compact-table td {
      padding: 1.35mm 1mm;
      line-height: 1.14;
    }
    .payroll-compact-table th.payroll-compact-header-cell {
      text-align: center !important;
      vertical-align: middle;
      white-space: normal;
      word-break: normal;
      overflow-wrap: normal;
    }
    .payroll-compact-table td.report-id-col,
    .payroll-compact-table td.report-center-col {
      text-align: center;
      white-space: nowrap;
      word-break: keep-all;
      overflow-wrap: normal;
    }
    .payroll-compact-table td.report-name-col,
    .payroll-compact-table td.report-text-col {
      text-align: left;
      white-space: normal;
      word-break: normal;
      overflow-wrap: break-word;
    }
    .payroll-compact-table td.payroll-compact-hours-col,
    .payroll-compact-table td.payroll-compact-amount-col {
      text-align: center;
      white-space: nowrap;
    }
    .payroll-name-button {
      display: inline;
      border: 0;
      color: #111;
      padding: 0;
      text-align: left;
      font: inherit;
    }
    .payroll-name-button span {
      display: none;
    }
    .report-print-punchGrid table {
      table-layout: fixed;
      font-size: 8.2pt;
    }
    .report-print-punchGrid th,
    .report-print-punchGrid td {
      padding: 1.4mm 1.2mm;
      line-height: 1.24;
      overflow-wrap: break-word;
      word-break: normal;
    }
    .report-print-punchGrid td.report-multiline-col {
      text-align: left;
      vertical-align: top;
      white-space: pre-line;
      font-size: 7.6pt;
      line-height: 1.26;
    }
    .report-print-punchGrid th:nth-child(1),
    .report-print-punchGrid td:nth-child(1) {
      width: 24mm;
    }
    .report-print-punchGrid th:nth-child(2),
    .report-print-punchGrid td:nth-child(2) {
      width: 30mm;
    }
    .report-print-punchGrid th:nth-child(3),
    .report-print-punchGrid td:nth-child(3),
    .report-print-punchGrid th:nth-child(4),
    .report-print-punchGrid td:nth-child(4) {
      width: 19mm;
    }
    .punch-grid-employee-print {
      display: grid;
      gap: 3.4mm;
    }
    .punch-grid-employee-section {
      display: grid;
      gap: 1.5mm;
      padding: 0 0 2.5mm;
      border-bottom: 0.8px solid #aaa;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .punch-grid-employee-head {
      display: grid;
      gap: 0.6mm;
    }
    .punch-grid-employee-head strong {
      font-size: 9.8pt;
      line-height: 1.15;
    }
    .punch-grid-employee-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 1mm 4mm;
      color: #333;
      font-size: 7.6pt;
      line-height: 1.2;
    }
    .punch-grid-week {
      display: grid;
      gap: 0.7mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .punch-grid-week h4 {
      margin: 0;
      color: #111;
      font-size: 8.2pt;
      line-height: 1.15;
    }
    .punch-grid-week table {
      table-layout: fixed;
      font-size: 7.2pt;
    }
    .punch-grid-week th,
    .punch-grid-week td {
      padding: 0.9mm 0.8mm;
      line-height: 1.12;
    }
    .punch-grid-week td.report-multiline-col {
      text-align: center;
      vertical-align: top;
      white-space: pre-line;
      word-break: normal;
      overflow-wrap: break-word;
    }
    .punch-grid-matrix-print {
      display: grid !important;
      gap: 3.2mm;
    }
    .punch-grid-matrix-week {
      display: grid;
      gap: 0.8mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .punch-grid-matrix-week h4 {
      margin: 0;
      color: #111;
      font-size: 8.2pt;
      line-height: 1.15;
    }
    .punch-grid-matrix-week table {
      width: 100%;
      min-width: 0;
      table-layout: fixed;
      font-size: 6.9pt;
    }
    .punch-grid-matrix-week th,
    .punch-grid-matrix-week td {
      padding: 0.75mm 0.65mm;
      line-height: 1.1;
      word-break: normal;
      overflow-wrap: break-word;
    }
    .punch-grid-matrix-week th:nth-child(1),
    .punch-grid-matrix-week td:nth-child(1) {
      width: 29mm;
    }
    .punch-grid-matrix-week th:nth-child(2),
    .punch-grid-matrix-week td:nth-child(2) {
      width: 18mm;
    }
    .punch-grid-matrix-week th:nth-child(3),
    .punch-grid-matrix-week td:nth-child(3) {
      width: 15mm;
    }
    .punch-grid-matrix-week .punch-grid-matrix-employee-cell {
      text-align: left;
      vertical-align: middle;
      white-space: normal;
    }
    .punch-grid-matrix-employee-cell strong,
    .punch-grid-matrix-employee-cell span {
      display: block;
    }
    .punch-grid-matrix-employee-cell strong {
      font-size: 7pt;
      line-height: 1.1;
    }
    .punch-grid-matrix-employee-cell span {
      color: #444;
      font-size: 6.4pt;
    }
    .punch-grid-matrix-week td.report-multiline-col {
      text-align: center;
      vertical-align: top;
      white-space: pre-line;
      word-break: normal;
      overflow-wrap: break-word;
    }
    @media screen {
      body {
        padding: 0;
      }
    }
  `;
}

function printStandaloneDocument(title: string, html: string, orientation: PrintOrientation) {
  document.getElementById("tms-print-frame")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "tms-print-frame";
  frame.title = title;
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.setAttribute("aria-hidden", "true");
  const escapedTitle = escapeHtml(title);
  frame.srcdoc = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapedTitle}</title>
        <style>${printDocumentCss(orientation)}</style>
      </head>
      <body>${html}</body>
    </html>`;
  frame.addEventListener("load", () => {
    const frameWindow = frame.contentWindow;
    if (!frameWindow) return;
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(() => frame.remove(), 1000);
  }, { once: true });
  document.body.appendChild(frame);
}

function openPrintableView(
  selector: string,
  title: string,
  labels: PrintViewLabels,
  defaultOrientation: PrintOrientation,
  lockOrientation = false,
) {
  const printable = document.querySelector<HTMLElement>(selector);
  if (!printable) {
    window.print();
    return;
  }
  document.getElementById("tms-print-preview")?.remove();
  document.getElementById("tms-print-job")?.remove();
  document.getElementById("tms-print-style")?.remove();
  document.getElementById("tms-print-page-style")?.remove();
  const escapedTitle = escapeHtml(title);
  const previewTitle = escapeHtml(labels.previewTitle);
  const printLabel = escapeHtml(labels.print);
  const closeLabel = escapeHtml(labels.close);
  const hint = escapeHtml(labels.hint);
  const portraitLabel = escapeHtml(labels.portrait);
  const landscapeLabel = escapeHtml(labels.landscape);
  const printDocumentHtml = buildPrintableDocumentHtml(printable);
  const tableColumnCount = selectPrintableTable(printable)?.querySelectorAll("thead th:not(.report-select-col)").length ?? 0;
  const initialOrientation: PrintOrientation = !lockOrientation && defaultOrientation === "portrait" && tableColumnCount > 9
    ? "landscape"
    : defaultOrientation;
  let selectedPrintOrientation = initialOrientation;
  const previewCss = `
    #tms-print-preview {
      position: fixed;
      inset: 0;
      z-index: 9999;
      overflow: auto;
      background: #e8efed;
      --print-preview-width: 210mm;
      --print-preview-pad: 12mm;
    }
    #tms-print-preview.print-preview-landscape {
      --print-preview-width: 297mm;
    }
    #tms-print-preview.print-preview-portrait {
      --print-preview-width: 210mm;
    }
    #tms-print-job {
      display: none;
    }
    body.print-window-body {
      margin: 0;
      background: #f5f8f7;
      color: #111;
      font-family: Arial, sans-serif;
    }
    #tms-print-preview .print-window-toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
      padding: 12px 18px;
      border-bottom: 1px solid #d9e3df;
      background: #fff;
      box-shadow: 0 4px 14px rgba(36, 93, 86, 0.08);
    }
    #tms-print-preview .print-window-toolbar strong,
    #tms-print-preview .print-window-toolbar span {
      display: block;
    }
    #tms-print-preview .print-window-toolbar > div:first-child {
      min-width: 0;
      flex: 1 1 260px;
    }
    #tms-print-preview .print-window-toolbar span {
      color: #5d6f69;
      font-size: 12px;
      line-height: 1.45;
    }
    #tms-print-preview .print-window-toolbar-actions,
    #tms-print-preview .print-window-orientation {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    #tms-print-preview .print-window-toolbar-actions {
      justify-content: flex-end;
    }
    #tms-print-preview .print-window-toolbar button {
      border: 1px solid #c8d8d3;
      border-radius: 7px;
      background: #fff;
      color: #12312d;
      padding: 8px 13px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    #tms-print-preview .print-window-toolbar button:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }
    #tms-print-preview .print-window-toolbar button:first-child {
      border-color: #c8d8d3;
      background: #fff;
      color: #12312d;
    }
    #tms-print-preview .print-window-toolbar button.print-window-primary,
    #tms-print-preview .print-window-toolbar button.print-window-orientation-active {
      border-color: #245d56;
      background: #245d56;
      color: #fff;
    }
    #tms-print-preview .print-window-orientation {
      padding: 3px;
      border: 1px solid #d8e4e0;
      border-radius: 9px;
      background: #f7faf9;
    }
    #tms-print-preview .print-window-stage {
      display: grid;
      justify-items: center;
      min-width: 0;
      padding: 18px;
    }
    #tms-print-preview .print-window-document-scale {
      width: var(--print-preview-scaled-width, var(--print-preview-width));
      height: var(--print-preview-scaled-height, auto);
      min-width: 0;
      margin: 0 auto 18px;
    }
    #tms-print-preview .print-window-document {
      width: var(--print-preview-width);
      min-width: 0;
      max-width: none;
      margin: 0;
      padding: var(--print-preview-pad);
      box-sizing: border-box;
      overflow: hidden;
      background: #fff;
      box-shadow: 0 18px 42px rgba(21, 49, 45, 0.18);
      transform: scale(var(--print-preview-scale, 1));
      transform-origin: top left;
    }
    #tms-print-preview.print-preview-landscape .print-window-document {
      --print-preview-pad: 11mm;
    }
    #tms-print-preview.print-preview-portrait .print-window-document {
      --print-preview-pad: 12mm;
    }
    #tms-print-preview .print-window-document .section-title,
    #tms-print-preview .print-window-document .panel-caption,
    #tms-print-preview .print-window-document .report-purpose-note,
    #tms-print-preview .print-window-document .report-format-groups,
    #tms-print-preview .print-window-document .reports-toolbar,
    #tms-print-preview .print-window-document .report-export-bar,
    #tms-print-preview .print-window-document .report-select-col,
    #tms-print-preview .print-window-document .payroll-export-status,
    #tms-print-preview .print-window-document .table-help,
    #tms-print-preview .print-window-document .button {
      display: none !important;
    }
    #tms-print-preview .print-window-document .panel,
    #tms-print-preview .print-window-document .table-wrap {
      border: 0 !important;
      border-radius: 0 !important;
      background: #fff !important;
      box-shadow: none !important;
    }
    #tms-print-preview .print-window-document .view-stack,
    #tms-print-preview .print-window-document .report-panel,
    #tms-print-preview .print-window-document .report-table,
    #tms-print-preview .print-window-document .clean-print-section,
    #tms-print-preview .print-window-document .clean-print-table {
      background: #fff !important;
      border-radius: 0 !important;
    }
    #tms-print-preview .print-window-document .report-print-header {
      display: grid !important;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #333;
    }
    #tms-print-preview .print-window-document .report-print-title {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    #tms-print-preview .print-window-document .report-print-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px 14px;
      min-width: 0;
    }
    #tms-print-preview .print-window-document .report-print-title strong,
    #tms-print-preview .print-window-document .report-print-title span {
      display: block;
    }
    #tms-print-preview .print-window-document .report-print-title strong {
      font-size: 16px;
    }
    #tms-print-preview .print-window-document .report-print-title span,
    #tms-print-preview .print-window-document .report-print-meta span {
      color: #444;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    #tms-print-preview .print-window-document .report-print-meta span:not(:last-child) {
      padding-right: 14px;
      border-right: 1px solid #c6cfcc;
    }
    #tms-print-preview .print-window-document .table-wrap,
    #tms-print-preview .print-window-document .report-table {
      max-height: none !important;
      max-width: none !important;
      overflow: visible !important;
    }
    #tms-print-preview .print-window-document table {
      width: 100%;
      min-width: 0;
      border-collapse: collapse;
      table-layout: auto;
      font-size: 10.5px;
    }
    #tms-print-preview .print-window-document thead {
      display: table-header-group;
    }
    #tms-print-preview .print-window-document th,
    #tms-print-preview .print-window-document td {
      border: 1px solid #bac9c5;
      color: #111;
      padding: 5px 6px;
      text-align: center;
      vertical-align: middle;
      overflow-wrap: break-word;
      line-height: 1.2;
    }
    #tms-print-preview .print-window-document th {
      text-align: center;
      vertical-align: middle;
      white-space: normal;
      overflow-wrap: normal;
      word-break: normal;
    }
    #tms-print-preview .print-window-document td.report-id-col,
    #tms-print-preview .print-window-document td.report-center-col {
      text-align: center;
      white-space: nowrap;
      word-break: keep-all;
      overflow-wrap: normal;
    }
    #tms-print-preview .print-window-document td.report-name-col,
    #tms-print-preview .print-window-document td.report-text-col {
      text-align: left;
      white-space: normal;
      word-break: normal;
      overflow-wrap: break-word;
    }
    #tms-print-preview .print-window-document td.report-text-col {
      white-space: pre-line;
    }
    #tms-print-preview .print-window-document tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    #tms-print-preview .print-window-document tbody tr:hover {
      background: transparent !important;
    }
    #tms-print-preview .print-window-document .payroll-table {
      width: 100%;
      min-width: 0;
      table-layout: auto;
      border-collapse: collapse;
      border-spacing: 0;
      font-size: 9px;
    }
    #tms-print-preview .print-window-document .payroll-compact-table {
      table-layout: auto;
      font-size: 9.8px;
    }
    #tms-print-preview .print-window-document .payroll-table,
    #tms-print-preview .print-window-document .payroll-table thead,
    #tms-print-preview .print-window-document .payroll-table tfoot,
    #tms-print-preview .print-window-document .payroll-table tbody,
    #tms-print-preview .print-window-document .payroll-table tr,
    #tms-print-preview .print-window-document .payroll-table th,
    #tms-print-preview .print-window-document .payroll-table td {
      display: revert;
      width: auto;
    }
    #tms-print-preview .print-window-document .payroll-table th,
    #tms-print-preview .print-window-document .payroll-table td {
      padding: 5px 6px;
      white-space: normal;
      overflow-wrap: break-word;
    }
    #tms-print-preview .print-window-document .payroll-compact-table th,
    #tms-print-preview .print-window-document .payroll-compact-table td {
      padding: 4px 5px;
      line-height: 1.18;
      word-break: normal;
      overflow-wrap: normal;
    }
    #tms-print-preview .print-window-document .payroll-compact-table th.payroll-compact-header-cell {
      text-align: center !important;
      vertical-align: middle;
      white-space: normal;
      word-break: normal;
      overflow-wrap: normal;
    }
    #tms-print-preview .print-window-document .payroll-compact-table td.report-id-col,
    #tms-print-preview .print-window-document .payroll-compact-table td.report-center-col {
      text-align: center;
      white-space: nowrap;
      word-break: keep-all;
      overflow-wrap: normal;
    }
    #tms-print-preview .print-window-document .payroll-compact-table td.report-name-col,
    #tms-print-preview .print-window-document .payroll-compact-table td.report-text-col {
      text-align: left;
      word-break: normal;
      overflow-wrap: break-word;
    }
    #tms-print-preview .print-window-document .payroll-compact-table td.payroll-compact-hours-col,
    #tms-print-preview .print-window-document .payroll-compact-table td.payroll-compact-amount-col {
      text-align: center;
      white-space: nowrap;
    }
    #tms-print-preview .print-window-document .payroll-compact-col-enroll { width: 20mm; }
    #tms-print-preview .print-window-document .payroll-compact-col-name { width: 34mm; }
    #tms-print-preview .print-window-document .payroll-compact-col-dept { width: 27mm; }
    #tms-print-preview .print-window-document .payroll-compact-col-type { width: 22mm; }
    #tms-print-preview .print-window-document .payroll-compact-col-hours { width: 20mm; }
    #tms-print-preview .print-window-document .payroll-compact-col-money { width: 28mm; }
    #tms-print-preview .print-window-document .payroll-compact-col-notes { width: 52mm; }
    #tms-print-preview .print-window-document .payroll-table td::before {
      content: none;
    }
    #tms-print-preview .print-window-document .payroll-table .num {
      white-space: nowrap;
    }
    #tms-print-preview .print-window-document .payroll-table .payroll-sticky,
    #tms-print-preview .print-window-document .payroll-table .payroll-sticky-name {
      position: static;
      left: auto;
      min-width: 0;
      box-shadow: none;
    }
    #tms-print-preview .print-window-document .payroll-name-button {
      display: inline;
      border: 0;
      background: transparent;
      color: #111;
      padding: 0;
      text-align: left;
      font: inherit;
    }
    #tms-print-preview .print-window-document .payroll-name-button span {
      display: none;
    }
    #tms-print-preview .print-window-document .report-print-punchGrid table {
      table-layout: fixed;
      font-size: 8.2pt;
    }
    #tms-print-preview .print-window-document .report-print-punchGrid th,
    #tms-print-preview .print-window-document .report-print-punchGrid td {
      padding: 5px 5px;
      line-height: 1.24;
      overflow-wrap: break-word;
      word-break: normal;
    }
    #tms-print-preview .print-window-document .report-print-punchGrid td.report-multiline-col {
      text-align: left;
      vertical-align: top;
      white-space: pre-line;
      font-size: 7.6pt;
      line-height: 1.26;
    }
    #tms-print-preview .print-window-document .report-print-punchGrid th:nth-child(1),
    #tms-print-preview .print-window-document .report-print-punchGrid td:nth-child(1) {
      width: 24mm;
    }
    #tms-print-preview .print-window-document .report-print-punchGrid th:nth-child(2),
    #tms-print-preview .print-window-document .report-print-punchGrid td:nth-child(2) {
      width: 30mm;
    }
    #tms-print-preview .print-window-document .report-print-punchGrid th:nth-child(3),
    #tms-print-preview .print-window-document .report-print-punchGrid td:nth-child(3),
    #tms-print-preview .print-window-document .report-print-punchGrid th:nth-child(4),
    #tms-print-preview .print-window-document .report-print-punchGrid td:nth-child(4) {
      width: 19mm;
    }
    #tms-print-preview .print-window-document .punch-grid-employee-print {
      display: grid !important;
      gap: 12px;
    }
    #tms-print-preview .print-window-document .punch-grid-employee-section {
      display: grid;
      gap: 7px;
      padding: 0 0 10px;
      border-bottom: 1px solid #c5cfcb;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    #tms-print-preview .print-window-document .punch-grid-employee-head {
      display: grid;
      gap: 3px;
    }
    #tms-print-preview .print-window-document .punch-grid-employee-head strong {
      font-size: 13px;
      line-height: 1.18;
    }
    #tms-print-preview .print-window-document .punch-grid-employee-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      color: #40554f;
      font-size: 10.5px;
      line-height: 1.25;
    }
    #tms-print-preview .print-window-document .punch-grid-week {
      display: grid;
      gap: 3px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    #tms-print-preview .print-window-document .punch-grid-week h4 {
      margin: 0;
      color: #111;
      font-size: 11px;
      line-height: 1.15;
    }
    #tms-print-preview .print-window-document .punch-grid-week table {
      table-layout: fixed;
      font-size: 9.4px;
    }
    #tms-print-preview .print-window-document .punch-grid-week th,
    #tms-print-preview .print-window-document .punch-grid-week td {
      padding: 4px 4px;
      line-height: 1.15;
    }
    #tms-print-preview .print-window-document .punch-grid-week td.report-multiline-col {
      text-align: center;
      vertical-align: top;
      white-space: pre-line;
      word-break: normal;
      overflow-wrap: break-word;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-print {
      display: grid !important;
      gap: 12px;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week {
      display: grid;
      gap: 4px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week h4 {
      margin: 0;
      color: #111;
      font-size: 11px;
      line-height: 1.15;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week table {
      width: 100%;
      min-width: 0;
      table-layout: fixed;
      font-size: 9px;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week th,
    #tms-print-preview .print-window-document .punch-grid-matrix-week td {
      padding: 3px 3px;
      line-height: 1.12;
      word-break: normal;
      overflow-wrap: break-word;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week th:nth-child(1),
    #tms-print-preview .print-window-document .punch-grid-matrix-week td:nth-child(1) {
      width: 116px;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week th:nth-child(2),
    #tms-print-preview .print-window-document .punch-grid-matrix-week td:nth-child(2) {
      width: 72px;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week th:nth-child(3),
    #tms-print-preview .print-window-document .punch-grid-matrix-week td:nth-child(3) {
      width: 62px;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week .punch-grid-matrix-employee-cell {
      text-align: left;
      vertical-align: middle;
      white-space: normal;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-employee-cell strong,
    #tms-print-preview .print-window-document .punch-grid-matrix-employee-cell span {
      display: block;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-employee-cell strong {
      font-size: 9px;
      line-height: 1.12;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-employee-cell span {
      color: #40554f;
      font-size: 8.4px;
    }
    #tms-print-preview .print-window-document .punch-grid-matrix-week td.report-multiline-col {
      text-align: center;
      vertical-align: top;
      white-space: pre-line;
      word-break: normal;
      overflow-wrap: break-word;
    }
    @media (max-width: 760px) {
      #tms-print-preview {
        --print-preview-pad: 14px;
      }
      #tms-print-preview .print-window-toolbar {
        position: static;
        align-items: stretch;
        flex-direction: column;
        padding: 12px;
      }
      #tms-print-preview .print-window-toolbar-actions {
        display: grid;
        grid-template-columns: 1fr;
      }
      #tms-print-preview .print-window-orientation {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      #tms-print-preview .print-window-toolbar button {
        min-height: 42px;
        padding: 9px 10px;
      }
      #tms-print-preview .print-window-stage {
        padding: 10px;
      }
      #tms-print-preview .print-window-document .report-print-meta {
        display: grid;
        gap: 3px;
      }
      #tms-print-preview .print-window-document .report-print-meta span {
        padding-right: 0 !important;
        border-right: 0 !important;
      }
      #tms-print-preview .print-window-document table {
        min-width: 720px;
      }
    }
    @media print {
      body.print-window-body {
        background: #fff;
      }
      body > :not(#tms-print-job) {
        display: none !important;
      }
      #tms-print-job {
        display: block !important;
        position: static;
        inset: auto;
        overflow: visible;
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        background: transparent !important;
        print-color-adjust: economy !important;
        -webkit-print-color-adjust: economy !important;
      }
      #tms-print-job * {
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
        print-color-adjust: economy !important;
        -webkit-print-color-adjust: economy !important;
      }
      #tms-print-job .print-window-document {
        width: auto;
        min-height: 0 !important;
        height: auto !important;
        margin: 0;
        padding: 0;
        background: #fff !important;
        box-shadow: none;
      }
      #tms-print-job .clean-print-section {
        display: block !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
      }
      #tms-print-job .clean-print-table {
        display: block !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
      }
      #tms-print-job .section-title,
      #tms-print-job .panel-caption,
      #tms-print-job .report-purpose-note,
      #tms-print-job .report-format-groups,
      #tms-print-job .reports-toolbar,
      #tms-print-job .report-export-bar,
      #tms-print-job .report-select-col,
      #tms-print-job .payroll-export-status,
      #tms-print-job .table-help,
      #tms-print-job .button {
        display: none !important;
      }
      #tms-print-job .panel,
      #tms-print-job .table-wrap {
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        height: auto !important;
        min-height: 0 !important;
      }
      #tms-print-job .view-stack,
      #tms-print-job .report-panel,
      #tms-print-job .report-table,
      #tms-print-job .clean-print-section,
      #tms-print-job .clean-print-table {
        border-radius: 0 !important;
        height: auto !important;
        min-height: 0 !important;
      }
      #tms-print-job .report-print-header {
        display: grid !important;
        gap: 2mm;
        margin-bottom: 3mm;
        padding-bottom: 2.2mm;
        border-bottom: 1.5px solid #111;
      }
      #tms-print-job .report-print-title {
        display: grid;
        gap: 0.8mm;
        min-width: 0;
      }
      #tms-print-job .report-print-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.8mm 3.2mm;
        min-width: 0;
      }
      #tms-print-job .report-print-title strong,
      #tms-print-job .report-print-title span {
        display: block;
      }
      #tms-print-job .report-print-title strong {
        font-size: 12.6pt;
        line-height: 1.12;
      }
      #tms-print-job .report-print-title span,
      #tms-print-job .report-print-meta span {
        color: #222;
        font-size: 7.6pt;
        line-height: 1.18;
        overflow-wrap: anywhere;
      }
      #tms-print-job .report-print-meta span:not(:last-child) {
        padding-right: 3.2mm;
        border-right: 0.4px solid #999;
      }
      #tms-print-job .table-wrap,
      #tms-print-job .report-table {
        max-height: none !important;
        max-width: none !important;
        overflow: visible !important;
      }
      #tms-print-job table {
        width: 100%;
        min-width: 0;
        border-collapse: collapse;
        table-layout: auto;
        background: transparent !important;
      }
      #tms-print-job thead {
        display: table-header-group;
      }
      #tms-print-job thead,
      #tms-print-job tbody,
      #tms-print-job tr,
      #tms-print-job th,
      #tms-print-job td {
        background: transparent !important;
      }
      #tms-print-job th,
      #tms-print-job td {
        border: 0.7px solid #777;
        color: #111;
        padding: 1.45mm 1.15mm;
        text-align: center;
        vertical-align: middle;
        overflow-wrap: break-word;
        line-height: 1.16;
      }
      #tms-print-job th {
        text-align: center;
        vertical-align: middle;
        white-space: normal;
        overflow-wrap: normal;
        word-break: normal;
      }
      #tms-print-job td.report-id-col,
      #tms-print-job td.report-center-col {
        text-align: center;
        white-space: nowrap;
        word-break: keep-all;
        overflow-wrap: normal;
      }
      #tms-print-job td.report-name-col,
      #tms-print-job td.report-text-col {
        text-align: left;
        white-space: normal;
        word-break: normal;
        overflow-wrap: break-word;
      }
      #tms-print-job td.report-text-col {
        white-space: pre-line;
      }
      #tms-print-job .punch-grid-employee-print {
        display: grid !important;
        gap: 3.4mm;
      }
      #tms-print-job .punch-grid-employee-section {
        display: grid;
        gap: 1.5mm;
        padding: 0 0 2.5mm;
        border-bottom: 0.8px solid #aaa;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      #tms-print-job .punch-grid-employee-head {
        display: grid;
        gap: 0.6mm;
      }
      #tms-print-job .punch-grid-employee-head strong {
        font-size: 9.8pt;
        line-height: 1.15;
      }
      #tms-print-job .punch-grid-employee-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 1mm 4mm;
        color: #333;
        font-size: 7.6pt;
        line-height: 1.2;
      }
      #tms-print-job .punch-grid-week {
        display: grid;
        gap: 0.7mm;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      #tms-print-job .punch-grid-week h4 {
        margin: 0;
        color: #111;
        font-size: 8.2pt;
        line-height: 1.15;
      }
      #tms-print-job .punch-grid-week table {
        table-layout: fixed;
        font-size: 7.2pt;
      }
      #tms-print-job .punch-grid-week th,
      #tms-print-job .punch-grid-week td {
        padding: 0.9mm 0.8mm;
        line-height: 1.12;
      }
      #tms-print-job .punch-grid-week td.report-multiline-col {
        text-align: center;
        vertical-align: top;
        white-space: pre-line;
        word-break: normal;
        overflow-wrap: break-word;
      }
      #tms-print-job .punch-grid-matrix-print {
        display: grid !important;
        gap: 3.2mm;
      }
      #tms-print-job .punch-grid-matrix-week {
        display: grid;
        gap: 0.8mm;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      #tms-print-job .punch-grid-matrix-week h4 {
        margin: 0;
        color: #111;
        font-size: 8.2pt;
        line-height: 1.15;
      }
      #tms-print-job .punch-grid-matrix-week table {
        width: 100%;
        min-width: 0;
        table-layout: fixed;
        font-size: 6.9pt;
      }
      #tms-print-job .punch-grid-matrix-week th,
      #tms-print-job .punch-grid-matrix-week td {
        padding: 0.75mm 0.65mm;
        line-height: 1.1;
        word-break: normal;
        overflow-wrap: break-word;
      }
      #tms-print-job .punch-grid-matrix-week th:nth-child(1),
      #tms-print-job .punch-grid-matrix-week td:nth-child(1) {
        width: 29mm;
      }
      #tms-print-job .punch-grid-matrix-week th:nth-child(2),
      #tms-print-job .punch-grid-matrix-week td:nth-child(2) {
        width: 18mm;
      }
      #tms-print-job .punch-grid-matrix-week th:nth-child(3),
      #tms-print-job .punch-grid-matrix-week td:nth-child(3) {
        width: 15mm;
      }
      #tms-print-job .punch-grid-matrix-week .punch-grid-matrix-employee-cell {
        text-align: left;
        vertical-align: middle;
        white-space: normal;
      }
      #tms-print-job .punch-grid-matrix-employee-cell strong,
      #tms-print-job .punch-grid-matrix-employee-cell span {
        display: block;
      }
      #tms-print-job .punch-grid-matrix-employee-cell strong {
        font-size: 7pt;
        line-height: 1.1;
      }
      #tms-print-job .punch-grid-matrix-employee-cell span {
        color: #444;
        font-size: 6.4pt;
      }
      #tms-print-job .punch-grid-matrix-week td.report-multiline-col {
        text-align: center;
        vertical-align: top;
        white-space: pre-line;
        word-break: normal;
        overflow-wrap: break-word;
      }
      #tms-print-job tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      #tms-print-job .payroll-table {
        width: 100%;
        min-width: 0;
        table-layout: auto;
        border-collapse: collapse;
        border-spacing: 0;
        font-size: 9px;
      }
      #tms-print-job .payroll-compact-table {
        table-layout: auto;
        font-size: 7.8pt;
      }
      #tms-print-job .payroll-table,
      #tms-print-job .payroll-table thead,
      #tms-print-job .payroll-table tfoot,
      #tms-print-job .payroll-table tbody,
      #tms-print-job .payroll-table tr,
      #tms-print-job .payroll-table th,
      #tms-print-job .payroll-table td {
        display: revert;
        width: auto;
      }
      #tms-print-job .payroll-table th,
      #tms-print-job .payroll-table td {
        padding: 5px 6px;
        white-space: normal;
        overflow-wrap: break-word;
      }
      #tms-print-job .payroll-compact-table th,
      #tms-print-job .payroll-compact-table td {
        padding: 1.35mm 1mm;
        line-height: 1.14;
        word-break: normal;
        overflow-wrap: normal;
      }
      #tms-print-job .payroll-compact-table th.payroll-compact-header-cell {
        text-align: center !important;
        vertical-align: middle;
        white-space: normal;
        word-break: normal;
        overflow-wrap: normal;
      }
      #tms-print-job .payroll-compact-table td.report-id-col,
      #tms-print-job .payroll-compact-table td.report-center-col {
        text-align: center;
        white-space: nowrap;
        word-break: keep-all;
        overflow-wrap: normal;
      }
      #tms-print-job .payroll-compact-table td.report-name-col,
      #tms-print-job .payroll-compact-table td.report-text-col {
        text-align: left;
        word-break: normal;
        overflow-wrap: break-word;
      }
      #tms-print-job .payroll-compact-table td.payroll-compact-hours-col,
      #tms-print-job .payroll-compact-table td.payroll-compact-amount-col {
        text-align: center;
        white-space: nowrap;
      }
      #tms-print-job .payroll-compact-col-enroll { width: 20mm; }
      #tms-print-job .payroll-compact-col-name { width: 34mm; }
      #tms-print-job .payroll-compact-col-dept { width: 27mm; }
      #tms-print-job .payroll-compact-col-type { width: 22mm; }
      #tms-print-job .payroll-compact-col-hours { width: 20mm; }
      #tms-print-job .payroll-compact-col-money { width: 28mm; }
      #tms-print-job .payroll-compact-col-notes { width: 52mm; }
      #tms-print-job .payroll-table td::before {
        content: none;
      }
      #tms-print-job .payroll-table .num {
        white-space: nowrap;
      }
      #tms-print-job .payroll-table .payroll-sticky,
      #tms-print-job .payroll-table .payroll-sticky-name {
        position: static;
        left: auto;
        min-width: 0;
        box-shadow: none;
      }
      #tms-print-job .payroll-name-button {
        display: inline;
        border: 0;
        background: transparent;
        color: #111;
        padding: 0;
        text-align: left;
        font: inherit;
      }
      #tms-print-job .payroll-name-button span {
        display: none;
      }
      #tms-print-job .report-print-punchGrid table {
        table-layout: fixed;
        font-size: 8.2pt;
      }
      #tms-print-job .report-print-punchGrid th,
      #tms-print-job .report-print-punchGrid td {
        padding: 5px 5px;
        line-height: 1.24;
        overflow-wrap: break-word;
        word-break: normal;
      }
      #tms-print-job .report-print-punchGrid td.report-multiline-col {
        text-align: left;
        vertical-align: top;
        white-space: pre-line;
        font-size: 7.6pt;
        line-height: 1.26;
      }
      #tms-print-job .report-print-punchGrid th:nth-child(1),
      #tms-print-job .report-print-punchGrid td:nth-child(1) {
        width: 24mm;
      }
      #tms-print-job .report-print-punchGrid th:nth-child(2),
      #tms-print-job .report-print-punchGrid td:nth-child(2) {
        width: 30mm;
      }
      #tms-print-job .report-print-punchGrid th:nth-child(3),
      #tms-print-job .report-print-punchGrid td:nth-child(3),
      #tms-print-job .report-print-punchGrid th:nth-child(4),
      #tms-print-job .report-print-punchGrid td:nth-child(4) {
        width: 19mm;
      }
    }
  `;
  const printStyle = document.createElement("style");
  printStyle.id = "tms-print-style";
  printStyle.textContent = previewCss;
  document.head.appendChild(printStyle);
  const pageStyle = document.createElement("style");
  pageStyle.id = "tms-print-page-style";
  pageStyle.textContent = printPageStyle(initialOrientation);
  document.head.appendChild(pageStyle);
  const overlay = document.createElement("div");
  overlay.id = "tms-print-preview";
  overlay.className = `print-preview-${initialOrientation}`;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", previewTitle);
  overlay.innerHTML = `
        <div class="print-window-toolbar">
          <div>
            <strong>${previewTitle}</strong>
            <span>${hint}</span>
          </div>
          <div class="print-window-toolbar-actions">
            <div class="print-window-orientation" role="group">
              <button type="button" data-print-orientation="portrait" aria-pressed="${initialOrientation === "portrait"}" ${lockOrientation && initialOrientation !== "portrait" ? "disabled" : ""}>${portraitLabel}</button>
              <button type="button" data-print-orientation="landscape" aria-pressed="${initialOrientation === "landscape"}" ${lockOrientation && initialOrientation !== "landscape" ? "disabled" : ""}>${landscapeLabel}</button>
            </div>
            <button type="button" class="print-window-primary" data-print-action>${printLabel}</button>
            <button type="button" data-print-close>${closeLabel}</button>
          </div>
        </div>
        <div class="print-window-stage">
          <div class="print-window-document-scale">
            <main class="print-window-document" aria-label="${escapedTitle}">${printDocumentHtml}</main>
          </div>
        </div>`;
  document.body.appendChild(overlay);
  const printJob = document.createElement("div");
  printJob.id = "tms-print-job";
  printJob.className = `print-preview-${initialOrientation}`;
  printJob.setAttribute("aria-label", escapedTitle);
  printJob.innerHTML = printDocumentHtml;
  document.body.appendChild(printJob);
  const previewScaleFrame = overlay.querySelector<HTMLElement>(".print-window-document-scale");
  const previewDocument = overlay.querySelector<HTMLElement>(".print-window-document");
  const syncPreviewScale = () => {
    if (!previewScaleFrame || !previewDocument) return;
    const availableWidth = Math.max(260, overlay.clientWidth - (window.innerWidth <= 760 ? 20 : 36));
    const naturalWidth = previewDocument.offsetWidth || availableWidth;
    const naturalHeight = previewDocument.offsetHeight || 1;
    const scale = Math.min(1, availableWidth / naturalWidth);
    previewDocument.style.setProperty("--print-preview-scale", String(scale));
    previewScaleFrame.style.setProperty("--print-preview-scaled-width", `${Math.ceil(naturalWidth * scale)}px`);
    previewScaleFrame.style.setProperty("--print-preview-scaled-height", `${Math.ceil(naturalHeight * scale)}px`);
  };
  const handlePreviewResize = () => syncPreviewScale();
  window.addEventListener("resize", handlePreviewResize);
  const orientationButtons = Array.from(overlay.querySelectorAll<HTMLButtonElement>("[data-print-orientation]"));
  const setOrientation = (orientation: PrintOrientation) => {
    selectedPrintOrientation = orientation;
    overlay.classList.toggle("print-preview-portrait", orientation === "portrait");
    overlay.classList.toggle("print-preview-landscape", orientation === "landscape");
    printJob.classList.toggle("print-preview-portrait", orientation === "portrait");
    printJob.classList.toggle("print-preview-landscape", orientation === "landscape");
    pageStyle.textContent = printPageStyle(orientation);
    orientationButtons.forEach((button) => {
      const active = button.dataset.printOrientation === orientation;
      button.classList.toggle("print-window-orientation-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    window.requestAnimationFrame(syncPreviewScale);
  };
  setOrientation(initialOrientation);
  orientationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextOrientation = button.dataset.printOrientation === "landscape" ? "landscape" : "portrait";
      if (lockOrientation && nextOrientation !== initialOrientation) return;
      setOrientation(nextOrientation);
    });
  });
  overlay.querySelector("[data-print-action]")?.addEventListener("click", () => {
    printStandaloneDocument(title, printDocumentHtml, selectedPrintOrientation);
  });
  overlay.querySelector("[data-print-close]")?.addEventListener("click", () => {
    window.removeEventListener("resize", handlePreviewResize);
    overlay.remove();
    printJob.remove();
    printStyle.remove();
    pageStyle.remove();
  });
}

function Button({
  children,
  icon: Icon,
  variant = "primary",
  type = "button",
  className,
  disabled,
  onClick,
}: {
  children?: ReactNode;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type={type} className={cx("button", `button-${variant}`, className)} disabled={disabled} onClick={onClick}>
      {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn" | "bad";
  icon: LucideIcon;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="metric-icon">
        <Icon size={18} aria-hidden="true" />
      </div>
      <div>
        <div className="metric-value">{value}</div>
        <div className="metric-label">{label}</div>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cx("metric", "metric-action", `metric-${tone}`)} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className={cx("metric", `metric-${tone}`)}>
      {content}
    </div>
  );
}

function Field({
  label,
  children,
  compact,
  required,
  error,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className={cx("field", compact && "field-compact", error && "field-error")}>
      <span>
        {label}
        {required ? <b aria-hidden="true">*</b> : null}
      </span>
      {children}
      {error ? <em>{error}</em> : null}
    </label>
  );
}

function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

function statusClass(status: string): string {
  return `status status-${status}`;
}

function recordPunchTime(record: AttendanceRecord, kind: PunchKind, lang: Lang): string {
  const timeMap: Record<PunchKind, string> = {
    in: record.clockIn,
    breakOut: record.breakOut,
    breakIn: record.breakIn,
    out: record.clockOut,
  };
  const offsetMap: Record<PunchKind, number> = {
    in: record.clockInDayOffset,
    breakOut: record.breakOutDayOffset,
    breakIn: record.breakInDayOffset,
    out: record.clockOutDayOffset,
  };
  const time = timeMap[kind];
  if (!time) return "";
  const offset = offsetMap[kind] ?? 0;
  return offset > 0 ? `${time} ${translate(lang, "nextDaySuffix", { count: offset })}` : time;
}

function punchGridCellText(record: AttendanceRecord | undefined, lang: Lang): string {
  if (!record) return "-";

  const labels: Record<PunchKind, string> = {
    in: translate(lang, "punchGridInShort"),
    breakOut: translate(lang, "punchGridLunchOutShort"),
    breakIn: translate(lang, "punchGridLunchInShort"),
    out: translate(lang, "punchGridOutShort"),
  };
  const kinds: PunchKind[] = ["in", "breakOut", "breakIn", "out"];
  const showMissingPunches = record.status === "incomplete" || record.flags.some((flag) => flag.kind === "missingPunch");
  const lines = kinds
    .map((kind) => {
      const time = recordPunchTime(record, kind, lang);
      if (time) return `${labels[kind]} ${time}`;
      return showMissingPunches ? `${labels[kind]} ${translate(lang, "punchGridMissingShort")}` : "";
    })
    .filter(Boolean);

  if (lines.length > 0) return lines.join("\n");
  if (record.status === "scheduled") return "-";
  return statusLabels[lang][record.status];
}

function scheduleCrossesMidnight(schedule: DaySchedule | undefined): boolean {
  if (!schedule || schedule.off) return false;
  return minutesFromTime(schedule.end) <= minutesFromTime(schedule.start);
}

function scheduleTimeLabel(schedule: DaySchedule | undefined, key: keyof Pick<DaySchedule, "start" | "lunchStart" | "lunchEnd" | "end" | "otStart" | "otEnd">, lang: Lang): string {
  if (!schedule || schedule.off) return "-";
  const value = String(schedule[key] || "");
  if (!value) return "-";
  return scheduleCrossesMidnight(schedule) && key !== "start" && minutesFromTime(value) < minutesFromTime(schedule.start)
    ? `${value} ${translate(lang, "nextDaySuffix", { count: 1 })}`
    : value;
}

function auditPunchSnapshot(punches: Punch[]): TimecardCorrectionAuditPunch[] {
  return punches.map((punch) => ({
    kind: punch.kind,
    date: punch.date,
    time: punch.time,
    source: punch.source,
    note: punch.note,
  }));
}

function auditPunchSummary(punches: TimecardCorrectionAuditPunch[], lang: Lang): string {
  if (punches.length === 0) return "-";
  return punches
    .map((punch) => `${punchKindLabels[lang][punch.kind]} ${punch.date} ${punch.time}`)
    .join(" / ");
}

function auditChangedAt(value: string, lang: Lang): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function correctionReasonText(reason: string, detail: string): string {
  const cleanReason = normalizeDataValue(reason.trim());
  const cleanDetail = detail.trim();
  return cleanDetail ? `${cleanReason}: ${cleanDetail}` : cleanReason;
}

function displayCorrectionReason(reason: string, lang: Lang): string {
  const [base, ...detail] = reason.split(": ");
  const translatedBase = translateDataValue(base, lang);
  return detail.length ? `${translatedBase}: ${detail.join(": ")}` : translatedBase;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function isSupportedMcAttachment(file: File): boolean {
  const normalizedType = file.type.toLowerCase();
  const normalizedName = file.name.toLowerCase();
  return (
    ["application/pdf", "image/jpeg", "image/png"].includes(normalizedType) ||
    /\.(pdf|jpe?g|png)$/.test(normalizedName)
  );
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${size} B`;
}

function dataUrlRows(columns: string[], rows: Array<Record<string, string | number>>) {
  return "\uFEFF" + [
    columns.map((column) => csvEscape(column)).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
}

function safeFilenameSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-") || "report";
}

async function downloadXlsxReport(
  filename: string,
  title: string,
  summaryLines: string[],
  columns: string[],
  rows: Array<Record<string, string | number>>,
) {
  const buffer = await buildXlsxReportBuffer(title, summaryLines, columns, rows);
  downloadBlob(filename, new Blob([buffer], { type: XLSX_WORKBOOK_MIME_TYPE }));
}

async function downloadDocxReport(
  filename: string,
  title: string,
  summaryLines: string[],
  columns: string[],
  rows: Array<Record<string, string | number>>,
) {
  const buffer = await buildDocxReportBuffer(title, summaryLines, columns, rows);
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  downloadBlob(filename, new Blob([arrayBuffer], { type: DOCX_MIME_TYPE }));
}

async function downloadPunchGridDocxReport(
  filename: string,
  title: string,
  summaryLines: string[],
  employees: PunchGridPrintEmployee[],
) {
  const buffer = await buildPunchGridDocxReportBuffer(title, summaryLines, employees);
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  downloadBlob(filename, new Blob([arrayBuffer], { type: DOCX_MIME_TYPE }));
}

function toIsoDate(value: string): string {
  const normalized = value.trim().replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return normalized;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function punchKindFromInout(code: string, time = ""): PunchKind {
  const normalized = code.trim().toLowerCase();
  if (normalized === "1" || normalized === "out" || normalized === "check-out") return "out";
  if (normalized === "2" || normalized === "breakout" || normalized === "break-out") return "breakOut";
  if (normalized === "3" || normalized === "breakin" || normalized === "break-in") return "breakIn";
  if (normalized === "0") {
    const minutes = minutesFromTime(time);
    if (minutes >= 15 * 60) return "out";
    if (minutes >= 13 * 60) return "breakIn";
    if (minutes >= 11 * 60) return "breakOut";
  }
  return "in";
}

function parseDeviceRawPunchLine(line: string) {
  let cells = line.split(/[,;\t]/).map((value) => value.trim()).filter(Boolean);
  if (cells.length < 7) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 8) {
      cells = [tokens[0], tokens[1], tokens[2], tokens[3], tokens[4], tokens[5], `${tokens[6]} ${tokens[7]}`];
    }
  }
  if (cells.length < 7) return undefined;
  const [rawNo, machineNo, enrollNo, deviceName, inoutCode, verifyMode] = cells;
  const rawDateTime = cells.slice(6).join(" ").trim();
  const dateTimeMatch = rawDateTime.match(/^(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s+(\d{1,2}:\d{2})(?::\d{2})?/);
  if (!dateTimeMatch) return undefined;
  return {
    rawNo,
    machineNo,
    enrollNo,
    deviceName,
    inoutCode,
    verifyMode,
    rawDateTime,
    date: toIsoDate(dateTimeMatch[1]),
    time: dateTimeMatch[2].padStart(5, "0"),
    kind: punchKindFromInout(inoutCode, dateTimeMatch[2].padStart(5, "0")),
  };
}

function App() {
  const [data, setData] = useState<AppData>(loadInitialData);
  const [lang, setLang] = useState<Lang>(loadInitialLang);
  const [unlocked, setUnlocked] = useState<boolean>(
    () => !data.settings.requirePassword || window.sessionStorage.getItem(SESSION_KEY) === "ok",
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [usbTokenInput, setUsbTokenInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [activeView, setActiveView] = useState<ViewId>("thisMonth");
  const [monthStage, setMonthStage] = useState<MonthStage>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("lists");
  const [employeeListMode, setEmployeeListMode] = useState(true);
  const [shiftListMode, setShiftListMode] = useState(true);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [autoShiftSimTime, setAutoShiftSimTime] = useState("10:20");
  const [addEmployeeDraft, setAddEmployeeDraft] = useState({
    enrollNo: "",
    workNo: "",
    lastName: "",
    firstName: "",
    gender: "male" as Gender,
  });
  const [addEmployeeErrors, setAddEmployeeErrors] = useState<Record<string, boolean>>({});
  const [selectedMonth, setSelectedMonth] = useState(data.settings.defaultMonth);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(() => {
    const stored = window.localStorage.getItem(FOCUS_EMPLOYEE_KEY) ?? "";
    if (stored && data.employees.some((employee) => employee.id === stored)) return stored;
    return data.employees.find((employee) => employee.active)?.id ?? "";
  });
  const [selectedShiftId, setSelectedShiftId] = useState(data.shifts[0]?.id ?? "");
  const [selectedDate, setSelectedDate] = useState(data.settings.businessDate);
  const [punchTimes, setPunchTimes] = useState<Record<PunchKind, string>>(emptyPunchTimes);
  const [punchNote, setPunchNote] = useState("");
  const [punchNoteError, setPunchNoteError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [savedToast, setSavedToast] = useState<{ id: number; text: string } | null>(null);
  const showSavedToast = (text: string = t("savedToast")) => {
    setSavedToast({ id: Date.now(), text });
  };
  useEffect(() => {
    if (!savedToast) return;
    const id = savedToast.id;
    const timer = window.setTimeout(() => {
      setSavedToast((current) => (current && current.id === id ? null : current));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [savedToast]);
  const [importPasteText, setImportPasteText] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeFilters, setEmployeeFilters] = useState({ ...defaultEmployeeFilters });
  const [bulkSelectedEmployeeIds, setBulkSelectedEmployeeIds] = useState<string[]>([]);
  const [advancedEmployeeFiltersOpen, setAdvancedEmployeeFiltersOpen] = useState(false);
  const [bulkSetupOpen, setBulkSetupOpen] = useState(false);
  const [individualAttendanceRulesEditing, setIndividualAttendanceRulesEditing] = useState(false);
  const [bulkConditionDraft, setBulkConditionDraft] = useState({
    workMode: "fixed" as ConditionWorkMode,
    shiftId: data.shifts[0]?.id ?? "",
    workLengthHours: 8,
    flexibleLunch: false,
    lunchMinutes: 60,
    graceMinutes: 0,
    exemptions: { ...defaultExemptions },
  });
  const [timecardSearch, setTimecardSearch] = useState("");
  const [timecardStatusFilter, setTimecardStatusFilter] = useState<TimecardStatusFilter>("all");
  const [timecardQueueMode, setTimecardQueueMode] = useState<TimecardQueueMode>("employee");
  const [timecardPage, setTimecardPage] = useState(1);
  const [timecardPageSize, setTimecardPageSize] = useState(10);
  const [timecardDetailOpen, setTimecardDetailOpen] = useState(false);
  const [timecardWorkflowTab, setTimecardWorkflowTab] = useState<TimecardWorkflowTab>("monthly");
  const [activeTimecardReviewItemId, setActiveTimecardReviewItemId] = useState<string | null>(null);
  const [timecardWorkflowPrompt, setTimecardWorkflowPrompt] = useState<TimecardWorkflowPrompt | null>(null);
  const [employeeReviewFilter, setEmployeeReviewFilter] = useState<EmployeeReviewFilter>("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportId>("summary");
  const [reportSelectedRowIds, setReportSelectedRowIds] = useState<string[]>([]);
  const [payrollSelectedEmployeeIds, setPayrollSelectedEmployeeIds] = useState<string[]>([]);
  const [deductionDecisionDrafts, setDeductionDecisionDrafts] = useState<Record<string, AttendanceReviewDecision>>({});
  const [deductionAmountModeDrafts, setDeductionAmountModeDrafts] = useState<Record<string, AttendanceReviewAmountMode>>({});
  const [deductionOptionDrafts, setDeductionOptionDrafts] = useState<Record<string, string>>({});
  const [deductionRemarkDrafts, setDeductionRemarkDrafts] = useState<Record<string, string>>({});
  const [absentLeaveTypeDrafts, setAbsentLeaveTypeDrafts] = useState<Record<string, string>>({});
  const [companyFilter, setCompanyFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [reportEmployeeFilter, setReportEmployeeFilter] = useState("all");
  const [holidayDraft, setHolidayDraft] = useState({ date: data.settings.businessDate, name: "" });
  const [holidayYear, setHolidayYear] = useState<string>(() => data.settings.businessDate.slice(0, 4));
  const [newCompany, setNewCompany] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [newNationality, setNewNationality] = useState("");
  const [newLeaveType, setNewLeaveType] = useState("");
  const [newCorrectionReason, setNewCorrectionReason] = useState("");
  const [newDeductionReason, setNewDeductionReason] = useState("");
  const [newDeductionAmountOption, setNewDeductionAmountOption] = useState({ label: "", amount: "" });
  const [editingDeductionAmountOptionId, setEditingDeductionAmountOptionId] = useState<string | null>(null);
  const [editingDeductionAmountOption, setEditingDeductionAmountOption] = useState({ label: "", amount: "" });
  const initialLeaveDraftType = data.settings.leaveTypes.find((type) => !isMcRequiredLeaveType(type, data)) ?? data.settings.leaveTypes[0] ?? "Annual leave";
  const [leaveDraft, setLeaveDraft] = useState<LeaveFormDraft>({
    employeeId: selectedEmployeeId,
    date: data.settings.businessDate,
    type: initialLeaveDraftType,
    hours: 8,
    mcStatus: (isMcRequiredLeaveType(initialLeaveDraftType, data) ? "pending" : "notRequired") as NonNullable<LeaveEntry["mcStatus"]>,
    approvalStatus: "approved" as NonNullable<LeaveEntry["approvalStatus"]>,
    mcAttachment: undefined as LeaveMcAttachment | undefined,
    note: "",
  });
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [editingLeaveDraft, setEditingLeaveDraft] = useState<LeaveFormDraft | null>(null);
  const [otSimEmployeeId, setOtSimEmployeeId] = useState(selectedEmployeeId);
  const [otSimDate, setOtSimDate] = useState(data.settings.businessDate);
  const [otSimClockOut, setOtSimClockOut] = useState("23:00");
  const [correctionReason, setCorrectionReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const initialDataRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setIndividualAttendanceRulesEditing(false);
  }, [selectedEmployeeId, employeeListMode]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (initialDataRef.current) {
      initialDataRef.current = false;
      return;
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      setSavedToast((current) => current ?? { id: Date.now(), text: t("savedToast") });
      saveTimerRef.current = null;
    }, 600);
  }, [data]);

  useEffect(() => {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    document.documentElement.lang = lang === "en" ? "en" : "zh-Hans";
  }, [lang]);

  useEffect(() => {
    if (selectedEmployeeId) window.localStorage.setItem(FOCUS_EMPLOYEE_KEY, selectedEmployeeId);
  }, [selectedEmployeeId]);

  useEffect(() => {
    setEmployeeReviewFilter("all");
    setActiveTimecardReviewItemId(null);
    setTimecardWorkflowPrompt(null);
  }, [selectedEmployeeId, selectedMonth]);

  useEffect(() => {
    if (!otSimEmployeeId && selectedEmployeeId) setOtSimEmployeeId(selectedEmployeeId);
  }, [otSimEmployeeId, selectedEmployeeId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey && (event.key === "l" || event.key === "L")) {
        event.preventDefault();
        setLang((current) => (current === "zh" ? "en" : "zh"));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!data.settings.requirePassword) setUnlocked(true);
  }, [data.settings.requirePassword]);

  function handleLogin() {
    if (passwordInput !== data.settings.hrPassword) {
      setLoginError(t("loginErrorPassword"));
      return;
    }
    if (data.settings.usbLicenseRequired && data.settings.usbToken && usbTokenInput !== data.settings.usbToken) {
      setLoginError(t("loginErrorUsb"));
      return;
    }
    setUnlocked(true);
    setLoginError("");
    setPasswordInput("");
    setUsbTokenInput("");
    window.sessionStorage.setItem(SESSION_KEY, "ok");
  }

  function handleLogout() {
    setUnlocked(false);
    window.sessionStorage.removeItem(SESSION_KEY);
  }

  function openThisMonth(stage: MonthStage = "home") {
    setMonthStage(stage);
    setActiveView("thisMonth");
  }

  function openTimecards(filter: TimecardStatusFilter = "all") {
    setTimecardStatusFilter(filter);
    setTimecardPage(1);
    setTimecardDetailOpen(false);
    setActiveTimecardReviewItemId(null);
    setTimecardWorkflowPrompt(null);
    openThisMonth("timecards");
  }

  function openTimecardDetail(employeeId: string, date: string, workflowTab: TimecardWorkflowTab = "monthly", reviewItemId?: string | null) {
    setSelectedEmployeeId(employeeId);
    setSelectedDate(date);
    setTimecardWorkflowTab(workflowTab);
    setActiveTimecardReviewItemId(reviewItemId ?? (workflowTab === "fix" || workflowTab === "deduction" ? null : `ot-${employeeId}-${date}`));
    setTimecardWorkflowPrompt(null);
    setTimecardStatusFilter("all");
    setTimecardPage(1);
    setTimecardDetailOpen(true);
    openThisMonth("timecards");
  }

  function openReports(type: ReportId = "summary") {
    setReportType(type);
    setActiveView("reports");
  }

  function openEmployeeMonthlyReport(employeeId: string) {
    setSelectedEmployeeId(employeeId);
    openReports("personal");
  }

  const activeEmployees = useMemo(() => data.employees.filter((employee) => employee.active), [data.employees]);
  const selectedEmployee = useMemo(
    () => data.employees.find((employee) => employee.id === selectedEmployeeId) ?? data.employees[0],
    [data.employees, selectedEmployeeId],
  );
  const selectedShift = useMemo(
    () => data.shifts.find((shift) => shift.id === selectedShiftId) ?? data.shifts[0],
    [data.shifts, selectedShiftId],
  );

  useEffect(() => {
    if (selectedEmployee) {
      const record = calculateAttendance(data, selectedEmployee, selectedDate);
      setPunchTimes({
        in: record.clockIn,
        breakOut: record.breakOut,
        breakIn: record.breakIn,
        out: record.clockOut,
      });
    }
  }, [data, selectedDate, selectedEmployee]);

  useEffect(() => {
    if (!data.employees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(data.employees[0]?.id ?? "");
    }
    if (!data.shifts.some((shift) => shift.id === selectedShiftId)) {
      setSelectedShiftId(data.shifts[0]?.id ?? "");
    }
  }, [data.employees, data.shifts, selectedEmployeeId, selectedShiftId]);

  useEffect(() => {
    const employeeIds = new Set(data.employees.map((employee) => employee.id));
    setBulkSelectedEmployeeIds((current) => current.filter((id) => employeeIds.has(id)));
  }, [data.employees]);

  const monthRecords = useMemo(() => getRecordsForMonth(data, selectedMonth, activeEmployees), [data, selectedMonth, activeEmployees]);
  const monthlyReadiness = useMemo(
    () => getMonthlyReadiness(data, selectedMonth, activeEmployees),
    [activeEmployees, data, selectedMonth],
  );
  const deductionReviewItems = useMemo(
    () => getDeductionReviewItems(data, selectedMonth, activeEmployees),
    [activeEmployees, data, selectedMonth],
  );
  const monthSummaries = useMemo(
    () => activeEmployees.map((employee) => summarizeEmployee(data, employee, selectedMonth)),
    [activeEmployees, data, selectedMonth],
  );

  const filteredEmployees = useMemo(() => {
    return data.employees.filter((employee) => {
      if (!employee.active) return false;
      if (companyFilter !== "all" && employee.company !== companyFilter) return false;
      if (departmentFilter !== "all" && employee.department !== departmentFilter) return false;
      if (selectedEmployeeId && reportType === "personal" && employee.id !== selectedEmployeeId) return false;
      if (reportType !== "personal" && reportEmployeeFilter !== "all" && employee.id !== reportEmployeeFilter) return false;
      return true;
    });
  }, [companyFilter, data.employees, departmentFilter, reportEmployeeFilter, reportType, selectedEmployeeId]);

  const filteredRecords = useMemo(() => getRecordsForMonth(data, selectedMonth, filteredEmployees), [data, filteredEmployees, selectedMonth]);
  const reportRecords = useMemo(
    () => (monthlyReadiness.hasOperationalData ? filteredRecords : []),
    [filteredRecords, monthlyReadiness.hasOperationalData],
  );
  const reportEmployees = useMemo(
    () => (monthlyReadiness.hasOperationalData ? filteredEmployees : []),
    [filteredEmployees, monthlyReadiness.hasOperationalData],
  );
  const t = useMemo(() => makeT(lang), [lang]);

  function handlePrint(
    selector: string,
    title: string,
    defaultOrientation: PrintOrientation = "portrait",
    lockOrientation = false,
  ) {
    openPrintableView(selector, title, {
      previewTitle: t("printPreviewTitle"),
      print: t("printButton"),
      close: t("printPreviewClose"),
      hint: t("printPreviewHint"),
      portrait: t("printPortrait"),
      landscape: t("printLandscape"),
    }, defaultOrientation, lockOrientation);
  }

  function patchEmployee(id: string, patch: Partial<Employee>) {
    setData((current) => ({
      ...current,
      employees: current.employees.map((employee) => (employee.id === id ? normalizeEmployeeConditions({ ...employee, ...patch }) : employee)),
    }));
  }

  function employeeConditionSummary(employee: Employee): string[] {
    const summary = [
      employee.flexibleWork
        ? t("conditionFlexibleWorkShort", { hours: employee.workLengthHours })
        : employee.autoShift
          ? t("conditionAutoShiftShort")
          : t("conditionFixedShiftShort"),
    ];
    if (employee.flexibleLunch) summary.push(t("conditionFlexibleLunchShort", { mins: employee.lunchMinutes }));
    if (employee.graceMinutes > 0) summary.push(t("conditionGraceShort", { mins: employee.graceMinutes }));
    const waiverCount = Object.values(employee.exemptions).filter(Boolean).length;
    if (waiverCount > 0) summary.push(t("conditionWaiverShort", { count: waiverCount }));
    return summary;
  }

  function employeeWorkRuleSummary(employee: Employee): string {
    if (employee.flexibleWork) return t("employeeRuleWorkFlexible", { hours: employee.workLengthHours });
    if (employee.autoShift) return t("employeeRuleWorkAuto");
    return t("employeeRuleWorkFixed");
  }

  function employeeLunchRuleSummary(employee: Employee): string {
    return employee.flexibleLunch
      ? t("employeeRuleLunchFlexible", { mins: employee.lunchMinutes })
      : t("employeeRuleLunchFixed");
  }

  function employeeRestDaySummary(employee: Employee): string {
    if (!employee.restDays.length) return t("notSet");
    return employee.restDays
      .slice()
      .sort((a, b) => weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b))
      .map((day) => weekdayLabels[lang][day])
      .join(", ");
  }

  function employeeExemptionSummary(employee: Employee): string {
    const labels = [
      employee.exemptions.late ? t("exemptLate") : "",
      employee.exemptions.early ? t("exemptEarly") : "",
      employee.exemptions.lunchPunch ? t("exemptLunchPunch") : "",
      employee.exemptions.overtime ? t("exemptOvertime") : "",
    ].filter(Boolean);
    return labels.length ? labels.join(", ") : t("conditionNoWaivers");
  }

  function buildConditionPatchFromDraft(): Partial<Employee> {
    const flexibleWork = bulkConditionDraft.workMode === "flexible";
    const conditionPatch: Partial<Employee> = {
      autoShift: bulkConditionDraft.workMode === "auto" && !flexibleWork,
      flexibleWork,
      flexibleLunch: bulkConditionDraft.flexibleLunch,
      lunchMinutes: bulkConditionDraft.lunchMinutes,
      exemptions: { ...bulkConditionDraft.exemptions },
    };
    if (flexibleWork) {
      conditionPatch.workLengthHours = bulkConditionDraft.workLengthHours;
    } else {
      conditionPatch.graceMinutes = bulkConditionDraft.graceMinutes;
    }
    if (bulkConditionDraft.workMode === "fixed") {
      conditionPatch.shiftId = bulkConditionDraft.shiftId || (data.shifts[0]?.id ?? "");
    }
    return conditionPatch;
  }

  function applyBulkConditions() {
    const targetIds = new Set(bulkSelectedEmployeeIds);
    if (targetIds.size === 0) return;
    const conditionPatch = buildConditionPatchFromDraft();
    setData((current) => ({
      ...current,
      employees: current.employees.map((employee) =>
        targetIds.has(employee.id) ? normalizeEmployeeConditions({ ...employee, ...conditionPatch }) : employee,
      ),
    }));
    setBulkSelectedEmployeeIds([]);
    showSavedToast(t("bulkConditionsApplied", { count: targetIds.size }));
  }

  function toggleBulkEmployeeSelection(employeeId: string, checked: boolean) {
    setBulkSelectedEmployeeIds((current) => {
      if (checked) return current.includes(employeeId) ? current : [...current, employeeId];
      return current.filter((id) => id !== employeeId);
    });
  }

  function setBulkSelectionFor(ids: string[], selected: boolean) {
    setBulkSelectedEmployeeIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => {
        if (selected) next.add(id);
        else next.delete(id);
      });
      return Array.from(next);
    });
  }

  function clearEmployeeFilters() {
    setEmployeeSearch("");
    setEmployeeFilters({ ...defaultEmployeeFilters });
  }

  function patchShift(id: string, patch: Partial<Shift>) {
    setData((current) => ({
      ...current,
      shifts: current.shifts.map((shift) => (shift.id === id ? normalizeShiftRules({ ...shift, ...patch }) : shift)),
    }));
  }

  function patchShiftDay(id: string, weekday: Weekday, patch: Partial<DaySchedule>) {
    setData((current) => ({
      ...current,
      shifts: current.shifts.map((shift) =>
        shift.id === id
          ? {
              ...shift,
              days: {
                ...shift.days,
                [weekday]: { ...shift.days[weekday], ...patch },
              },
            }
          : shift,
      ),
    }));
  }

  function employeeRequiredErrorFlags(employee: Pick<Employee, "enrollNo" | "workNo" | "lastName" | "firstName" | "gender">) {
    return {
      enrollNo: !employee.enrollNo.trim(),
      workNo: !employee.workNo.trim(),
      lastName: !employee.lastName.trim(),
      firstName: !employee.firstName.trim(),
      gender: !employee.gender,
    };
  }

  function employeeRequiredErrors(employee: Pick<Employee, "enrollNo" | "workNo" | "lastName" | "firstName" | "gender">) {
    const flags = employeeRequiredErrorFlags(employee);
    const error = t("requiredFieldError");
    return {
      enrollNo: flags.enrollNo ? error : "",
      workNo: flags.workNo ? error : "",
      lastName: flags.lastName ? error : "",
      firstName: flags.firstName ? error : "",
      gender: flags.gender ? error : "",
    };
  }

  function hasErrors(errors: Record<string, string | boolean>): boolean {
    return Object.values(errors).some(Boolean);
  }

  function openAddEmployee() {
    const nextEnroll = `${1000 + data.employees.length + 1}`;
    const nextWorkNo = `EMP-${String(data.employees.length + 1).padStart(3, "0")}`;
    setAddEmployeeDraft({
      enrollNo: nextEnroll,
      workNo: nextWorkNo,
      lastName: "",
      firstName: "",
      gender: "male",
    });
    setAddEmployeeErrors({});
    setAddEmployeeOpen(true);
    setActiveView("employees");
    setEmployeeListMode(true);
  }

  function commitAddEmployee() {
    const draft = addEmployeeDraft;
    const errors = employeeRequiredErrorFlags(draft);
    setAddEmployeeErrors(errors);
    if (hasErrors(errors)) {
      return;
    }
    const employee: Employee = {
      id: `emp-${Date.now()}`,
      enrollNo: draft.enrollNo.trim(),
      workNo: draft.workNo.trim(),
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      gender: draft.gender,
      idNo: "",
      birthDate: "",
      birthPlace: "",
      address: "",
      nationality: data.settings.nationalities[0] ?? "Malaysia",
      company: data.settings.companies[0] ?? "",
      department: data.settings.departments[0] ?? "",
      position: data.settings.positions[0] ?? "",
      joinDate: data.settings.businessDate,
      shiftId: data.shifts[0]?.id ?? "",
      autoShift: false,
      flexibleWork: false,
      workLengthHours: 8,
      flexibleLunch: false,
      lunchMinutes: 60,
      graceMinutes: 0,
      restDays: [0],
      shiftOverrides: {},
      restOverrides: {},
      exemptions: { ...defaultExemptions },
      salary: { type: "monthly", currency: "MYR", monthlyAmount: 0, hourlyRate: 0, otMultiplier: 1.5, leaveDeductPerDay: 0 },
      active: true,
    };
    setData((current) => ({ ...current, employees: [...current.employees, employee] }));
    setSelectedEmployeeId(employee.id);
    setAddEmployeeOpen(false);
    setAddEmployeeErrors({});
    setEmployeeListMode(false);
  }

  function setShiftOverride(employeeId: string, date: string, shiftId: string | null) {
    setData((current) => ({
      ...current,
      employees: current.employees.map((employee) => {
        if (employee.id !== employeeId) return employee;
        const next = { ...employee.shiftOverrides };
        if (shiftId) next[date] = shiftId;
        else delete next[date];
        return { ...employee, shiftOverrides: next };
      }),
    }));
  }

  function setRestOverride(employeeId: string, date: string, rest: boolean | null) {
    setData((current) => ({
      ...current,
      employees: current.employees.map((employee) => {
        if (employee.id !== employeeId) return employee;
        const next = { ...employee.restOverrides };
        if (rest === null) delete next[date];
        else next[date] = rest;
        return { ...employee, restOverrides: next };
      }),
    }));
  }

  function addShift() {
    const template = data.shifts[0];
    if (!template) return;
    const shift: Shift = {
      ...template,
      id: `shift-${Date.now()}`,
      name: t("newShiftName"),
      code: "N",
      color: "#6f6a2f",
      days: Object.fromEntries(Object.entries(template.days).map(([day, schedule]) => [day, { ...schedule }])) as Shift["days"],
    };
    setData((current) => ({ ...current, shifts: [...current.shifts, shift] }));
    setSelectedShiftId(shift.id);
  }

  function savePunchesForDate() {
    if (!selectedEmployee) return;
    const reason = correctionReasonText(correctionReason, punchNote);
    if (!reason) {
      setPunchNoteError(t("timecardReasonRequired"));
      return;
    }
    setPunchNoteError("");
    let stillPending = false;
    setData((current) => {
      const employee = current.employees.find((item) => item.id === selectedEmployee.id) ?? selectedEmployee;
      const currentRecord = calculateAttendance(current, employee, selectedDate);
      const kinds: PunchKind[] = ["in", "breakOut", "breakIn", "out"];
      const relatedCorrectionReason = normalizeDataValue(correctionReason);
      const nextPunches = kinds
        .filter((kind) => punchTimes[kind])
        .map<Punch>((kind) => ({
          id: makePunchId(employee.id, selectedDate, kind),
          employeeId: employee.id,
          date: punchDateForAttendanceTime(selectedDate, currentRecord.schedule, kind, punchTimes[kind]),
          time: punchTimes[kind],
          kind,
          source: "manual",
          note: reason,
        }));
      const currentRecordPunchIds = new Set(currentRecord.punches.map((punch) => punch.id));
      const audit: TimecardCorrectionAudit = {
        id: timecardCorrectionTargetId(employee.id, selectedDate),
        targetId: timecardCorrectionTargetId(employee.id, selectedDate),
        employeeId: employee.id,
        date: selectedDate,
        action: "save",
        actor: t("timecardAuditActorHr"),
        reason,
        changedAt: new Date().toISOString(),
        beforePunches: auditPunchSnapshot(currentRecord.punches),
        afterPunches: auditPunchSnapshot(nextPunches),
      };
      const nextData = {
        ...current,
        punches: [
          ...current.punches.filter((punch) => {
            if (punch.employeeId !== employee.id) return true;
            return !currentRecordPunchIds.has(punch.id);
          }),
          ...nextPunches,
        ],
        timecardCorrectionAudits: upsertTimecardCorrectionAudit(current.timecardCorrectionAudits ?? [], audit),
        attendanceReviews: (current.attendanceReviews ?? []).map((review) =>
          review.employeeId === employee.id && review.date === selectedDate
            ? { ...review, relatedCorrectionReason }
            : review,
        ),
      };
      const nextRecord = calculateAttendance(nextData, employee, selectedDate);
      stillPending =
        nextRecord.status === "absent" ||
        nextRecord.status === "incomplete" ||
        nextRecord.lateMinutes > 0 ||
        nextRecord.earlyMinutes > 0 ||
        nextRecord.overtimeMinutes > 0 ||
        nextRecord.flags.some((flag) => flag.kind === "lunchOver" || flag.kind === "underWork");
      return nextData;
    });
    showSavedToast(stillPending ? t("timecardSavedStillPending") : t("timecardSavedResolved"));
    setTimecardWorkflowPrompt({ kind: "fixSaved", stillPending });
    setTimecardWorkflowTab("monthly");
    setActiveTimecardReviewItemId(null);
    setCorrectionReason("");
    setPunchNote("");
  }

  function clearPunchesForDate() {
    if (!selectedEmployee) return;
    const reason = correctionReasonText(correctionReason, punchNote);
    if (!reason) {
      setPunchNoteError(t("timecardReasonRequired"));
      return;
    }
    setPunchNoteError("");
    setData((current) => {
      const employee = current.employees.find((item) => item.id === selectedEmployee.id) ?? selectedEmployee;
      const currentRecord = calculateAttendance(current, employee, selectedDate);
      const currentRecordPunchIds = new Set(currentRecord.punches.map((punch) => punch.id));
      const relatedCorrectionReason = normalizeDataValue(correctionReason);
      const audit: TimecardCorrectionAudit = {
        id: timecardCorrectionTargetId(employee.id, selectedDate),
        targetId: timecardCorrectionTargetId(employee.id, selectedDate),
        employeeId: employee.id,
        date: selectedDate,
        action: "clear",
        actor: t("timecardAuditActorHr"),
        reason,
        changedAt: new Date().toISOString(),
        beforePunches: auditPunchSnapshot(currentRecord.punches),
        afterPunches: [],
      };
      return {
        ...current,
        punches: current.punches.filter((punch) => {
          if (punch.employeeId !== employee.id) return true;
          return !currentRecordPunchIds.has(punch.id);
        }),
        timecardCorrectionAudits: upsertTimecardCorrectionAudit(current.timecardCorrectionAudits ?? [], audit),
        attendanceReviews: (current.attendanceReviews ?? []).map((review) =>
          review.employeeId === employee.id && review.date === selectedDate
            ? { ...review, relatedCorrectionReason }
            : review,
        ),
      };
    });
    setTimecardWorkflowPrompt({ kind: "fixCleared" });
    setTimecardWorkflowTab("monthly");
    setActiveTimecardReviewItemId(null);
    setCorrectionReason("");
    setPunchNote("");
  }

  function punchUniqueKey(punch: Pick<Punch, "employeeId" | "date" | "kind"> & Partial<Pick<Punch, "rawDateTime" | "rawNo" | "time">>): string {
    if (punch.rawDateTime || punch.rawNo) {
      return `${punch.employeeId}|${punch.date}|${punch.time ?? ""}|${punch.rawNo ?? punch.rawDateTime ?? ""}`;
    }
    return `${punch.employeeId}|${punch.date}|${punch.kind}`;
  }

  function importPunchText(text: string, sourceLabel = t("fileSourceLabel")) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const imported = new Map<string, Punch>();
    const skipped: string[] = [];

    lines.forEach((line, index) => {
      if (index === 0 && /enroll|员工|date|tmno|enno|datetime/i.test(line)) return;
      const rawPunch = parseDeviceRawPunchLine(line);
      if (rawPunch) {
        const employee = data.employees.find((item) => item.enrollNo === rawPunch.enrollNo);
        if (!employee) {
          skipped.push(line);
          return;
        }
        const punch: Punch = {
          id: makePunchId(employee.id, rawPunch.date, rawPunch.kind),
          employeeId: employee.id,
          date: rawPunch.date,
          time: rawPunch.time,
          kind: rawPunch.kind,
          source: "import",
          note: sourceLabel,
          rawNo: rawPunch.rawNo,
          machineNo: rawPunch.machineNo,
          deviceEnrollNo: rawPunch.enrollNo,
          deviceName: rawPunch.deviceName,
          inoutCode: rawPunch.inoutCode,
          verifyMode: rawPunch.verifyMode,
          rawDateTime: rawPunch.rawDateTime,
        };
        imported.set(punchUniqueKey(punch), punch);
        return;
      }
      const [enrollNo, date, time, kindValue, note = sourceLabel] = line.split(/[,;\t]/).map((value) => value.trim());
      const employee = data.employees.find((item) => item.enrollNo === enrollNo);
      const kind = parsePunchKind(kindValue);
      if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !kind) {
        skipped.push(line);
        return;
      }
      const punch: Punch = {
        id: makePunchId(employee.id, date, kind),
        employeeId: employee.id,
        date,
        time,
        kind,
        source: "import",
        note: note || sourceLabel,
      };
      imported.set(punchUniqueKey(punch), punch);
    });

    const nextPunches = Array.from(imported.values());
    if (nextPunches.length === 0) {
      setImportMessage(t("noImportsSummary", { skipped: skipped.length }));
      return;
    }

    const importedKeys = new Set(nextPunches.map(punchUniqueKey));
    const replacedCount = data.punches.filter((punch) => importedKeys.has(punchUniqueKey(punch))).length;
    setData((current) => ({
      ...current,
      punches: [...current.punches.filter((punch) => !importedKeys.has(punchUniqueKey(punch))), ...nextPunches],
    }));
    setImportMessage(
      t("importedSummary", { imported: nextPunches.length, replaced: replacedCount, skipped: skipped.length }),
    );
  }

  async function importPunchFile(file: File) {
    const text = await file.text();
    importPunchText(text, file.name || t("fileSourceLabel"));
  }

  function importPastedPunches() {
    importPunchText(importPasteText, t("pasteSourceLabel"));
    setImportPasteText("");
  }

  function loadDemoData() {
    const seed = createSeedData();
    const seedShiftById = new Map(seed.shifts.map((shift) => [shift.id, shift]));
    const seedEmployees = seed.employees.map((employee) => hydrateEmployee(employee, seedShiftById.get(employee.shiftId)));
    const seedShifts = seed.shifts.map(hydrateShift);
    const seedLeaves = seed.leaves.map(hydrateLeave);
    const seedPunches = seed.punches.map(hydratePunch);
    setData((current) => {
      const sampleLeaveIds = new Set(seedLeaves.map((leave) => leave.id));
      const currentEmployeeIds = new Set(current.employees.map((employee) => employee.id));
      const currentShiftIds = new Set(current.shifts.map((shift) => shift.id));
      return {
        ...current,
        // Loading sample records must not overwrite HR's employee master data,
        // salaries, shifts, departments, holidays, or security settings.
        employees: [
          ...current.employees,
          ...seedEmployees.filter((employee) => !currentEmployeeIds.has(employee.id)),
        ],
        shifts: [
          ...current.shifts,
          ...seedShifts.filter((shift) => !currentShiftIds.has(shift.id)),
        ],
        leaves: [...current.leaves.filter((leave) => !sampleLeaveIds.has(leave.id)), ...seedLeaves],
        punches: seedPunches,
        attendanceReviews: [],
        timecardCorrectionAudits: [],
      };
    });
    setSelectedMonth(seed.settings.defaultMonth);
    setSelectedDate("2026-04-01");
    setSelectedEmployeeId("emp-006");
    setSelectedShiftId("shift-night");
    setImportMessage(t("demoLoadedMessage", {
      employees: Math.max(data.employees.filter((employee) => employee.active).length, seed.employees.filter((employee) => employee.active).length),
      shifts: Math.max(data.shifts.length, seed.shifts.length),
      punches: seed.punches.length,
    }));
  }

  function clearImportedPunches() {
    setData((current) => ({ ...current, punches: [], leaves: [], attendanceReviews: [], timecardCorrectionAudits: [] }));
    setImportMessage(t("demoClearedMessage"));
  }

  function addHoliday() {
    if (!holidayDraft.date || !holidayDraft.name.trim()) return;
    setData((current) => ({
      ...current,
      holidays: [...current.holidays, { id: `holiday-${Date.now()}`, date: holidayDraft.date, name: holidayDraft.name.trim() }],
    }));
    setHolidayDraft({ ...holidayDraft, name: "" });
  }

  function removeHoliday(id: string) {
    const holiday = data.holidays.find((h) => h.id === id);
    if (!holiday) return;
    if (!window.confirm(t("confirmDeleteHoliday", { date: holiday.date, name: holiday.name }))) return;
    setData((current) => ({ ...current, holidays: current.holidays.filter((h) => h.id !== id) }));
  }

  const mcAuditActor = () => t("timecardAuditActorHr");

  function createLeaveMcAuditEntry(
    action: LeaveMcAuditEntry["action"],
    oldValue?: string,
    newValue?: string,
  ): LeaveMcAuditEntry {
    return {
      id: `mc-audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action,
      actor: mcAuditActor(),
      changedAt: new Date().toISOString(),
      oldValue,
      newValue,
    };
  }

  async function buildLeaveMcAttachment(file: File): Promise<LeaveMcAttachment | undefined> {
    if (!isSupportedMcAttachment(file)) {
      window.alert(t("leaveMcAttachmentTypeError"));
      return undefined;
    }
    const dataUrl = await readFileAsDataUrl(file);
    return {
      id: `mc-attachment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      dataUrl,
      uploadedBy: mcAuditActor(),
      uploadedAt: new Date().toISOString(),
    };
  }

  function normalizeLeaveDraftForType(draft: LeaveFormDraft, source: AppData = data): LeaveFormDraft {
    const requiresMc = isMcRequiredLeaveType(draft.type, source);
    return {
      ...draft,
      mcStatus: requiresMc ? draft.mcStatus : "notRequired",
      mcAttachment: requiresMc ? draft.mcAttachment : undefined,
    };
  }

  function leaveDraftFromEntry(leave: LeaveEntry, source: AppData = data): LeaveFormDraft {
    return normalizeLeaveDraftForType({
      employeeId: leave.employeeId,
      date: leave.date,
      type: leave.type,
      hours: leave.hours,
      mcStatus: resolvedLeaveMcStatus(leave, source),
      approvalStatus: resolvedLeaveApprovalStatus(leave),
      mcAttachment: leave.mcAttachment,
      note: leave.note,
    }, source);
  }

  function createLeaveAuditEntry(
    leave: Pick<LeaveEntry, "id" | "employeeId" | "date">,
    action: LeaveAuditEntry["action"],
    field?: string,
    oldValue?: string,
    newValue?: string,
    remark?: string,
  ): LeaveAuditEntry {
    return {
      id: `leave-audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      leaveId: leave.id,
      employeeId: leave.employeeId,
      date: leave.date,
      action,
      field,
      actor: mcAuditActor(),
      changedAt: new Date().toISOString(),
      oldValue,
      newValue,
      remark,
    };
  }

  function leaveAuditFieldLabel(field: string): string {
    switch (field) {
      case "employeeId": return t("colEmployee");
      case "date": return t("colDate");
      case "type": return t("leaveTypeLabel");
      case "hours": return t("leaveHoursLabel");
      case "mcStatus": return t("leaveMcStatusLabel");
      case "mcAttachment": return t("leaveMcAttachmentLabel");
      case "approvalStatus": return t("leaveApprovalStatusLabel");
      case "note": return t("colNote");
      default: return field;
    }
  }

  function leaveAuditValue(field: string, value: string | number | undefined, source: AppData = data): string {
    if (value === undefined || value === "") return "-";
    if (field === "employeeId") {
      const employee = source.employees.find((item) => item.id === value);
      return employee ? `${employee.enrollNo} · ${displayEmployeeName(employee)}` : String(value);
    }
    if (field === "type" || field === "note") return translateDataValue(String(value), lang);
    if (field === "mcStatus") return leaveMcStatusLabel(value as NonNullable<LeaveEntry["mcStatus"]>);
    if (field === "approvalStatus") return leaveApprovalStatusLabel(value as NonNullable<LeaveEntry["approvalStatus"]>);
    return String(value);
  }

  function buildLeaveChangeAudits(before: LeaveEntry, after: LeaveEntry, source: AppData): { rowAudits: LeaveMcAuditEntry[]; globalAudits: LeaveAuditEntry[] } {
    const rowAudits: LeaveMcAuditEntry[] = [];
    const globalAudits: LeaveAuditEntry[] = [];
    const addFieldAudit = (field: keyof Pick<LeaveEntry, "employeeId" | "date" | "type" | "hours" | "note">, oldValue: string | number, newValue: string | number) => {
      if (String(oldValue) === String(newValue)) return;
      const label = leaveAuditFieldLabel(field);
      globalAudits.push(createLeaveAuditEntry(
        after,
        "update",
        label,
        leaveAuditValue(field, oldValue, source),
        leaveAuditValue(field, newValue, source),
        after.note,
      ));
      rowAudits.push(createLeaveMcAuditEntry("field", label, `${leaveAuditValue(field, oldValue, source)} → ${leaveAuditValue(field, newValue, source)}`));
    };

    addFieldAudit("employeeId", before.employeeId, after.employeeId);
    addFieldAudit("date", before.date, after.date);
    addFieldAudit("type", before.type, after.type);
    addFieldAudit("hours", before.hours, after.hours);
    addFieldAudit("note", before.note, after.note);

    const oldMcStatus = resolvedLeaveMcStatus(before, source);
    const newMcStatus = resolvedLeaveMcStatus(after, source);
    if (oldMcStatus !== newMcStatus) {
      rowAudits.push(createLeaveMcAuditEntry("mcStatus", leaveMcStatusLabel(oldMcStatus), leaveMcStatusLabel(newMcStatus)));
      globalAudits.push(createLeaveAuditEntry(after, "update", leaveAuditFieldLabel("mcStatus"), leaveMcStatusLabel(oldMcStatus), leaveMcStatusLabel(newMcStatus), after.note));
    }

    const oldApprovalStatus = resolvedLeaveApprovalStatus(before);
    const newApprovalStatus = resolvedLeaveApprovalStatus(after);
    if (oldApprovalStatus !== newApprovalStatus) {
      rowAudits.push(createLeaveMcAuditEntry("approvalStatus", leaveApprovalStatusLabel(oldApprovalStatus), leaveApprovalStatusLabel(newApprovalStatus)));
      globalAudits.push(createLeaveAuditEntry(after, "update", leaveAuditFieldLabel("approvalStatus"), leaveApprovalStatusLabel(oldApprovalStatus), leaveApprovalStatusLabel(newApprovalStatus), after.note));
    }

    const oldAttachment = before.mcAttachment;
    const newAttachment = after.mcAttachment;
    if (oldAttachment?.id !== newAttachment?.id) {
      const action: LeaveMcAuditEntry["action"] = oldAttachment && newAttachment ? "change" : newAttachment ? "upload" : "remove";
      rowAudits.push(createLeaveMcAuditEntry(action, oldAttachment?.name ?? "", newAttachment?.name ?? ""));
      globalAudits.push(createLeaveAuditEntry(after, "update", leaveAuditFieldLabel("mcAttachment"), oldAttachment?.name ?? "-", newAttachment?.name ?? "-", after.note));
    }

    return { rowAudits, globalAudits };
  }

  async function handleLeaveDraftMcAttachment(file: File | undefined) {
    if (!file) return;
    const attachment = await buildLeaveMcAttachment(file);
    if (!attachment) return;
    setLeaveDraft((current) => ({ ...current, mcAttachment: attachment, mcStatus: "provided" }));
  }

  async function handleEditingLeaveMcAttachment(file: File | undefined) {
    if (!file) return;
    const attachment = await buildLeaveMcAttachment(file);
    if (!attachment) return;
    setEditingLeaveDraft((current) => current ? ({ ...current, mcAttachment: attachment, mcStatus: "provided" }) : current);
  }

  function addLeave() {
    if (!leaveDraft.employeeId || !leaveDraft.date || !leaveDraft.type) return;
    const normalizedDraft = normalizeLeaveDraftForType(leaveDraft);
    const requiresMc = isMcRequiredLeaveType(normalizedDraft.type, data);
    if (requiresMc && normalizedDraft.mcStatus === "provided" && !normalizedDraft.mcAttachment) {
      window.alert(t("leaveMcAttachmentRequired"));
      return;
    }
    const leave: LeaveEntry = {
      id: `leave-${Date.now()}`,
      employeeId: normalizedDraft.employeeId,
      date: normalizedDraft.date,
      type: normalizedDraft.type,
      hours: Number(normalizedDraft.hours) || 8,
      mcStatus: normalizedDraft.mcStatus,
      approvalStatus: normalizedDraft.approvalStatus,
      mcAttachment: normalizedDraft.mcAttachment,
      mcAuditTrail: normalizedDraft.mcAttachment
        ? [createLeaveMcAuditEntry("upload", "", normalizedDraft.mcAttachment.name)]
        : [],
      note: normalizedDraft.note,
    };
    setData((current) => ({
      ...current,
      leaves: [...current.leaves, leave],
      leaveAuditTrail: [
        ...(current.leaveAuditTrail ?? []),
        createLeaveAuditEntry(leave, "create", t("leaveRecordLabel"), "", t("leaveRecordCreated"), leave.note),
      ],
    }));
    setLeaveDraft({
      ...leaveDraft,
      mcStatus: requiresMc ? "pending" : "notRequired",
      mcAttachment: undefined,
      note: "",
    });
  }

  function openLeaveEditor(leave: LeaveEntry) {
    setEditingLeaveId(leave.id);
    setEditingLeaveDraft(leaveDraftFromEntry(leave));
  }

  function closeLeaveEditor() {
    setEditingLeaveId(null);
    setEditingLeaveDraft(null);
  }

  function saveLeaveEdit() {
    if (!editingLeaveId || !editingLeaveDraft) return;
    const normalizedDraft = normalizeLeaveDraftForType(editingLeaveDraft);
    const requiresMc = isMcRequiredLeaveType(normalizedDraft.type, data);
    if (requiresMc && normalizedDraft.mcStatus === "provided" && !normalizedDraft.mcAttachment) {
      window.alert(t("leaveMcAttachmentRequired"));
      return;
    }
    setData((current) => {
      const currentLeave = current.leaves.find((leave) => leave.id === editingLeaveId);
      if (!currentLeave) return current;
      const updatedLeave: LeaveEntry = {
        ...currentLeave,
        employeeId: normalizedDraft.employeeId,
        date: normalizedDraft.date,
        type: normalizedDraft.type,
        hours: Number(normalizedDraft.hours) || 8,
        mcStatus: normalizedDraft.mcStatus,
        approvalStatus: normalizedDraft.approvalStatus,
        mcAttachment: normalizedDraft.mcAttachment,
        note: normalizedDraft.note,
      };
      const { rowAudits, globalAudits } = buildLeaveChangeAudits(currentLeave, updatedLeave, current);
      return {
        ...current,
        leaves: current.leaves.map((leave) =>
          leave.id === editingLeaveId
            ? { ...updatedLeave, mcAuditTrail: [...(leave.mcAuditTrail ?? []), ...rowAudits] }
            : leave,
        ),
        leaveAuditTrail: [...(current.leaveAuditTrail ?? []), ...globalAudits],
      };
    });
    closeLeaveEditor();
  }

  function removeLeave(id: string) {
    const leave = data.leaves.find((item) => item.id === id);
    if (!leave) return;
    const employee = data.employees.find((item) => item.id === leave.employeeId);
    const leaveLabel = `${leave.date} · ${employee ? displayEmployeeName(employee) : leave.employeeId} · ${translateDataValue(leave.type, lang)}`;
    if (!window.confirm(t("confirmDeleteLeave", { value: leaveLabel }))) return;
    setData((current) => ({
      ...current,
      leaves: current.leaves.filter((item) => item.id !== id),
      leaveAuditTrail: [
        ...(current.leaveAuditTrail ?? []),
        createLeaveAuditEntry(leave, "delete", t("leaveRecordLabel"), leaveLabel, "", leave.note),
      ],
    }));
    if (editingLeaveId === id) closeLeaveEditor();
  }

  function deductionIssueLabel(kind: AttendanceReviewKind): string {
    switch (kind) {
      case "late":
        return t("deductionIssueLate");
      case "early":
        return t("deductionIssueEarly");
      case "shortHours":
        return t("deductionIssueShortHours");
      case "absent":
        return t("deductionIssueAbsent");
      case "unpaidLeave":
        return t("deductionIssueUnpaidLeave");
      case "missingPunch":
        return t("deductionIssueMissingPunch");
    }
  }

  function deductionReviewRouteLabel(kind: AttendanceReviewKind): string {
    if (kind === "absent") return t("reviewRouteAbsent");
    if (kind === "unpaidLeave") return t("reviewRouteLeaveDeduction");
    if (kind === "missingPunch") return t("reviewRouteFixTimecard");
    return t("reviewRouteDailyDeduction");
  }

  function deductionDurationLabel(item: DeductionReviewItem): string {
    if (item.kind === "late") return `${recordPunchTime(item.record, "in", lang)} · ${formatDuration(item.durationMinutes, lang)}`;
    if (item.kind === "early") return `${recordPunchTime(item.record, "out", lang)} · ${formatDuration(item.durationMinutes, lang)}`;
    if (item.kind === "missingPunch") return t("deductionDurationRecord");
    if (item.durationMinutes > 0) return formatDuration(item.durationMinutes, lang);
    return t("deductionDurationDay", { count: item.dayCount || 1 });
  }

  function deductionOccurrenceDetailLabel(occurrence: DeductionReviewOccurrence): string {
    if (occurrence.durationMinutes > 0) return formatDuration(occurrence.durationMinutes, lang);
    if (occurrence.dayCount > 0) return t("deductionDurationDay", { count: occurrence.dayCount });
    return t("deductionDurationRecord");
  }

  function deductionDecisionLabel(decision: AttendanceReviewDecision | undefined): string {
    if (decision === "deducted") return t("deductionDecisionDeduct");
    if (decision === "accepted") return t("deductionDecisionNoDeduct");
    if (decision === "convertedToLeave") return t("deductionDecisionConvertToLeave");
    if (decision === "pending") return t("deductionDecisionPendingCorrection");
    return t("deductionDecisionPending");
  }

  function isResolvedReviewDecision(decision: AttendanceReviewDecision | undefined): boolean {
    return decision === "accepted" || decision === "deducted" || decision === "convertedToLeave";
  }

  function absentDecisionLabel(decision: AttendanceReviewDecision): string {
    if (decision === "deducted") return t("deductionDecisionConfirmAbsentDeduct");
    return deductionDecisionLabel(decision);
  }

  function deductionSettingsSourceLabel(item: DeductionReviewItem): string {
    if (item.kind === "unpaidLeave" && item.relatedLeaveType) {
      const requiresMc = isMcRequiredLeaveType(item.relatedLeaveType, data);
      return t("deductionLeaveTypeSetting", {
        type: translateDataValue(item.relatedLeaveType, lang),
        rule: t(item.leavePayRule === "paid" ? "deductionLeaveTypePaid" : "deductionLeaveTypeDeduct"),
        mc: t(requiresMc ? "deductionLeaveMcRequired" : "deductionLeaveMcNotRequired"),
      });
    }
    if (item.kind === "missingPunch") return t("deductionCorrectionReasonSource");
    return t("deductionAttendanceRuleSource");
  }

  function leaveMcStatusLabel(status: NonNullable<LeaveEntry["mcStatus"]>): string {
    if (status === "provided") return t("leaveMcProvided");
    if (status === "notProvided") return t("leaveMcNotProvided");
    if (status === "pending") return t("leaveMcPending");
    return t("leaveMcNotRequired");
  }

  function leaveApprovalStatusLabel(status: NonNullable<LeaveEntry["approvalStatus"]>): string {
    if (status === "approved") return t("leaveApprovalApproved");
    if (status === "rejected") return t("leaveApprovalRejected");
    return t("leaveApprovalPending");
  }

  function leaveMcAuditActionLabel(action: LeaveMcAuditEntry["action"]): string {
    if (action === "upload") return t("leaveMcAuditActionUpload");
    if (action === "change") return t("leaveMcAuditActionChange");
    if (action === "remove") return t("leaveMcAuditActionRemove");
    if (action === "mcStatus") return t("leaveMcAuditActionMcStatus");
    if (action === "field") return t("leaveMcAuditActionField");
    if (action === "delete") return t("leaveMcAuditActionDelete");
    return t("leaveMcAuditActionApprovalStatus");
  }

  function leaveAuditActionLabel(action: LeaveAuditEntry["action"]): string {
    if (action === "create") return t("leaveAuditActionCreate");
    if (action === "delete") return t("leaveAuditActionDelete");
    return t("leaveAuditActionUpdate");
  }

  function decisionPillClass(decision: AttendanceReviewDecision | undefined): string {
    if (decision === "deducted") return "mini-pill-warn";
    if (decision === "accepted") return "mini-pill-good";
    if (decision === "convertedToLeave") return "mini-pill-good";
    if (decision === "pending") return "mini-pill-muted";
    return "mini-pill-muted";
  }

  function deductionRemarkValue(item: DeductionReviewItem): string {
    return deductionRemarkDrafts[item.id] ?? item.note;
  }

  function deductionReasonSelectValue(item: DeductionReviewItem): string {
    const remark = deductionRemarkValue(item);
    if (!remark) return "";
    return data.settings.deductionReasons.includes(remark) ? remark : "__custom__";
  }

  function deductionRuleAmount(item: DeductionReviewItem): number {
    return item.ruleDeductionAmount ?? calculateRuleDeductionAmount(item, "deducted", data.settings);
  }

  function deductionRuleResolution(item: DeductionReviewItem):
    | { available: true; amount: number; source: "employee" | "settings"; message: string }
    | { available: false; amount: 0; message: string } {
    const currency = item.employee.salary.currency || "MYR";
    const settingsAmounts = data.settings.deductionAmounts;
    const formatRuleAmount = (amount: number) => `${currency} ${amount.toFixed(2)}`;
    const resolveEmployeeThenSettingsAmount = (
      employeeAmount: number,
      settingsAmount: number,
      missingMessage: string,
    ) => {
      if (employeeAmount > 0) {
        return {
          available: true as const,
          amount: employeeAmount,
          source: "employee" as const,
          message: t("deductionRuleSourceEmployee", { amount: formatRuleAmount(employeeAmount) }),
        };
      }
      if (settingsAmount > 0) {
        return {
          available: true as const,
          amount: settingsAmount,
          source: "settings" as const,
          message: t("deductionRuleSourceSettingsFallback", { amount: formatRuleAmount(settingsAmount) }),
        };
      }
      return { available: false as const, amount: 0 as const, message: missingMessage };
    };

    if (item.kind === "missingPunch") {
      return { available: false, amount: 0, message: t("deductionRuleUnavailableMissingPunch") };
    }
    if ((item.kind === "absent" || item.kind === "unpaidLeave") && item.employee.salary.type === "hourly") {
      return { available: false, amount: 0, message: t("deductionRuleUnavailableHourlyFullDay") };
    }
    if (item.kind === "absent" || item.kind === "unpaidLeave") {
      if (settingsAmounts.fullDayDeductPerDay <= 0) {
        return { available: false, amount: 0, message: t("deductionRuleUnavailableMissingSettingsFullDay") };
      }
      const amount = (item.dayCount || 1) * settingsAmounts.fullDayDeductPerDay;
      return {
        available: true,
        amount,
        source: "settings",
        message: t("deductionRuleSourceSettings", { amount: formatRuleAmount(settingsAmounts.fullDayDeductPerDay) }),
      };
    }
    if (item.kind === "late" || item.kind === "early" || item.kind === "shortHours") {
      if (item.durationMinutes <= 0) {
        return { available: false, amount: 0, message: t("deductionRuleUnavailableMissingDuration") };
      }
      const base = resolveEmployeeThenSettingsAmount(
        item.employee.salary.hourlyRate,
        settingsAmounts.minuteDeductHourlyRate,
        t("deductionRuleUnavailableMissingHourlyRate"),
      );
      if (!base.available) return base;
      return { ...base, amount: (item.durationMinutes / 60) * base.amount };
    }
    return { available: false, amount: 0, message: t("deductionRuleUnavailableMissingDuration") };
  }

  function storedDeductionAmountMode(item: DeductionReviewItem): AttendanceReviewAmountMode | undefined {
    if (item.amountMode) return item.amountMode;
    if (item.decision === "deducted") return item.deductionOptionId ? "settingsOption" : "rules";
    if (item.decision === "accepted") return "none";
    return undefined;
  }

  function deductionAmountModeValue(item: DeductionReviewItem): AttendanceReviewAmountMode | undefined {
    return deductionAmountModeDrafts[item.id] ?? storedDeductionAmountMode(item);
  }

  function deductionDecisionValue(item: DeductionReviewItem): AttendanceReviewDecision | undefined {
    const draftDecision = deductionDecisionDrafts[item.id];
    if (draftDecision === "pending" || draftDecision === "convertedToLeave") return draftDecision;
    const mode = deductionAmountModeValue(item);
    if (mode === "rules" || mode === "settingsOption") return "deducted";
    if (mode === "none") return "accepted";
    return draftDecision ?? item.decision;
  }

  function absentLeaveTypeValue(item: DeductionReviewItem): string {
    return absentLeaveTypeDrafts[item.id] ?? item.relatedLeaveType ?? data.settings.leaveTypes[0] ?? "";
  }

  function absentLeavePayRule(item: DeductionReviewItem): "paid" | "deduct" {
    const leaveType = absentLeaveTypeValue(item);
    return leaveType && isPaidLeaveType(leaveType, data) ? "paid" : "deduct";
  }

  function absentConvertedLeaveDeductionAmount(item: DeductionReviewItem): number {
    if (absentLeavePayRule(item) === "paid") return 0;
    return calculateRuleDeductionAmount(
      { employee: item.employee, kind: "unpaidLeave", durationMinutes: 0, dayCount: item.dayCount || 1 },
      "deducted",
      data.settings,
    );
  }

  function deductionPresetOptionIdValue(item: DeductionReviewItem): string {
    return deductionOptionDrafts[item.id] ?? item.deductionOptionId ?? "";
  }

  function deductionPresetOptionValue(item: DeductionReviewItem): DeductionAmountOption | undefined {
    const optionId = deductionPresetOptionIdValue(item);
    return data.settings.deductionAmountOptions.find((option) => option.id === optionId);
  }

  function deductionFinalAmountValue(item: DeductionReviewItem): number {
    const decision = deductionDecisionValue(item);
    if (item.kind === "absent" && decision === "convertedToLeave") return absentConvertedLeaveDeductionAmount(item);
    if (decision === "pending") return 0;
    const mode = deductionAmountModeValue(item);
    if (mode === "none") return 0;
    if (mode === "settingsOption") return deductionPresetOptionValue(item)?.amount ?? item.finalDeductionAmount ?? 0;
    if (mode === "rules") return deductionRuleAmount(item);
    if (typeof item.finalDeductionAmount === "number") return item.finalDeductionAmount;
    if (typeof item.payrollImpact === "number") return item.payrollImpact;
    return 0;
  }

  function hasPendingDeductionDraft(item: DeductionReviewItem): boolean {
    const draftDecision = deductionDecisionDrafts[item.id];
    const draftAmountMode = deductionAmountModeDrafts[item.id];
    const draftOption = deductionOptionDrafts[item.id];
    const draftRemark = deductionRemarkDrafts[item.id];
    const draftLeaveType = absentLeaveTypeDrafts[item.id];
    const storedMode = storedDeductionAmountMode(item);
    return Boolean(
      (draftDecision && draftDecision !== item.decision) ||
      (draftAmountMode && draftAmountMode !== storedMode) ||
      (draftOption !== undefined && draftOption !== (item.deductionOptionId ?? "")) ||
      (draftRemark !== undefined && draftRemark !== item.note) ||
      (draftLeaveType !== undefined && draftLeaveType !== item.relatedLeaveType),
    );
  }

  function setDeductionReviewAmountMode(item: DeductionReviewItem, mode: AttendanceReviewAmountMode) {
    setDeductionAmountModeDrafts((current) => ({ ...current, [item.id]: mode }));
    setDeductionDecisionDrafts((current) => ({ ...current, [item.id]: mode === "none" ? "accepted" : "deducted" }));
    if (mode !== "settingsOption") {
      setDeductionOptionDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
  }

  function setDeductionReviewDecision(item: DeductionReviewItem, decision: AttendanceReviewDecision) {
    if (decision === "accepted") {
      setDeductionReviewAmountMode(item, "none");
      return;
    }
    if (decision === "pending" || decision === "convertedToLeave") {
      setDeductionDecisionDrafts((current) => ({ ...current, [item.id]: decision }));
      setDeductionAmountModeDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setDeductionOptionDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      if (decision === "convertedToLeave" && !absentLeaveTypeDrafts[item.id]) {
        setAbsentLeaveTypeDrafts((current) => ({ ...current, [item.id]: item.relatedLeaveType ?? data.settings.leaveTypes[0] ?? "" }));
      }
      return;
    }
    const currentMode = deductionAmountModeValue(item);
    setDeductionReviewAmountMode(item, currentMode === "settingsOption" ? "settingsOption" : "rules");
  }

  function setDeductionReviewPresetOption(item: DeductionReviewItem, optionId: string) {
    const option = data.settings.deductionAmountOptions.find((entry) => entry.id === optionId);
    setDeductionDecisionDrafts((current) => ({ ...current, [item.id]: "deducted" }));
    setDeductionOptionDrafts((current) => ({ ...current, [item.id]: optionId }));
    if (!option) {
      setDeductionAmountModeDrafts((current) => ({ ...current, [item.id]: "settingsOption" }));
      return;
    }
    setDeductionAmountModeDrafts((current) => ({ ...current, [item.id]: "settingsOption" }));
  }

  function nextPendingReviewItemAfter(item: DeductionReviewItem): DeductionReviewItem | undefined {
    const candidates = deductionReviewItems
      .filter((candidate) => candidate.employee.id === item.employee.id && candidate.id !== item.id && !candidate.decision)
      .sort((a, b) => `${a.date} ${a.kind}`.localeCompare(`${b.date} ${b.kind}`));
    return candidates.find((candidate) => candidate.date >= item.date) ?? candidates[0];
  }

  function queueDeductionWorkflowPrompt(item: DeductionReviewItem) {
    const nextItem = nextPendingReviewItemAfter(item);
    const needsFix = item.kind === "missingPunch" || item.record.status === "incomplete" || item.record.flags.some((flag) => flag.kind === "missingPunch");
    if (needsFix) {
      setActiveTimecardReviewItemId(item.id);
    } else {
      setTimecardWorkflowTab("monthly");
      setActiveTimecardReviewItemId(nextItem?.id ?? item.id);
      if (nextItem) setSelectedDate(nextItem.date);
    }
    setTimecardWorkflowPrompt({
      kind: "deductionSaved",
      itemId: item.id,
      nextItemId: nextItem?.id,
      needsFix,
    });
  }

  function saveDeductionReview(
    item: DeductionReviewItem,
    amountMode: AttendanceReviewAmountMode,
    note = deductionRemarkValue(item),
    selectedOption?: DeductionAmountOption,
  ) {
    const decision: AttendanceReviewDecision = amountMode === "none" ? "accepted" : "deducted";
    const ruleResolution = deductionRuleResolution(item);
    if (amountMode === "rules" && !ruleResolution.available) return;
    if (amountMode === "settingsOption" && !selectedOption) return;
    const ruleDeductionAmount = ruleResolution.available ? ruleResolution.amount : deductionRuleAmount(item);
    const finalDeductionAmount =
      amountMode === "none"
        ? 0
        : amountMode === "settingsOption"
          ? selectedOption?.amount ?? 0
          : ruleDeductionAmount;
    const nextReview: AttendanceReview = {
      id: item.id,
      employeeId: item.employee.id,
      date: item.date,
      kind: item.kind,
      decision,
      note: normalizeDataValue(note.trim()),
      reviewedBy: t("timecardAuditActorHr"),
      updatedAt: new Date().toISOString(),
      amountMode,
      ruleDeductionAmount,
      finalDeductionAmount,
      deductionOptionId: selectedOption?.id,
      deductionOptionLabel: selectedOption ? normalizeDataValue(selectedOption.label) : undefined,
      payrollImpact: finalDeductionAmount,
      payrollImpactCurrency: item.employee.salary.currency || "MYR",
      relatedLeaveType: item.relatedLeaveType,
      leavePayRule: item.leavePayRule,
      relatedCorrectionReason: correctionReason ? normalizeDataValue(correctionReason) : undefined,
    };
    setData((current) => ({
      ...current,
      attendanceReviews: [
        ...(current.attendanceReviews ?? []).filter((review) => review.id !== item.id),
        nextReview,
      ],
    }));
    setDeductionDecisionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionAmountModeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionOptionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionRemarkDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setAbsentLeaveTypeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    queueDeductionWorkflowPrompt(item);
  }

  function savePendingReview(item: DeductionReviewItem, note = deductionRemarkValue(item)) {
    const ruleResolution = deductionRuleResolution(item);
    const nextReview: AttendanceReview = {
      id: item.id,
      employeeId: item.employee.id,
      date: item.date,
      kind: item.kind,
      decision: "pending",
      note: normalizeDataValue(note.trim()),
      reviewedBy: t("timecardAuditActorHr"),
      updatedAt: new Date().toISOString(),
      amountMode: "none",
      ruleDeductionAmount: ruleResolution.available ? ruleResolution.amount : deductionRuleAmount(item),
      finalDeductionAmount: 0,
      payrollImpact: 0,
      payrollImpactCurrency: item.employee.salary.currency || "MYR",
      relatedLeaveType: item.relatedLeaveType,
      leavePayRule: item.leavePayRule,
      relatedCorrectionReason: correctionReason ? normalizeDataValue(correctionReason) : undefined,
    };
    setData((current) => ({
      ...current,
      attendanceReviews: [
        ...(current.attendanceReviews ?? []).filter((review) => review.id !== item.id),
        nextReview,
      ],
    }));
    setDeductionDecisionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionAmountModeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionOptionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionRemarkDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setAbsentLeaveTypeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    queueDeductionWorkflowPrompt(item);
  }

  function saveAbsentPendingReview(item: DeductionReviewItem, note = deductionRemarkValue(item)) {
    const nextReview: AttendanceReview = {
      id: item.id,
      employeeId: item.employee.id,
      date: item.date,
      kind: "absent",
      decision: "pending",
      note: normalizeDataValue(note.trim()),
      reviewedBy: t("timecardAuditActorHr"),
      updatedAt: new Date().toISOString(),
      amountMode: "none",
      ruleDeductionAmount: deductionRuleAmount(item),
      finalDeductionAmount: 0,
      payrollImpact: 0,
      payrollImpactCurrency: item.employee.salary.currency || "MYR",
      relatedCorrectionReason: correctionReason ? normalizeDataValue(correctionReason) : undefined,
    };
    setData((current) => ({
      ...current,
      attendanceReviews: [
        ...(current.attendanceReviews ?? []).filter((review) => review.id !== item.id),
        nextReview,
      ],
    }));
    setDeductionDecisionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionAmountModeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionOptionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionRemarkDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    queueDeductionWorkflowPrompt(item);
  }

  function saveAbsentConvertToLeave(item: DeductionReviewItem, note = deductionRemarkValue(item)) {
    const leaveType = normalizeDataValue(absentLeaveTypeValue(item));
    if (!leaveType) return;
    const leaveRule = isPaidLeaveType(leaveType, data) ? "paid" : "deduct";
    const leaveHours = item.record.shift?.workLengthHours ?? item.employee.workLengthHours ?? 8;
    const convertedReview: AttendanceReview = {
      id: item.id,
      employeeId: item.employee.id,
      date: item.date,
      kind: "absent",
      decision: "convertedToLeave",
      note: normalizeDataValue(note.trim()),
      reviewedBy: t("timecardAuditActorHr"),
      updatedAt: new Date().toISOString(),
      amountMode: "none",
      ruleDeductionAmount: deductionRuleAmount(item),
      finalDeductionAmount: 0,
      payrollImpact: 0,
      payrollImpactCurrency: item.employee.salary.currency || "MYR",
      relatedLeaveType: leaveType,
      leavePayRule: leaveRule,
      relatedCorrectionReason: correctionReason ? normalizeDataValue(correctionReason) : undefined,
    };
    const unpaidLeaveReviewId = attendanceReviewId(item.employee.id, item.date, "unpaidLeave");
    const unpaidLeaveImpact = calculateRuleDeductionAmount(
      { employee: item.employee, kind: "unpaidLeave", durationMinutes: 0, dayCount: item.dayCount || 1 },
      "deducted",
      data.settings,
    );
    const convertedLeaveReview: AttendanceReview | undefined =
      leaveRule === "deduct"
        ? {
            id: unpaidLeaveReviewId,
            employeeId: item.employee.id,
            date: item.date,
            kind: "unpaidLeave",
            decision: "deducted",
            note: normalizeDataValue(note.trim() || leaveType),
            reviewedBy: t("timecardAuditActorHr"),
            updatedAt: convertedReview.updatedAt,
            amountMode: "rules",
            ruleDeductionAmount: unpaidLeaveImpact,
            finalDeductionAmount: unpaidLeaveImpact,
            payrollImpact: unpaidLeaveImpact,
            payrollImpactCurrency: item.employee.salary.currency || "MYR",
            relatedLeaveType: leaveType,
            leavePayRule: leaveRule,
          }
        : undefined;
    setData((current) => ({
      ...current,
      leaves: [
        ...current.leaves.filter((leave) => !(leave.employeeId === item.employee.id && leave.date === item.date)),
        {
          id: `leave-${item.employee.id}-${item.date}`,
          employeeId: item.employee.id,
          date: item.date,
          type: leaveType,
          hours: leaveHours,
          note: normalizeDataValue(note.trim()),
        },
      ],
      attendanceReviews: [
        ...(current.attendanceReviews ?? []).filter(
          (review) => review.id !== item.id && review.id !== unpaidLeaveReviewId,
        ),
        convertedReview,
        ...(convertedLeaveReview ? [convertedLeaveReview] : []),
      ],
    }));
    setDeductionDecisionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionAmountModeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionOptionDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setDeductionRemarkDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setAbsentLeaveTypeDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    queueDeductionWorkflowPrompt(item);
  }

  function saveAbsentReview(item: DeductionReviewItem) {
    const decision = deductionDecisionValue(item);
    if (decision === "pending") {
      saveAbsentPendingReview(item);
      return;
    }
    if (decision === "convertedToLeave") {
      saveAbsentConvertToLeave(item);
      return;
    }
    const amountMode = deductionAmountModeValue(item);
    const selectedOption = amountMode === "settingsOption" ? deductionPresetOptionValue(item) : undefined;
    if (amountMode === "settingsOption" && !selectedOption) return;
    if (amountMode) saveDeductionReview(item, amountMode, deductionRemarkValue(item), selectedOption);
  }

  function addSettingItem(kind: "companies" | "departments" | "positions" | "nationalities" | "leaveTypes" | "correctionReasons" | "deductionReasons", value: string) {
    const clean = kind === "companies" ? value.trim() : normalizeDataValue(value.trim());
    if (!clean) return;
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [kind]: Array.from(new Set([...current.settings[kind], clean])),
        ...(kind === "leaveTypes" && isPaidLeaveType(clean)
          ? { paidLeaveTypes: Array.from(new Set([...current.settings.paidLeaveTypes, clean])) }
          : {}),
      },
    }));
  }

  function removeSettingItem(kind: "companies" | "departments" | "positions" | "nationalities" | "leaveTypes" | "correctionReasons" | "deductionReasons", value: string) {
    const clean = kind === "companies" ? value : normalizeDataValue(value);
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [kind]: current.settings[kind].filter((item) => item !== clean),
        ...(kind === "leaveTypes"
          ? {
              paidLeaveTypes: current.settings.paidLeaveTypes.filter((item) => item !== clean),
              mcRequiredLeaveTypes: current.settings.mcRequiredLeaveTypes.filter((item) => item !== clean),
            }
          : {}),
      },
    }));
  }

  function editSettingItem(kind: "companies" | "departments" | "positions" | "nationalities" | "leaveTypes" | "correctionReasons" | "deductionReasons", oldValue: string, nextValue: string) {
    const cleanOld = kind === "companies" ? oldValue : normalizeDataValue(oldValue);
    const cleanNext = kind === "companies" ? nextValue.trim() : normalizeDataValue(nextValue.trim());
    if (!cleanNext || cleanNext === cleanOld) return;
    setData((current) => {
      const list = current.settings[kind];
      if (list.some((item) => item !== cleanOld && item === cleanNext)) return current;
      const nextSettings = {
        ...current.settings,
        [kind]: list.map((item) => item === cleanOld ? cleanNext : item),
        ...(kind === "leaveTypes"
          ? {
              paidLeaveTypes: current.settings.paidLeaveTypes.map((item) => item === cleanOld ? cleanNext : item),
              mcRequiredLeaveTypes: current.settings.mcRequiredLeaveTypes.map((item) => item === cleanOld ? cleanNext : item),
            }
          : {}),
      };
      const profileField =
        kind === "companies" ? "company" :
        kind === "departments" ? "department" :
        kind === "positions" ? "position" :
        kind === "nationalities" ? "nationality" :
        undefined;
      return {
        ...current,
        settings: nextSettings,
        employees: profileField
          ? current.employees.map((employee) =>
              employee[profileField] === cleanOld ? { ...employee, [profileField]: cleanNext } : employee,
            )
          : current.employees,
        leaves: kind === "leaveTypes"
          ? current.leaves.map((leave) => leave.type === cleanOld ? { ...leave, type: cleanNext } : leave)
          : current.leaves,
        attendanceReviews: kind === "leaveTypes"
          ? (current.attendanceReviews ?? []).map((review) =>
              review.relatedLeaveType === cleanOld ? { ...review, relatedLeaveType: cleanNext } : review,
            )
          : current.attendanceReviews,
      };
    });
  }

  function patchDeductionAmountSettings(patch: Partial<DeductionAmountSettings>) {
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        deductionAmounts: {
          ...current.settings.deductionAmounts,
          ...patch,
          source: "settings",
        },
      },
    }));
  }

  function addDeductionAmountOption() {
    const label = normalizeDataValue(newDeductionAmountOption.label.trim());
    const amount = Number(newDeductionAmountOption.amount);
    if (!label || !Number.isFinite(amount) || amount < 0) return;
    setData((current) => {
      const existing = current.settings.deductionAmountOptions ?? [];
      if (existing.some((option) => normalizeDataValue(option.label) === label)) return current;
      return {
        ...current,
        settings: {
          ...current.settings,
          deductionAmountOptions: [
            ...existing,
            { id: `deduct-option-${Date.now()}`, label, amount },
          ],
        },
      };
    });
    setNewDeductionAmountOption({ label: "", amount: "" });
  }

  function removeDeductionAmountOption(id: string) {
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        deductionAmountOptions: current.settings.deductionAmountOptions.filter((option) => option.id !== id),
      },
    }));
  }

  function startEditDeductionAmountOption(option: DeductionAmountOption) {
    setEditingDeductionAmountOptionId(option.id);
    setEditingDeductionAmountOption({ label: option.label, amount: String(option.amount) });
  }

  function cancelEditDeductionAmountOption() {
    setEditingDeductionAmountOptionId(null);
    setEditingDeductionAmountOption({ label: "", amount: "" });
  }

  function saveEditDeductionAmountOption() {
    if (!editingDeductionAmountOptionId) return;
    const label = normalizeDataValue(editingDeductionAmountOption.label.trim());
    const amount = Number(editingDeductionAmountOption.amount);
    if (!label || !Number.isFinite(amount) || amount < 0) return;
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        deductionAmountOptions: current.settings.deductionAmountOptions.map((option) =>
          option.id === editingDeductionAmountOptionId ? { ...option, label, amount } : option,
        ),
      },
    }));
    cancelEditDeductionAmountOption();
  }

  function setLeaveTypePaid(type: string, paid: boolean) {
    const clean = normalizeDataValue(type);
    setData((current) => {
      const paidLeaveTypes = paid
        ? Array.from(new Set([...current.settings.paidLeaveTypes, clean]))
        : current.settings.paidLeaveTypes.filter((item) => item !== clean);
      return { ...current, settings: { ...current.settings, paidLeaveTypes } };
    });
  }

  function setLeaveTypeMcRequired(type: string, required: boolean) {
    const clean = normalizeDataValue(type);
    setData((current) => {
      const mcRequiredLeaveTypes = required
        ? Array.from(new Set([...current.settings.mcRequiredLeaveTypes, clean]))
        : current.settings.mcRequiredLeaveTypes.filter((item) => item !== clean);
      return { ...current, settings: { ...current.settings, mcRequiredLeaveTypes } };
    });
  }

  function exportBackup() {
    downloadText(`tms-local-backup-${data.settings.businessDate}.json`, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  }

  async function restoreBackup(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as AppData;
    setData(hydrateData(parsed));
  }

  function resetSampleData() {
    if (!window.confirm(t("resetConfirm"))) return;
    const seed = createSeedData();
    setData(seed);
    setSelectedMonth(seed.settings.defaultMonth);
    setSelectedEmployeeId(seed.employees[0]?.id ?? "");
    setSelectedShiftId(seed.shifts[0]?.id ?? "");
    setSelectedDate(seed.settings.businessDate);
  }

  const dashboard = {
    activeCount: activeEmployees.length,
    // Missing = some punches but incomplete (forgot to punch out, etc.)
    // Absent = no punches at all on a working day
    // These are mutually exclusive so they can be summed without double-counting.
    missingCount: monthRecords.filter((record) => record.status === "incomplete").length,
    absentCount: monthRecords.filter((record) => record.status === "absent").length,
    leaveCount: monthRecords.filter((record) => record.status === "leave").length,
    overtimeHours: formatHours(monthRecords.reduce((sum, record) => sum + record.overtimeMinutes, 0)),
    overtimeCount: monthRecords.filter((record) => record.overtimeMinutes > 0).length,
    lateEarlyCount: monthRecords.filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0).length,
    lunchOverCount: monthRecords.filter((record) => record.flags.some((f) => f.kind === "lunchOver")).length,
    shortHoursCount: monthRecords.filter((record) => record.flags.some((f) => f.kind === "underWork")).length,
  };

  const selectedDateRecord = selectedEmployee ? calculateAttendance(data, selectedEmployee, selectedDate) : undefined;
  const activeNavLabel = navItems.find((item) => item.id === activeView)?.label[lang] ?? t("appName");

  const report = useMemo(() => buildReport(reportType, reportRecords, reportEmployees, data, selectedMonth, selectedEmployeeId, lang), [
    data,
    lang,
    reportEmployees,
    reportRecords,
    reportType,
    selectedEmployeeId,
    selectedMonth,
  ]);

  useEffect(() => {
    setReportSelectedRowIds([]);
  }, [companyFilter, data, departmentFilter, reportEmployeeFilter, reportType, selectedEmployeeId, selectedMonth]);

  useEffect(() => {
    setPayrollSelectedEmployeeIds([]);
  }, [companyFilter, departmentFilter, selectedMonth]);

  if (!unlocked) {
    const capabilities: Array<{ icon: LucideIcon; label: string }> = [
      { icon: Upload, label: t("lockCapImport") },
      { icon: Clock3, label: t("lockCapShift") },
      { icon: CalendarDays, label: t("lockCapLeave") },
      { icon: FileSpreadsheet, label: t("lockCapReports") },
      { icon: Wallet, label: t("lockCapPayroll") },
    ];
    return (
      <div className="lock-shell">
        <div className="lock-bg" aria-hidden="true" />
        <button
          type="button"
          className="lang-pill lock-lang-pill"
          title={t("langTopbarTooltip")}
          aria-label={t("langTopbarTooltip")}
          onClick={() => setLang((current) => (current === "zh" ? "en" : "zh"))}
        >
          <Shuffle size={14} aria-hidden="true" />
          <span className="lang-pill-current">{lang === "zh" ? "中文" : "EN"}</span>
          <span className="lang-pill-shortcut">{t("langShortcutHint")}</span>
        </button>

        <div className="lock-card">
          <div className="lock-brand-stack">
            <div className="brand-mark lock-brand-mark">T</div>
            <strong>{t("appName")}</strong>
            <span>{t("appSubtitle")}</span>
          </div>

          <h2 className="lock-title">{t("lockTitle")}</h2>
          <p className="lock-tagline">{t("lockTagline")}</p>

          <form
            className="lock-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleLogin();
            }}
          >
            <Field label={t("hrPasswordField")}>
              <input
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                autoFocus
                placeholder={data.settings.localPasswordHint || t("lockHint")}
              />
            </Field>
            {data.settings.usbLicenseRequired && data.settings.usbToken ? (
              <Field label={t("usbKeyField")}>
                <input
                  type="password"
                  value={usbTokenInput}
                  onChange={(event) => setUsbTokenInput(event.target.value)}
                />
              </Field>
            ) : null}
            {loginError ? (
              <div className="lock-error" role="alert">
                <LockKeyhole size={14} aria-hidden="true" /> {loginError}
              </div>
            ) : null}
            <Button icon={Unlock} type="submit">
              {t("lockButton")}
            </Button>
          </form>

          <ul className="lock-capabilities" aria-hidden="true">
            {capabilities.map(({ icon: Icon, label }) => (
              <li key={label}>
                <Icon size={14} />
                <span>{label}</span>
              </li>
            ))}
          </ul>

          <p className="lock-footnote">{t("lockFootnote")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {savedToast ? (
        <div className="saved-toast" role="status" aria-live="polite">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>{savedToast.text}</span>
        </div>
      ) : null}
      {mobileMenuOpen ? (
        <button
          type="button"
          className="mobile-menu-scrim"
          aria-label={t("mobileMenuClose")}
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}
      <aside className={cx("rail", mobileMenuOpen && "rail-menu-open")}>
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <strong>{t("appName")}</strong>
            <span>{t("appSubtitle")}</span>
          </div>
          <button
            type="button"
            className="mobile-menu-button"
            aria-expanded={mobileMenuOpen}
            aria-controls="main-navigation-drawer"
            aria-label={mobileMenuOpen ? t("mobileMenuClose") : t("mobileMenuOpen")}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            <span>{activeNavLabel}</span>
          </button>
        </div>

        <div id="main-navigation-drawer" className={cx("mobile-menu-panel", mobileMenuOpen && "mobile-menu-open")}>
        <nav className="nav-list" aria-label={t("mainNav")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={cx("nav-item", activeView === item.id && "nav-item-active")}
                onClick={() => {
                  if (item.id === "thisMonth") {
                    openThisMonth("home");
                    setMobileMenuOpen(false);
                    return;
                  }
                  setActiveView(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label[lang]}</span>
              </button>
            );
          })}
        </nav>

        <div className="rail-status">
          <WifiOff size={18} aria-hidden="true" />
          <div>
            <strong>{t("localOnly")}</strong>
            <span>{t("lastBusinessDay")} {data.settings.businessDate}</span>
          </div>
        </div>

        <button className="rail-logout" onClick={() => setLang((current) => (current === "zh" ? "en" : "zh"))}>
          <Shuffle size={16} aria-hidden="true" />
          <span>{t("languageSwitch")}</span>
        </button>

        {data.settings.requirePassword ? (
          <button className="rail-logout" onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" />
            <span>{t("lockSwitchUser")}</span>
          </button>
        ) : null}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("eyebrow")}</p>
            <h1>{activeNavLabel}</h1>
          </div>
          <div className="topbar-controls">
            {activeView !== "settings" ? (
              <Field label={t("monthLabel")} compact>
                <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
              </Field>
            ) : null}
          </div>
        </header>

        {activeView === "thisMonth" ? renderThisMonth() : null}
        {activeView === "employees" ? renderEmployees() : null}
        {activeView === "reports" ? renderReports() : null}
        {activeView === "settings" ? renderSettingsShell() : null}
      </main>
    </div>
  );

  function renderThisMonth() {
    const readinessTone = monthlyReadiness.status === "ready" ? "good" : monthlyReadiness.status === "empty" ? "neutral" : "warn";
    const readinessTitle =
      monthlyReadiness.status === "empty"
        ? t("payrollEmptyTitle")
        : monthlyReadiness.status === "ready"
          ? t("payrollReadyTitle")
          : t("payrollPendingTitle", { count: monthlyReadiness.unresolvedCount });
    const readinessSubtitle =
      monthlyReadiness.status === "empty"
        ? t("payrollEmptySubtitle")
        : monthlyReadiness.status === "ready"
          ? t("payrollReadySubtitle")
          : t("payrollPendingSubtitle");
    const readinessAction =
      monthlyReadiness.status === "empty"
        ? { label: t("payrollEmptyAction"), icon: Upload, stage: "import" as MonthStage }
        : monthlyReadiness.status === "ready"
          ? { label: t("payrollExportAction"), icon: Download, stage: "payroll" as MonthStage }
          : { label: t("payrollPendingAction"), icon: Wand2, stage: "timecards" as MonthStage };
    const stages: Array<{ id: MonthStage; label: string; hint: string; icon: LucideIcon; count?: number }> = [
      { id: "import", label: t("navImport"), hint: `${monthlyReadiness.monthPunchCount} ${t("items")}`.trim(), icon: Upload },
      { id: "timecards", label: t("navTimecards"), hint: t("payrollPendingTitle", { count: monthlyReadiness.unresolvedCount }), icon: Wand2, count: monthlyReadiness.unresolvedCount },
      { id: "leave", label: t("navLeave"), hint: `${monthlyReadiness.monthLeaveCount} ${t("items")}`.trim(), icon: CalendarDays },
      { id: "payroll", label: t("navPayroll"), hint: t("payrollExportAction"), icon: Wallet },
    ];
    const homeActions: Array<{ title: string; hint: string; icon: LucideIcon; onClick: () => void; primary?: boolean }> = [
      { title: t("hrHomeImportTitle"), hint: t("hrHomeImportHint"), icon: Upload, onClick: () => openThisMonth("import"), primary: monthlyReadiness.status === "empty" },
      { title: t("hrHomeFixTitle"), hint: t("hrHomeFixHint"), icon: Wand2, onClick: () => openTimecards("all"), primary: monthlyReadiness.status === "pending" },
      { title: t("hrHomeLeaveTitle"), hint: t("hrHomeLeaveHint"), icon: CalendarDays, onClick: () => openThisMonth("leave") },
      { title: t("hrHomeReportsTitle"), hint: t("hrHomeReportsHint"), icon: FileSpreadsheet, onClick: () => openReports("summary") },
      { title: t("hrHomePayrollTitle"), hint: t("hrHomePayrollHint"), icon: Wallet, onClick: () => openThisMonth("payroll"), primary: monthlyReadiness.status === "ready" },
    ];
    const requirementItems: Array<{ label: string; icon: LucideIcon }> = [
      { label: t("reqEmployeeData"), icon: Users },
      { label: t("reqShiftSetup"), icon: CalendarClock },
      { label: t("reqCommonSettings"), icon: Settings2 },
      { label: t("reqPunchCorrection"), icon: Wand2 },
      { label: t("reqReports"), icon: FileSpreadsheet },
      { label: t("reqDeviceImport"), icon: Fingerprint },
      { label: t("reqPermission"), icon: LockKeyhole },
    ];

    if (monthStage === "home") {
      return (
        <div className="view-stack month-workbench hr-home">
          <section className={cx("hr-home-hero", `hr-home-hero-${readinessTone}`)}>
            <div className="hr-home-status">
              <div className="readiness-icon hr-home-status-icon">
                {monthlyReadiness.status === "ready" ? <CheckCircle2 size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
              </div>
              <div className="hr-home-copy">
                <p className="overview-headline-eyebrow">{selectedMonth}</p>
                <h2>{readinessTitle}</h2>
                <p>{readinessSubtitle}</p>
              </div>
            </div>

            <div className="hr-home-kpis" aria-label={t("monthWorkflowAria")}>
              <button type="button" onClick={() => openThisMonth("import")}>
                <span>{t("hrHomePunches")}</span>
                <strong>{monthlyReadiness.monthPunchCount}</strong>
              </button>
              <button type="button" onClick={() => openTimecards("all")}>
                <span>{t("hrHomeToReview")}</span>
                <strong>{monthlyReadiness.unresolvedCount}</strong>
              </button>
              <button type="button" onClick={() => openThisMonth("leave")}>
                <span>{t("overviewMonthLeaves")}</span>
                <strong>{monthlyReadiness.monthLeaveCount}</strong>
              </button>
            </div>

            <Button icon={readinessAction.icon} onClick={() => openThisMonth(readinessAction.stage)}>
              {readinessAction.label}
            </Button>
          </section>

          <section className="hr-home-section">
            <div className="hr-home-section-head">
              <div>
                <p className="overview-headline-eyebrow">{t("navThisMonth")}</p>
                <h2>{t("hrHomePrimaryTitle")}</h2>
              </div>
            </div>
            <div className="hr-home-actions">
              {homeActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.title}
                    type="button"
                    className={cx("hr-home-action", action.primary && "hr-home-action-primary")}
                    onClick={action.onClick}
                  >
                    <span className="hr-home-action-icon"><Icon size={18} aria-hidden="true" /></span>
                    <strong>{action.title}</strong>
                    <small>{action.hint}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="hr-home-section">
            <div className="hr-home-section-head">
              <div>
                <p className="overview-headline-eyebrow">{t("navSettings")}</p>
                <h2>{t("hrHomeRequiredTitle")}</h2>
              </div>
            </div>
            <div className="requirement-strip">
              {requirementItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="requirement-pill">
                    <Icon size={15} aria-hidden="true" />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      );
    }

    const activeStage = stages.find((stage) => stage.id === monthStage) ?? stages[0];

    return (
      <div className="view-stack month-workbench">
        <section className="month-detail-head">
          <Button icon={ArrowLeft} variant="ghost" onClick={() => openThisMonth("home")}>
            {t("backToOverview")}
          </Button>
          <div>
            <p className="overview-headline-eyebrow">{selectedMonth}</p>
            <h2>{activeStage.label}</h2>
          </div>
        </section>

        <nav className="month-stage-nav month-stage-nav-compact" aria-label={t("monthWorkflowAria")}>
          {stages.map((stage) => {
            const Icon = stage.icon;
            return (
              <button
                key={stage.id}
                type="button"
                className={cx("month-stage-item", monthStage === stage.id && "month-stage-active")}
                onClick={() => setMonthStage(stage.id)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{stage.label}</span>
                <small>{stage.hint}</small>
                {stage.count && stage.count > 0 ? <b>{stage.count}</b> : null}
              </button>
            );
          })}
        </nav>

        {monthStage === "import" ? renderImportData() : null}
        {monthStage === "timecards" ? renderTimeCards() : null}
        {monthStage === "leave" ? renderLeave() : null}
        {monthStage === "payroll" ? renderPayroll() : null}
      </div>
    );
  }

  function renderOverview() {
    const monthPunches = data.punches.filter((p) => p.date.startsWith(selectedMonth));
    const monthPunchCount = monthPunches.length;
    const monthLeaves = data.leaves.filter((l) => l.date.startsWith(selectedMonth));
    const monthLeaveCount = monthLeaves.length;
    const pendingCount = dashboard.missingCount + dashboard.absentCount + dashboard.shortHoursCount + dashboard.lateEarlyCount + dashboard.lunchOverCount + dashboard.overtimeCount;
    const hasOperationalData = monthPunchCount > 0 || monthLeaveCount > 0;
    const actionablePendingCount = hasOperationalData ? pendingCount : 0;
    const actionableAbsentCount = hasOperationalData ? dashboard.absentCount : 0;
    const actionableMissingCount = hasOperationalData ? dashboard.missingCount : 0;
    const actionableShortHoursCount = hasOperationalData ? dashboard.shortHoursCount : 0;
    const actionableLateEarlyCount = hasOperationalData ? dashboard.lateEarlyCount : 0;
    const actionableOvertimeCount = hasOperationalData ? dashboard.overtimeCount : 0;
    const actionableOvertimeHours = hasOperationalData ? dashboard.overtimeHours : "-";
    const monthLabel = (() => {
      try {
        const d = new Date(`${selectedMonth}-01`);
        return d.toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long" });
      } catch { return selectedMonth; }
    })();

    const leaveByType = monthLeaves.reduce<Record<string, number>>((acc, l) => {
      const k = translateDataValue(l.type, lang);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});

    const empty = !hasOperationalData;

    return (
      <div className="view-stack overview-quiet">
        <section className="overview-headline">
          <div>
            <p className="overview-headline-eyebrow">{monthLabel}</p>
            <h2>{t("overviewMonthSnapshot")}</h2>
          </div>
          <Button icon={empty ? Upload : Wand2} variant={actionablePendingCount > 0 ? "primary" : "secondary"} onClick={() => (empty ? openThisMonth("import") : openTimecards("all"))}>
            {empty ? t("overviewEmptyAction") : actionablePendingCount > 0 ? t("overviewResolvePending") : t("overviewOpenTimecards")}
          </Button>
        </section>

        {empty ? (
          <section className="panel overview-empty-cta">
            <Upload size={28} aria-hidden="true" />
            <div>
              <strong>{t("overviewEmptyTitle")}</strong>
              <p>{t("overviewEmptyHint")}</p>
            </div>
            <Button icon={Upload} onClick={() => openThisMonth("import")}>{t("overviewEmptyAction")}</Button>
          </section>
        ) : null}

        {empty ? null : <div className="metric-grid metric-grid-quiet">
          <Metric
            label={t("overviewPendingTitle")}
            value={actionablePendingCount}
            tone={actionablePendingCount > 0 ? "warn" : "good"}
            icon={Wand2}
            onClick={() => openTimecards("all")}
          />
          <Metric
            label={t("metricAbsentDays")}
            value={actionableAbsentCount}
            tone={actionableAbsentCount > 0 ? "bad" : "good"}
            icon={AlertTriangle}
            onClick={() => openTimecards("absent")}
          />
          <Metric
            label={t("overviewMonthLeaves")}
            value={monthLeaveCount}
            icon={CalendarDays}
            onClick={() => openThisMonth("leave")}
          />
          <Metric
            label={t("metricOvertimeHours")}
            value={actionableOvertimeHours === "-" ? "—" : lang === "zh" ? `${actionableOvertimeHours}小时` : `${actionableOvertimeHours} h`}
            icon={Clock3}
            onClick={() => openReports("overtime")}
          />
        </div>}

        {empty ? null : <div className="overview-cards">
          <button type="button" className="panel overview-card overview-action-card" onClick={() => openTimecards("all")}>
            <header className="overview-card-header">
              <Wand2 size={14} aria-hidden="true" />
              <strong>{t("overviewPendingTitle")}</strong>
              <span className={cx("overview-card-count", actionablePendingCount > 0 && "overview-card-count-warn")}>{actionablePendingCount}</span>
            </header>
            <div className="overview-breakdown">
              <div><span>{t("metricMissingPunch")}</span><strong>{actionableMissingCount}</strong></div>
              <div><span>{t("metricShortHours")}</span><strong>{actionableShortHoursCount}</strong></div>
              <div><span>{t("metricLateEarly")}</span><strong>{actionableLateEarlyCount}</strong></div>
              <div><span>{t("metricAbsentDays")}</span><strong>{actionableAbsentCount}</strong></div>
              <div><span>{t("payrollOtWarnings")}</span><strong>{actionableOvertimeCount}</strong></div>
            </div>
          </button>

          <button type="button" className="panel overview-card overview-action-card" onClick={() => openThisMonth("leave")}>
            <header className="overview-card-header">
              <CalendarDays size={14} aria-hidden="true" />
              <strong>{t("overviewLeaveBreakdownTitle")}</strong>
              <span className="overview-card-count">{monthLeaveCount}</span>
            </header>
            <div className="overview-breakdown">
              {Object.keys(leaveByType).length === 0 ? (
                <div className="overview-empty">{t("overviewNoLeave")}</div>
              ) : (
                Object.entries(leaveByType).map(([type, count]) => (
                  <div key={type}><span>{type}</span><strong>{count}</strong></div>
                ))
              )}
            </div>
          </button>

          <button type="button" className="panel overview-card overview-action-card" onClick={() => openReports("summary")}>
            <header className="overview-card-header">
              <FileSpreadsheet size={14} aria-hidden="true" />
              <strong>{t("overviewReportReadyTitle")}</strong>
              <span className="overview-card-count">{t("overviewReportReadyCount")}</span>
            </header>
            <div className="overview-breakdown">
              <div><span>{t("reportSummary")}</span><strong>{t("overviewOpen")}</strong></div>
              <div><span>{t("reportLateEarly")}</span><strong>{actionableLateEarlyCount}</strong></div>
              <div><span>{t("reportAbsent")}</span><strong>{actionableAbsentCount}</strong></div>
            </div>
          </button>
        </div>}
      </div>
    );
  }

  function renderImportData() {
    const monthPunches = data.punches.filter((punch) => punch.date.startsWith(selectedMonth));
    const hasImportedPunchesForMonth = monthPunches.length > 0;
    const importIssueRecords = hasImportedPunchesForMonth
      ? monthRecords.filter((record) => record.status === "absent" || record.status === "incomplete" || record.lateMinutes > 0 || record.earlyMinutes > 0 || record.overtimeMinutes > 0 || record.flags.some((f) => f.kind === "lunchOver" || f.kind === "underWork"))
      : [];
    const missingPunchCount = hasImportedPunchesForMonth ? monthRecords.filter((record) => record.status === "incomplete").length : 0;
    const lateEarlyCount = hasImportedPunchesForMonth ? monthRecords.filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0).length : 0;
    const noPunchRecordCount = hasImportedPunchesForMonth ? monthRecords.filter((record) => record.status === "absent").length : 0;
    const leaveDeductionReviewCount = data.leaves.filter((leave) => leave.date.startsWith(selectedMonth) && leaveNeedsDeductionReview(leave, data)).length;
    const detectedIssueCount = importIssueRecords.length + leaveDeductionReviewCount;
    const recentPunches = [...data.punches]
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      .slice(0, 14);
    const importSummaryItems = [
      { label: t("importSummaryPunchRecords"), value: monthPunches.length, icon: Upload, tone: "neutral" },
      { label: t("importSummaryDetectedIssues"), value: detectedIssueCount, icon: AlertTriangle, tone: detectedIssueCount > 0 ? "warn" : "good" },
      { label: t("importSummaryMissingPunches"), value: missingPunchCount, icon: Fingerprint, tone: missingPunchCount > 0 ? "warn" : "good" },
      { label: t("importSummaryLateEarly"), value: lateEarlyCount, icon: Clock3, tone: lateEarlyCount > 0 ? "warn" : "good" },
      { label: t("importSummaryNoPunchRecord"), value: noPunchRecordCount, icon: WifiOff, tone: noPunchRecordCount > 0 ? "bad" : "good" },
      { label: t("importSummaryLeaveDeduction"), value: leaveDeductionReviewCount, icon: CalendarDays, tone: leaveDeductionReviewCount > 0 ? "bad" : "good" },
    ];
    type PostImportIssueDetail = {
      id: string;
      date: string;
      employeeKey: string;
      employeeNo: string;
      employeeName: string;
      department: string;
      shift: string;
      status: string;
      statusClassName: string;
      notes: string;
      reviewLocation: string;
      severity: number;
      onReview: () => void;
    };
    const reviewItemsForImportRecord = (record: AttendanceRecord) =>
      deductionReviewItems.filter((item) => item.employee.id === record.employee.id && item.date === record.date);
    const primaryImportReviewItem = (items: DeductionReviewItem[]) =>
      items.find((item) => item.kind === "missingPunch") ??
      items.find((item) => item.kind === "absent" || item.kind === "unpaidLeave") ??
      items[0];
    const reviewLocationForImportKinds = (kinds: AttendanceReviewKind[], overtimeMinutes = 0) => {
      if (kinds.includes("missingPunch")) return t("reviewRouteFixTimecard");
      if (kinds.includes("absent")) return t("reviewRouteAbsent");
      if (kinds.includes("unpaidLeave")) return t("reviewRouteLeaveDeduction");
      if (kinds.length > 0) return t("reviewRouteDailyDeduction");
      if (overtimeMinutes > 0) return t("reviewRoutePayrollReview");
      return t("reviewRouteDailyDeduction");
    };
    const severityForImportRecord = (record: AttendanceRecord, kinds: AttendanceReviewKind[]) => {
      if (kinds.includes("missingPunch") || record.status === "incomplete") return 0;
      if (kinds.includes("absent") || record.status === "absent") return 1;
      if (kinds.includes("unpaidLeave")) return 2;
      if (kinds.includes("late") || kinds.includes("early") || kinds.includes("shortHours")) return 3;
      if (record.flags.some((flag) => flag.kind === "lunchOver" || flag.kind === "underWork")) return 4;
      return 5;
    };
    const attendanceIssueDetails: PostImportIssueDetail[] = importIssueRecords.map((record) => {
      const reviewItems = reviewItemsForImportRecord(record);
      const primaryItem = primaryImportReviewItem(reviewItems);
      const kinds = reviewItems.map((item) => item.kind);
      const workflowTab: TimecardWorkflowTab =
        kinds.includes("missingPunch") || record.status === "incomplete"
          ? "fix"
          : kinds.length > 0
            ? "deduction"
            : "monthly";
      const issueNotes = [
        ...reviewItems.map((item) => deductionIssueLabel(item.kind)),
        record.flags.some((flag) => flag.kind === "lunchOver") ? t("metricLunchOver") : "",
        record.overtimeMinutes > 0 ? t("payrollOtWarnings") : "",
        formatFlags(record.flags, lang),
      ].filter(Boolean);
      return {
        id: `attendance-${record.employee.id}-${record.date}`,
        date: record.date,
        employeeKey: record.employee.id,
        employeeNo: record.employee.enrollNo,
        employeeName: displayEmployeeName(record.employee) || t("unnamedEmployee"),
        department: translateDataValue(record.employee.department, lang) || "-",
        shift: record.shift ? translateDataValue(record.shift.name, lang) : "-",
        status: statusLabels[lang][record.status],
        statusClassName: statusClass(record.status),
        notes: Array.from(new Set(issueNotes)).join(" / ") || statusLabels[lang][record.status],
        reviewLocation: reviewLocationForImportKinds(kinds, record.overtimeMinutes),
        severity: severityForImportRecord(record, kinds),
        onReview: () => openTimecardDetail(record.employee.id, record.date, workflowTab, primaryItem?.id),
      };
    });
    const leaveIssueDetails: PostImportIssueDetail[] = data.leaves
      .filter((leave) => leave.date.startsWith(selectedMonth) && leaveNeedsDeductionReview(leave, data))
      .map((leave) => {
        const employee = data.employees.find((item) => item.id === leave.employeeId);
        const employeeShift = employee ? data.shifts.find((shift) => shift.id === employee.shiftId) : undefined;
        const reviewItem = employee
          ? deductionReviewItems.find((item) => item.employee.id === employee.id && item.date === leave.date && item.kind === "unpaidLeave")
          : undefined;
        const mcStatus = resolvedLeaveMcStatus(leave, data);
        const approvalStatus = resolvedLeaveApprovalStatus(leave);
        return {
          id: `leave-${leave.id}`,
          date: leave.date,
          employeeKey: employee?.id ?? leave.employeeId,
          employeeNo: employee?.enrollNo ?? leave.employeeId,
          employeeName: employee ? displayEmployeeName(employee) || t("unnamedEmployee") : leave.employeeId,
          department: employee ? translateDataValue(employee.department, lang) || "-" : "-",
          shift: employeeShift ? translateDataValue(employeeShift.name, lang) : "-",
          status: deductionIssueLabel("unpaidLeave"),
          statusClassName: "status status-leave",
          notes: [
            translateDataValue(leave.type, lang),
            formatHoursLabel(leave.hours, lang),
            leaveMcStatusLabel(mcStatus),
            leaveApprovalStatusLabel(approvalStatus),
          ].join(" / "),
          reviewLocation: t("reviewRouteLeaveDeduction"),
          severity: 2,
          onReview: () => {
            if (employee) {
              openTimecardDetail(employee.id, leave.date, "deduction", reviewItem?.id);
            } else {
              setTimecardQueueMode("employee");
              openTimecards("unpaidLeave");
            }
          },
        };
      });
    const importIssueDetails = [...attendanceIssueDetails, ...leaveIssueDetails].sort((a, b) =>
      `${a.severity} ${a.date} ${a.employeeNo}`.localeCompare(`${b.severity} ${b.date} ${b.employeeNo}`),
    );
    const importEmployeeIssueSummary = Array.from(
      importIssueDetails.reduce((map, detail) => {
        const current = map.get(detail.employeeKey);
        if (current) {
          current.count += 1;
        } else {
          map.set(detail.employeeKey, {
            employeeKey: detail.employeeKey,
            employeeNo: detail.employeeNo,
            employeeName: detail.employeeName,
            department: detail.department,
            count: 1,
          });
        }
        return map;
      }, new Map<string, { employeeKey: string; employeeNo: string; employeeName: string; department: string; count: number }>())
        .values(),
    ).sort((a, b) => b.count - a.count || a.employeeNo.localeCompare(b.employeeNo));
    const importIssuePreviewLimit = 10;
    const importIssuePreviewRows = (() => {
      const rows: PostImportIssueDetail[] = [];
      const groupedRows = importEmployeeIssueSummary.map((summary) =>
        importIssueDetails.filter((detail) => detail.employeeKey === summary.employeeKey),
      );
      for (let index = 0; rows.length < importIssuePreviewLimit; index += 1) {
        let added = false;
        for (const group of groupedRows) {
          if (group[index]) {
            rows.push(group[index]);
            added = true;
            if (rows.length >= importIssuePreviewLimit) break;
          }
        }
        if (!added) break;
      }
      return rows;
    })();

    return (
      <div className="view-stack">
        <section className="panel demo-panel">
          <div className="demo-panel-text">
            <strong>{t("demoPanelTitle")}</strong>
            <p>{t("demoPanelHint")}</p>
          </div>
          <div className="demo-panel-actions">
            <Button icon={Wand2} onClick={loadDemoData}>{t("demoLoadButton")}</Button>
            <Button icon={Trash2} variant="ghost" onClick={clearImportedPunches} disabled={monthPunches.length === 0 && data.leaves.length === 0}>
              {t("demoClearButton")}
            </Button>
          </div>
        </section>

        <section className="panel">
          <SectionTitle
            title={t("pureSoftware")}
            action={
              <div className="inline-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importPunchFile(file);
                    event.currentTarget.value = "";
                  }}
                />
                <Button icon={Upload} onClick={() => fileInputRef.current?.click()}>{t("importCsv")}</Button>
              </div>
            }
          />

          <p className="panel-caption import-helper">{t("importHelpText")}</p>

          <div className="source-groups">
            <div className="source-group">
              <span className="source-group-title">{t("importAvailableNow")}</span>
              <div className="source-grid source-grid-ready">
                {[
                  { label: t("sourceCsvFile"), value: `${monthPunches.filter((punch) => punch.source === "import").length} ${t("items")}`.trim(), hint: t("sourceCsvHint"), active: true },
                  { label: t("sourceHrManualEntry"), value: `${monthPunches.filter((punch) => punch.source === "manual").length} ${t("items")}`.trim(), hint: t("sourceManualHint"), active: true },
                ].map((item) => (
                  <div className={cx("source-card", item.active && "source-card-active")} key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.hint}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="source-group">
              <span className="source-group-title">{t("importDeviceComing")}</span>
              <div className="source-grid source-grid-device">
                {[
                  { label: t("sourceUsbFile"), hint: t("sourceDeviceHint") },
                  { label: t("sourceWifiLan"), hint: t("sourceDeviceHint") },
                  { label: t("sourceNetworkLan"), hint: t("sourceDeviceHint") },
                ].map((item) => (
                  <div className="source-card source-card-muted" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{t("sourceDeviceComingSoon")}</strong>
                    <small>{item.hint}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="import-layout">
            <div className="import-drop" onClick={() => fileInputRef.current?.click()}>
              <Upload size={26} aria-hidden="true" />
              <strong>{t("chooseFile")}</strong>
              <span>{t("csvFormatHint")}</span>
            </div>
            <div className="paste-box">
              <Field label={t("pasteRecords")}>
                <textarea
                  rows={7}
                  value={importPasteText}
                  onChange={(event) => setImportPasteText(event.target.value)}
                  placeholder={"1001,2026-04-24,10:00,in\n1001,2026-04-24,18:00,out"}
                />
              </Field>
              <div className="editor-actions">
                <Button icon={Save} onClick={importPastedPunches} disabled={!importPasteText.trim()}>{t("importPasted")}</Button>
                <Button icon={Trash2} variant="ghost" onClick={() => setImportPasteText("")} disabled={!importPasteText.trim()} />
              </div>
            </div>
          </div>

          {importMessage ? <div className="import-banner">{importMessage}</div> : null}
        </section>

        <section className="panel">
          <SectionTitle
            title={t("postImportCheck")}
            action={
              <Button
                icon={Wand2}
                variant={detectedIssueCount > 0 ? "primary" : "secondary"}
                onClick={() => {
                  setTimecardQueueMode("employee");
                  openTimecards("all");
                }}
              >
                {t("goToReviewQueue")}
              </Button>
            }
          />
          <p className="panel-caption import-summary-caption">
            {detectedIssueCount > 0 ? t("postImportSummaryCaption") : t("noExceptionsAfterImport")}
          </p>
          <div className="import-summary-grid">
            {importSummaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className={cx("import-summary-card", `import-summary-${item.tone}`)}>
                  <span className="import-summary-icon"><Icon size={17} aria-hidden="true" /></span>
                  <div>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <details className="import-detail-issues">
            <summary>{t("viewPostImportDetails")}</summary>
            {importIssueDetails.length > 0 ? (
              <>
                <div className="post-import-employee-summary">
                  <div className="post-import-employee-summary-head">
                    <strong>{t("postImportEmployeeSummary")}</strong>
                    <span>
                      {importIssuePreviewRows.length < importIssueDetails.length
                        ? t("postImportPreviewCount", { shown: importIssuePreviewRows.length, total: importIssueDetails.length })
                        : t("postImportAllIssuesShown", { total: importIssueDetails.length })}
                    </span>
                  </div>
                  <div className="post-import-employee-list">
                    {importEmployeeIssueSummary.map((item) => (
                      <button
                        type="button"
                        key={item.employeeKey}
                        className="post-import-employee-item"
                        onClick={() => {
                          setSelectedEmployeeId(item.employeeKey);
                          setTimecardQueueMode("employee");
                          openTimecards("all");
                        }}
                      >
                        <strong>{item.employeeName} <span>({item.employeeNo})</span></strong>
                        <small>{item.department}</small>
                        <em>{t("postImportEmployeeIssueCount", { count: item.count })}</em>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="post-import-preview-note">{t("postImportDetailsPreview")}</p>
              </>
            ) : null}
            <div className="table-wrap leave-records-wrap">
            <table className="leave-records-table post-import-details-table">
              <thead>
                <tr>
                  <th>{t("colDate")}</th>
                  <th>{t("colEmployee")}</th>
                  <th>{t("colDepartment")}</th>
                  <th>{t("colShift")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colNotes")}</th>
                  <th>{t("postImportReviewLocation")}</th>
                  <th>{t("colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {importIssuePreviewRows.map((detail) => (
                  <tr key={detail.id}>
                    <td>{detail.date}</td>
                    <td>{detail.employeeNo} · {detail.employeeName}</td>
                    <td>{detail.department}</td>
                    <td>{detail.shift}</td>
                    <td><span className={detail.statusClassName}>{detail.status}</span></td>
                    <td>{detail.notes}</td>
                    <td><span className="post-import-review-location">{detail.reviewLocation}</span></td>
                    <td>
                      <Button variant="secondary" className="post-import-action-button" onClick={detail.onReview}>
                        {t("postImportReviewAction")}
                      </Button>
                    </td>
                  </tr>
                ))}
                {importIssueDetails.length === 0 ? <tr><td colSpan={8} className="empty-cell">{t("noExceptionsAfterImport")}</td></tr> : null}
              </tbody>
            </table>
            </div>
          </details>
        </section>

        <section className="panel import-raw-panel">
          <details className="import-raw-details">
            <summary>
              <div>
                <strong>{t("recentPunchLogs")}</strong>
                <span>{t("recentPunchLogsHint", { count: recentPunches.length })}</span>
              </div>
              <span className="button button-secondary">{t("viewRecentPunchLogs")}</span>
            </summary>
            <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("colDate")}</th>
                  <th>{t("colTime")}</th>
                  <th>{t("colEmployeeNo")}</th>
                  <th>{t("colName")}</th>
                  <th>{t("colKind")}</th>
                  <th>{t("colSource")}</th>
                  <th>{t("colNote")}</th>
                </tr>
              </thead>
              <tbody>
                {recentPunches.map((punch) => {
                  const employee = data.employees.find((item) => item.id === punch.employeeId);
                  return (
                    <tr key={punch.id}>
                      <td>{punch.date}</td>
                      <td>{punch.time}</td>
                      <td>{employee?.enrollNo ?? "-"}</td>
                      <td>{employee ? displayEmployeeName(employee) : "-"}</td>
                      <td>{punchKindLabels[lang][punch.kind]}</td>
                      <td>{punch.source}</td>
                      <td>{punch.note ? translateDataValue(punch.note, lang) : "-"}</td>
                    </tr>
                  );
                })}
                {recentPunches.length === 0 ? <tr><td colSpan={7} className="empty-cell">{t("noRecentPunchLogs")}</td></tr> : null}
              </tbody>
            </table>
          </div>
          </details>
        </section>
      </div>
    );
  }

  function renderEmployees() {
    if (employeeListMode || !selectedEmployee) {
      return renderEmployeeList();
    }
    return renderEmployeeDetail();
  }

  function renderEmployeeList() {
    const search = employeeSearch.trim().toLowerCase();
    const visibleEmployees = data.employees.filter((employee) => {
      const matchesSearch = !search || [
        employee.enrollNo,
        employee.workNo,
        employee.idNo,
        employee.birthDate,
        displayEmployeeName(employee),
        employee.department,
        employee.company,
        employee.position,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
      if (!matchesSearch) return false;
      if (employeeFilters.status === "active" && !employee.active) return false;
      if (employeeFilters.status === "inactive" && employee.active) return false;
      if (employeeFilters.company !== "all" && employee.company !== employeeFilters.company) return false;
      if (employeeFilters.department !== "all" && employee.department !== employeeFilters.department) return false;
      if (employeeFilters.position !== "all" && employee.position !== employeeFilters.position) return false;
      if (employeeFilters.shiftId !== "all" && employee.shiftId !== employeeFilters.shiftId) return false;
      if (employeeFilters.enrollFrom && compareEmployeeNo(employee.enrollNo, employeeFilters.enrollFrom) < 0) return false;
      if (employeeFilters.enrollTo && compareEmployeeNo(employee.enrollNo, employeeFilters.enrollTo) > 0) return false;
      if (employeeFilters.birthFrom && (!employee.birthDate || employee.birthDate < employeeFilters.birthFrom)) return false;
      if (employeeFilters.birthTo && (!employee.birthDate || employee.birthDate > employeeFilters.birthTo)) return false;
      return true;
    });
    const visibleEmployeeIds = visibleEmployees.map((employee) => employee.id);
    const selectedVisibleCount = visibleEmployeeIds.filter((id) => bulkSelectedEmployeeIds.includes(id)).length;
    const allVisibleSelected = visibleEmployeeIds.length > 0 && selectedVisibleCount === visibleEmployeeIds.length;
    const bulkSelectionMode = bulkSetupOpen || bulkSelectedEmployeeIds.length > 0;
    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle
            title={t("sectionEmployeeList")}
            action={<Button icon={Plus} onClick={openAddEmployee}>{t("newEmployee")}</Button>}
          />
          <div className="employee-filter-panel" aria-label={t("employeeFilterTitle")}>
            <div className="employee-filter-head">
              <div>
                <strong>{t("employeeFilterTitle")}</strong>
                <span>{t("employeeFilterResult", { count: visibleEmployees.length })}</span>
              </div>
              <div className="inline-actions">
                <Button icon={ListFilter} variant="ghost" onClick={() => setAdvancedEmployeeFiltersOpen((open) => !open)}>
                  {advancedEmployeeFiltersOpen ? t("hideAdvancedFilters") : t("showAdvancedFilters")}
                </Button>
                <Button icon={RefreshCcw} variant="ghost" onClick={clearEmployeeFilters}>{t("clearFilters")}</Button>
              </div>
            </div>
            <div className="employee-filter-grid employee-filter-grid-quick">
              <Field label={t("employeeFilterSearch")} compact>
                <div className="list-search">
                  <ListFilter size={16} aria-hidden="true" />
                  <input
                    value={employeeSearch}
                    onChange={(event) => setEmployeeSearch(event.target.value)}
                    placeholder={t("searchEmployee")}
                  />
                </div>
              </Field>
              <Field label={t("statusLabel")} compact>
                <select value={employeeFilters.status} onChange={(event) => setEmployeeFilters((current) => ({ ...current, status: event.target.value as EmployeeStatusFilter }))}>
                  <option value="all">{t("all")}</option>
                  <option value="active">{t("active")}</option>
                  <option value="inactive">{t("inactive")}</option>
                </select>
              </Field>
              <Field label={t("companyLabel")} compact>
                <select value={employeeFilters.company} onChange={(event) => setEmployeeFilters((current) => ({ ...current, company: event.target.value }))}>
                  <option value="all">{t("all")}</option>
                  {data.settings.companies.map((company) => <option key={company} value={company}>{translateDataValue(company, lang)}</option>)}
                </select>
              </Field>
              <Field label={t("departmentLabel")} compact>
                <select value={employeeFilters.department} onChange={(event) => setEmployeeFilters((current) => ({ ...current, department: event.target.value }))}>
                  <option value="all">{t("all")}</option>
                  {data.settings.departments.map((department) => <option key={department} value={department}>{translateDataValue(department, lang)}</option>)}
                </select>
              </Field>
            </div>
            {advancedEmployeeFiltersOpen ? (
              <div className="employee-filter-grid employee-filter-grid-advanced">
                <Field label={t("positionLabel")} compact>
                  <select value={employeeFilters.position} onChange={(event) => setEmployeeFilters((current) => ({ ...current, position: event.target.value }))}>
                    <option value="all">{t("all")}</option>
                    {data.settings.positions.map((position) => <option key={position} value={position}>{translateDataValue(position, lang)}</option>)}
                  </select>
                </Field>
                <Field label={t("shiftLabel")} compact>
                  <select value={employeeFilters.shiftId} onChange={(event) => setEmployeeFilters((current) => ({ ...current, shiftId: event.target.value }))}>
                    <option value="all">{t("all")}</option>
                    {data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{translateDataValue(shift.name, lang)}</option>)}
                  </select>
                </Field>
                <Field label={t("employeeNoFromLabel")} compact>
                  <input value={employeeFilters.enrollFrom} onChange={(event) => setEmployeeFilters((current) => ({ ...current, enrollFrom: event.target.value }))} />
                </Field>
                <Field label={t("employeeNoToLabel")} compact>
                  <input value={employeeFilters.enrollTo} onChange={(event) => setEmployeeFilters((current) => ({ ...current, enrollTo: event.target.value }))} />
                </Field>
                <Field label={t("birthDateFromLabel")} compact>
                  <input type="date" value={employeeFilters.birthFrom} onChange={(event) => setEmployeeFilters((current) => ({ ...current, birthFrom: event.target.value }))} />
                </Field>
                <Field label={t("birthDateToLabel")} compact>
                  <input type="date" value={employeeFilters.birthTo} onChange={(event) => setEmployeeFilters((current) => ({ ...current, birthTo: event.target.value }))} />
                </Field>
              </div>
            ) : null}
          </div>
          <div
            className={cx(
              "bulk-condition-panel",
              bulkSetupOpen && "bulk-condition-panel-active",
              !bulkSetupOpen && bulkSelectedEmployeeIds.length === 0 && "bulk-condition-panel-collapsed",
            )}
            aria-label={t("bulkConditionsTitle")}
          >
            <div className="bulk-condition-head">
              <div>
                <span className="bulk-condition-kicker">{t("bulkScopeBadge")}</span>
                <strong>{t("bulkConditionsTitle")}</strong>
                <span>{t("bulkSelectedCount", { count: bulkSelectedEmployeeIds.length })}</span>
              </div>
              <div className="bulk-action-toolbar">
                <Button icon={Settings2} variant="ghost" onClick={() => setBulkSetupOpen((open) => !open)}>
                  {bulkSetupOpen ? t("hideBulkSetup") : t("showBulkSetup")}
                </Button>
                <Button
                  icon={Save}
                  className="bulk-apply-action"
                  onClick={applyBulkConditions}
                  disabled={bulkSelectedEmployeeIds.length === 0}
                >
                  {t("bulkApplyConditions")}
                </Button>
              </div>
            </div>
            <p className={cx("bulk-condition-hint", bulkSelectedEmployeeIds.length === 0 && "bulk-condition-empty")}>
              {bulkSelectedEmployeeIds.length > 0 ? t("bulkSelectionHint") : t("bulkNoSelectionHint")}
            </p>
            {bulkSetupOpen ? (
              <>
                <div className="bulk-condition-sections">
                  <div className="bulk-condition-section">
                    <strong>{t("bulkWorkRuleTitle")}</strong>
                    <div className="bulk-condition-grid bulk-condition-grid-work">
                      <Field label={t("bulkWorkModeLabel")} compact>
                        <select
                          value={bulkConditionDraft.workMode}
                          onChange={(event) => setBulkConditionDraft((current) => ({
                            ...current,
                            workMode: event.target.value as ConditionWorkMode,
                          }))}
                        >
                          <option value="fixed">{t("workModeFixed")}</option>
                          <option value="auto">{t("workModeAuto")}</option>
                          <option value="flexible">{t("workModeFlexible")}</option>
                        </select>
                      </Field>
                      {bulkConditionDraft.workMode === "fixed" ? (
                        <Field label={t("shiftLabel")} compact>
                          <select
                            value={bulkConditionDraft.shiftId}
                            onChange={(event) => setBulkConditionDraft((current) => ({ ...current, shiftId: event.target.value }))}
                          >
                            {data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{translateDataValue(shift.name, lang)}</option>)}
                          </select>
                        </Field>
                      ) : (
                        <div className="bulk-work-mode-note" role="note">
                          {t(bulkConditionDraft.workMode === "auto" ? "bulkAutoShiftHelp" : "bulkFlexibleWorkHelp")}
                        </div>
                      )}
                      {bulkConditionDraft.workMode === "flexible" ? (
                        <Field label={t("employeeWorkLengthLabel")} compact>
                          <input
                            type="number"
                            min="1"
                            step="0.5"
                            value={bulkConditionDraft.workLengthHours}
                            onChange={(event) => setBulkConditionDraft((current) => ({ ...current, workLengthHours: Number(event.target.value) }))}
                          />
                        </Field>
                      ) : null}
                      {bulkConditionDraft.workMode !== "flexible" ? (
                        <Field label={t("employeeGraceMinutesLabel")} compact>
                          <input
                            type="number"
                            min="0"
                            step="5"
                            value={bulkConditionDraft.graceMinutes}
                            onChange={(event) => setBulkConditionDraft((current) => ({ ...current, graceMinutes: Number(event.target.value) }))}
                          />
                        </Field>
                      ) : null}
                    </div>
                  </div>

                  <div className="bulk-condition-section bulk-condition-section-lunch">
                    <strong>{t("bulkLunchRuleTitle")}</strong>
                    <div className="bulk-lunch-rule">
                      <label className="toggle-line">
                        <input
                          type="checkbox"
                          checked={bulkConditionDraft.flexibleLunch}
                          onChange={(event) => setBulkConditionDraft((current) => ({ ...current, flexibleLunch: event.target.checked }))}
                        />
                        <span>{t("employeeFlexibleLunchToggle")}</span>
                      </label>
                      <Field label={t("employeeLunchMinutesLabel")} compact>
                        <input
                          type="number"
                          min="0"
                          step="5"
                          value={bulkConditionDraft.lunchMinutes}
                          disabled={!bulkConditionDraft.flexibleLunch}
                          onChange={(event) => setBulkConditionDraft((current) => ({ ...current, lunchMinutes: Number(event.target.value) }))}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="bulk-condition-section bulk-condition-section-waiver">
                    <strong>{t("bulkWaiverLabel")}</strong>
                    <div className="bulk-waiver-row" role="group" aria-label={t("bulkWaiverLabel")}>
                      {[
                        ["late", t("exemptLate")],
                        ["early", t("exemptEarly")],
                        ["lunchPunch", t("exemptLunchPunch")],
                        ["overtime", t("exemptOvertime")],
                      ].map(([key, label]) => (
                        <label className="check-chip" key={key}>
                          <input
                            type="checkbox"
                            checked={bulkConditionDraft.exemptions[key as keyof Employee["exemptions"]]}
                            onChange={(event) => setBulkConditionDraft((current) => ({
                              ...current,
                              exemptions: { ...current.exemptions, [key]: event.target.checked },
                            }))}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          {!bulkSelectionMode ? (
            <div className="individual-rule-placeholder" aria-label={t("individualAttendanceRulesTitle")}>
              <span>{t("individualScopeBadge")}</span>
              <strong>{t("individualAttendanceRulesTitle")}</strong>
              <p>{t("individualAttendanceRulesSelectHint")}</p>
            </div>
          ) : null}
          {addEmployeeOpen ? (
            <form
              className="add-employee-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                commitAddEmployee();
              }}
            >
              <Field label={t("employeeNoRequired")} required error={addEmployeeErrors.enrollNo ? t("requiredFieldError") : ""}>
                <input
                  autoFocus
                  required
                  aria-invalid={Boolean(addEmployeeErrors.enrollNo)}
                  value={addEmployeeDraft.enrollNo}
                  onChange={(event) => {
                    setAddEmployeeDraft({ ...addEmployeeDraft, enrollNo: event.target.value });
                    setAddEmployeeErrors((current) => ({ ...current, enrollNo: false }));
                  }}
                />
              </Field>
              <Field label={t("workNoRequired")} required error={addEmployeeErrors.workNo ? t("requiredFieldError") : ""}>
                <input
                  required
                  aria-invalid={Boolean(addEmployeeErrors.workNo)}
                  value={addEmployeeDraft.workNo}
                  onChange={(event) => {
                    setAddEmployeeDraft({ ...addEmployeeDraft, workNo: event.target.value });
                    setAddEmployeeErrors((current) => ({ ...current, workNo: false }));
                  }}
                />
              </Field>
              <Field label={t("lastNameRequired")} required error={addEmployeeErrors.lastName ? t("requiredFieldError") : ""}>
                <input
                  required
                  aria-invalid={Boolean(addEmployeeErrors.lastName)}
                  value={addEmployeeDraft.lastName}
                  onChange={(event) => {
                    setAddEmployeeDraft({ ...addEmployeeDraft, lastName: event.target.value });
                    setAddEmployeeErrors((current) => ({ ...current, lastName: false }));
                  }}
                />
              </Field>
              <Field label={t("firstNameRequired")} required error={addEmployeeErrors.firstName ? t("requiredFieldError") : ""}>
                <input
                  required
                  aria-invalid={Boolean(addEmployeeErrors.firstName)}
                  value={addEmployeeDraft.firstName}
                  onChange={(event) => {
                    setAddEmployeeDraft({ ...addEmployeeDraft, firstName: event.target.value });
                    setAddEmployeeErrors((current) => ({ ...current, firstName: false }));
                  }}
                />
              </Field>
              <Field label={t("genderLabel")} required error={addEmployeeErrors.gender ? t("requiredFieldError") : ""}>
                <select
                  required
                  value={addEmployeeDraft.gender}
                  onChange={(event) => setAddEmployeeDraft({ ...addEmployeeDraft, gender: event.target.value as Gender })}
                >
                  <option value="male">{t("male")}</option>
                  <option value="female">{t("female")}</option>
                </select>
              </Field>
              <div className="add-employee-actions">
                <Button
                  icon={Save}
                  type="submit"
                >
                  {t("save")}
                </Button>
                <Button icon={Trash2} variant="ghost" onClick={() => setAddEmployeeOpen(false)} type="button">
                  {t("discard")}
                </Button>
              </div>
            </form>
          ) : null}
          <div className="table-wrap">
            <table className="entity-table">
              <thead>
                <tr>
                  <th className="select-cell">
                    <input
                      type="checkbox"
                      aria-label={allVisibleSelected ? t("bulkClearVisible") : t("bulkSelectVisible")}
                      checked={allVisibleSelected}
                      disabled={visibleEmployeeIds.length === 0}
                      onChange={(event) => setBulkSelectionFor(visibleEmployeeIds, event.target.checked)}
                    />
                  </th>
                  <th>{t("colEmployeeNo")}</th>
                  <th>{t("colName")}</th>
                  <th>{t("colDepartment")}</th>
                  <th>{t("shiftLabel")}</th>
                  <th>{t("conditionsColumn")}</th>
                  <th>{t("statusLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleEmployees.map((employee) => {
                  const shift = data.shifts.find((s) => s.id === employee.shiftId);
                  const employeeSelected = bulkSelectedEmployeeIds.includes(employee.id);
                  return (
                    <tr
                      key={employee.id}
                      className={cx("entity-row", employeeSelected && "entity-row-selected")}
                      onClick={() => {
                        if (bulkSelectionMode) {
                          toggleBulkEmployeeSelection(employee.id, !employeeSelected);
                          return;
                        }
                        setSelectedEmployeeId(employee.id);
                        setBulkSetupOpen(false);
                        setEmployeeListMode(false);
                      }}
                    >
                      <td className="select-cell" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t("selectEmployeeAria", { name: displayEmployeeName(employee) || employee.enrollNo })}
                          checked={employeeSelected}
                          onChange={(event) => toggleBulkEmployeeSelection(employee.id, event.target.checked)}
                        />
                      </td>
                      <td className="entity-row-key">{employee.enrollNo}</td>
                      <td>{displayEmployeeName(employee) || t("unnamedEmployee")}</td>
                      <td>{translateDataValue(employee.department, lang)}</td>
                      <td>{shift ? translateDataValue(shift.name, lang) : "-"}</td>
                      <td>
                        <div className="condition-pill-list">
                          {employeeConditionSummary(employee).map((item) => <span className="mini-pill" key={item}>{item}</span>)}
                        </div>
                      </td>
                      <td>
                        <span className={cx("mini-pill", employee.active ? "mini-pill-good" : "mini-pill-muted")}>
                          {employee.active ? t("active") : t("inactive")}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {visibleEmployees.length === 0 ? (
                  <tr><td colSpan={7} className="empty-cell">{t("noEmployeeFound")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderEmployeeDetail() {
    if (!selectedEmployee) return null;
    const employeeErrors = employeeRequiredErrors(selectedEmployee);
    const selectedEmployeeShift = data.shifts.find((shift) => shift.id === selectedEmployee.shiftId);
    const individualAttendanceSummary = [
      { label: t("bulkWorkModeLabel"), value: employeeWorkRuleSummary(selectedEmployee) },
      { label: t("shiftLabel"), value: selectedEmployeeShift ? translateDataValue(selectedEmployeeShift.name, lang) : t("notSet") },
      { label: t("employeeGraceMinutesLabel"), value: `${selectedEmployee.graceMinutes}` },
      { label: t("bulkLunchRuleTitle"), value: employeeLunchRuleSummary(selectedEmployee) },
      { label: t("restDaysTitle"), value: employeeRestDaySummary(selectedEmployee) },
      { label: t("exemptionsTitle"), value: employeeExemptionSummary(selectedEmployee) },
    ];
    const inoutCodeForKind: Record<PunchKind, string> = { in: "0", breakOut: "2", breakIn: "3", out: "1" };
    const employeePunchLog = data.punches
      .filter((punch) => punch.employeeId === selectedEmployee.id && punch.date.startsWith(selectedMonth))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const employeeMonthRecords = monthDates(selectedMonth).map((date) => calculateAttendance(data, selectedEmployee, date));
    const employeeWarningRecords = monthlyReadiness.hasOperationalData ? employeeMonthRecords.filter((record) => {
      const unpaidLeave = Boolean(record.leave && leaveNeedsDeductionReview(record.leave, data));
      const calculatedIssue = record.lateMinutes > 0 || record.earlyMinutes > 0 || record.overtimeMinutes > 0;
      const attentionFlag = record.flags.some((flag) =>
        ["late", "early", "ot", "lunchOver", "underWork", "underWorkAccepted", "underWorkDeducted", "noRecord", "noShift", "missingPunch", "holidayWork", "restDayWork"].includes(flag.kind),
      );
      return record.status === "absent" || record.status === "incomplete" || calculatedIssue || attentionFlag || unpaidLeave;
    }) : [];
    const employeeReviewLabels = (record: AttendanceRecord, filter: EmployeeReviewFilter = "all") => {
      const labels: string[] = [];
      const add = (value: string) => {
        if (value && !labels.includes(value)) labels.push(value);
      };
      const includeAll = filter === "all";
      if ((includeAll || filter === "absent") && record.status === "absent") add(statusLabels[lang][record.status]);
      if ((includeAll || filter === "missing") && record.status === "incomplete") add(statusLabels[lang][record.status]);
      if ((includeAll || filter === "lateEarly") && record.lateMinutes > 0) add(formatFlag({ kind: "late", minutes: record.lateMinutes }, lang));
      if ((includeAll || filter === "lateEarly") && record.earlyMinutes > 0) add(formatFlag({ kind: "early", minutes: record.earlyMinutes }, lang));
      if ((includeAll || filter === "ot") && record.overtimeMinutes > 0) add(formatFlag({ kind: "ot", minutes: record.overtimeMinutes }, lang));
      if ((includeAll || filter === "unpaidLeave") && record.leave && leaveNeedsDeductionReview(record.leave, data)) {
        add(`${t("payrollColUnpaidLeaveDays")} (${translateDataValue(record.leave.type, lang)})`);
      }
      record.flags
        .filter((flag) =>
          ["late", "early", "ot", "lunchOver", "underWork", "underWorkAccepted", "underWorkDeducted", "noRecord", "noShift", "missingPunch", "holidayWork", "restDayWork"].includes(flag.kind),
        )
        .filter((flag) => {
          if (includeAll) return true;
          if (filter === "missing") return flag.kind === "noRecord" || flag.kind === "noShift" || flag.kind === "missingPunch";
          if (filter === "shortHours") return flag.kind === "underWork" || flag.kind === "underWorkAccepted" || flag.kind === "underWorkDeducted";
          if (filter === "lateEarly") return flag.kind === "late" || flag.kind === "early";
          if (filter === "lunch") return flag.kind === "lunchOver";
          if (filter === "ot") return flag.kind === "ot";
          return false;
        })
        .forEach((flag) => add(formatFlag(flag, lang)));
      return labels.length > 0 ? labels : [statusLabels[lang][record.status]];
    };
    const employeeWarningCounts = {
      missing: employeeWarningRecords.filter((record) => record.status === "incomplete" || record.flags.some((flag) => flag.kind === "missingPunch" || flag.kind === "noShift")).length,
      absent: employeeWarningRecords.filter((record) => record.status === "absent").length,
      shortHours: employeeWarningRecords.filter((record) => record.flags.some((flag) => flag.kind === "underWork" || flag.kind === "underWorkAccepted" || flag.kind === "underWorkDeducted")).length,
      lateEarly: employeeWarningRecords.filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0).length,
      lunch: employeeWarningRecords.filter((record) => record.flags.some((flag) => flag.kind === "lunchOver")).length,
      ot: employeeWarningRecords.filter((record) => record.overtimeMinutes > 0 || record.flags.some((flag) => flag.kind === "ot")).length,
      unpaidLeave: employeeWarningRecords.filter((record) => record.leave && leaveNeedsDeductionReview(record.leave, data)).length,
    };
    const employeeWarningTotal = Object.values(employeeWarningCounts).reduce((sum, count) => sum + count, 0);
    const employeeWarningFilterOptions: Array<{ key: EmployeeReviewFilter; label: string; value: number; tone: "warn" | "bad" | "good" }> = [
      { key: "missing", label: t("metricMissingPunch"), value: employeeWarningCounts.missing, tone: "warn" },
      { key: "absent", label: t("metricAbsentDays"), value: employeeWarningCounts.absent, tone: "bad" },
      { key: "shortHours", label: t("metricShortHours"), value: employeeWarningCounts.shortHours, tone: "warn" },
      { key: "lateEarly", label: t("metricLateEarly"), value: employeeWarningCounts.lateEarly, tone: "warn" },
      { key: "lunch", label: t("metricLunchOver"), value: employeeWarningCounts.lunch, tone: "warn" },
      { key: "ot", label: t("payrollOtWarnings"), value: employeeWarningCounts.ot, tone: "good" },
      { key: "unpaidLeave", label: t("payrollColUnpaidLeaveDays"), value: employeeWarningCounts.unpaidLeave, tone: "bad" },
    ];
    const employeeWarningActiveFilterLabel =
      employeeReviewFilter === "all"
        ? t("employeeWarningsFilterAll")
        : employeeWarningFilterOptions.find((item) => item.key === employeeReviewFilter)?.label ?? t("employeeWarningsFilterAll");
    const employeeWarningMatchesFilter = (record: AttendanceRecord, filter: EmployeeReviewFilter) => {
      switch (filter) {
        case "missing":
          return record.status === "incomplete" || record.flags.some((flag) => flag.kind === "missingPunch" || flag.kind === "noShift");
        case "absent":
          return record.status === "absent";
        case "shortHours":
          return record.flags.some((flag) => flag.kind === "underWork" || flag.kind === "underWorkAccepted" || flag.kind === "underWorkDeducted");
        case "lateEarly":
          return record.lateMinutes > 0 || record.earlyMinutes > 0;
        case "lunch":
          return record.flags.some((flag) => flag.kind === "lunchOver");
        case "ot":
          return record.overtimeMinutes > 0 || record.flags.some((flag) => flag.kind === "ot");
        case "unpaidLeave":
          return Boolean(record.leave && leaveNeedsDeductionReview(record.leave, data));
        default:
          return true;
      }
    };
    const employeeWarningVisibleRecords = employeeWarningRecords.filter((record) => employeeWarningMatchesFilter(record, employeeReviewFilter));
    const employeeWarningNewestFirst = [...employeeWarningVisibleRecords].sort((a, b) => b.date.localeCompare(a.date));
    const employeeWarningRecentRecords = employeeWarningNewestFirst.slice(0, 5);
    const employeeWarningOlderRecords = employeeWarningNewestFirst.slice(5);
    const renderEmployeeWarningRows = (records: AttendanceRecord[]) => records.map((record) => (
      <tr key={`${record.employee.id}-${record.date}`}>
        <td>{record.date}</td>
        <td><span className={statusClass(record.status)}>{statusLabels[lang][record.status]}</span></td>
        <td>
          <div className="employee-review-tags">
            {employeeReviewLabels(record, employeeReviewFilter).map((label) => <span key={label}>{label}</span>)}
          </div>
        </td>
        <td>{recordPunchTime(record, "in", lang) || "-"}</td>
        <td>{recordPunchTime(record, "out", lang) || "-"}</td>
        <td>{formatHours(record.workMinutes)}</td>
        <td className="timecard-action-cell">
          <Button
            icon={Wand2}
            variant="secondary"
            onClick={() => openTimecardDetail(record.employee.id, record.date)}
          >
            {t("employeeWarningsFix")}
          </Button>
        </td>
      </tr>
    ));
    return (
      <div className="view-stack">
        <div className="detail-back-row">
          <Button icon={ArrowLeft} variant="ghost" onClick={() => setEmployeeListMode(true)}>{t("backToList")}</Button>
          <h2 className="detail-back-title">{displayEmployeeName(selectedEmployee) || t("unnamedEmployee")}</h2>
        </div>
        <div className="employee-detail">
          <section className="panel">
            <SectionTitle title={t("empGroupBasic")} />
            <div className="form-grid three">
              <Field label={t("employeeNoRequired")} required error={employeeErrors.enrollNo}><input required aria-invalid={Boolean(employeeErrors.enrollNo)} value={selectedEmployee.enrollNo} onChange={(event) => patchEmployee(selectedEmployee.id, { enrollNo: event.target.value })} /></Field>
              <Field label={t("workNoRequired")} required error={employeeErrors.workNo}><input required aria-invalid={Boolean(employeeErrors.workNo)} value={selectedEmployee.workNo} onChange={(event) => patchEmployee(selectedEmployee.id, { workNo: event.target.value })} /></Field>
              <Field label={t("statusLabel")}>
                <select value={selectedEmployee.active ? "active" : "inactive"} onChange={(event) => patchEmployee(selectedEmployee.id, { active: event.target.value === "active" })}>
                  <option value="active">{t("active")}</option>
                  <option value="inactive">{t("inactive")}</option>
                </select>
              </Field>
              <Field label={t("lastNameRequired")} required error={employeeErrors.lastName}><input required aria-invalid={Boolean(employeeErrors.lastName)} value={selectedEmployee.lastName} onChange={(event) => patchEmployee(selectedEmployee.id, { lastName: event.target.value })} /></Field>
              <Field label={t("firstNameRequired")} required error={employeeErrors.firstName}><input required aria-invalid={Boolean(employeeErrors.firstName)} value={selectedEmployee.firstName} onChange={(event) => patchEmployee(selectedEmployee.id, { firstName: event.target.value })} /></Field>
              <Field label={t("genderLabel")} required error={employeeErrors.gender}>
                <select required value={selectedEmployee.gender} onChange={(event) => patchEmployee(selectedEmployee.id, { gender: event.target.value as Gender })}>
                  <option value="male">{t("male")}</option>
                  <option value="female">{t("female")}</option>
                </select>
              </Field>
              <Field label={t("idNoLabel")}><input value={selectedEmployee.idNo} onChange={(event) => patchEmployee(selectedEmployee.id, { idNo: event.target.value })} /></Field>
              <Field label={t("birthDateLabel")}><input type="date" value={selectedEmployee.birthDate} onChange={(event) => patchEmployee(selectedEmployee.id, { birthDate: event.target.value })} /></Field>
              <Field label={t("birthPlaceLabel")}><input value={selectedEmployee.birthPlace} onChange={(event) => patchEmployee(selectedEmployee.id, { birthPlace: event.target.value })} /></Field>
              <Field label={t("nationalityLabel")}>
                <select value={selectedEmployee.nationality} onChange={(event) => patchEmployee(selectedEmployee.id, { nationality: event.target.value })}>
                  {selectedEmployee.nationality && !data.settings.nationalities.includes(selectedEmployee.nationality) ? (
                    <option value={selectedEmployee.nationality}>{translateDataValue(selectedEmployee.nationality, lang)}</option>
                  ) : null}
                  {data.settings.nationalities.map((nationality) => <option key={nationality} value={nationality}>{translateDataValue(nationality, lang)}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t("addressLabel")}><textarea rows={2} value={selectedEmployee.address} onChange={(event) => patchEmployee(selectedEmployee.id, { address: event.target.value })} /></Field>
          </section>

          <section className="panel">
            <SectionTitle title={t("empGroupWork")} />
            <div className="form-grid three">
              <Field label={t("companyLabel")}>
                <select value={selectedEmployee.company} onChange={(event) => patchEmployee(selectedEmployee.id, { company: event.target.value })}>
                  {data.settings.companies.map((company) => <option key={company} value={company}>{translateDataValue(company, lang)}</option>)}
                </select>
              </Field>
              <Field label={t("departmentLabel")}>
                <select value={selectedEmployee.department} onChange={(event) => patchEmployee(selectedEmployee.id, { department: event.target.value })}>
                  {data.settings.departments.map((department) => <option key={department} value={department}>{translateDataValue(department, lang)}</option>)}
                </select>
              </Field>
              <Field label={t("positionLabel")}>
                <select value={selectedEmployee.position} onChange={(event) => patchEmployee(selectedEmployee.id, { position: event.target.value })}>
                  {selectedEmployee.position && !data.settings.positions.includes(selectedEmployee.position) ? (
                    <option value={selectedEmployee.position}>{translateDataValue(selectedEmployee.position, lang)}</option>
                  ) : null}
                  {data.settings.positions.map((position) => <option key={position} value={position}>{translateDataValue(position, lang)}</option>)}
                </select>
              </Field>
              <Field label={t("joinDateLabel")}><input type="date" value={selectedEmployee.joinDate} onChange={(event) => patchEmployee(selectedEmployee.id, { joinDate: event.target.value })} /></Field>
            </div>
          </section>

          <section className="panel attendance-rules-panel">
            <SectionTitle
              title={t("individualAttendanceRulesTitle")}
              action={
                <Button
                  icon={individualAttendanceRulesEditing ? CheckCircle2 : Settings2}
                  variant={individualAttendanceRulesEditing ? "secondary" : "primary"}
                  onClick={() => setIndividualAttendanceRulesEditing((editing) => !editing)}
                >
                  {individualAttendanceRulesEditing ? t("doneEditingRules") : t("editIndividualRules")}
                </Button>
              }
            />
            <p className="panel-caption">
              {t("individualAttendanceRulesCaption", { employee: displayEmployeeName(selectedEmployee) || selectedEmployee.enrollNo })}
            </p>
            <div className="attendance-rule-summary" aria-label={t("individualAttendanceRulesSummary")}>
              {individualAttendanceSummary.map((item) => (
                <div className="attendance-rule-summary-item" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            {individualAttendanceRulesEditing ? (
            <div className="attendance-rule-edit-area">
              <p className="attendance-rule-edit-note">{t("individualAttendanceRulesEditHint")}</p>
              <div className="attendance-rule-grid">
              <div className="attendance-rule-card">
                <Field label={t("shiftLabel")}>
                  <select value={selectedEmployee.shiftId} onChange={(event) => patchEmployee(selectedEmployee.id, { shiftId: event.target.value })}>
                    {data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{translateDataValue(shift.name, lang)}</option>)}
                  </select>
                </Field>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={selectedEmployee.autoShift}
                    disabled={selectedEmployee.flexibleWork}
                    onChange={(event) => {
                      const autoShift = event.target.checked;
                      patchEmployee(selectedEmployee.id, {
                        autoShift,
                      });
                    }}
                  />
                  <span>{t("autoShiftLabel")}</span>
                </label>
                <Field label={t("employeeGraceMinutesLabel")}>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={selectedEmployee.graceMinutes}
                    onChange={(event) => patchEmployee(selectedEmployee.id, { graceMinutes: Number(event.target.value) })}
                  />
                </Field>
              </div>

              <div className="attendance-rule-card">
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={selectedEmployee.flexibleWork}
                    onChange={(event) => {
                      const flexibleWork = event.target.checked;
                      patchEmployee(selectedEmployee.id, {
                        flexibleWork,
                        autoShift: flexibleWork ? false : selectedEmployee.autoShift,
                      });
                    }}
                  />
                  <span>{t("employeeFlexibleWorkToggle")}</span>
                </label>
                <Field label={t("employeeWorkLengthLabel")}>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={selectedEmployee.workLengthHours}
                    disabled={!selectedEmployee.flexibleWork}
                    onChange={(event) => patchEmployee(selectedEmployee.id, { workLengthHours: Number(event.target.value) })}
                  />
                  <small className="field-help">{t(selectedEmployee.flexibleWork ? "employeeFlexibleWorkHelp" : "employeeFlexibleWorkDisabledHelp")}</small>
                </Field>
              </div>

              <div className="attendance-rule-card">
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={selectedEmployee.flexibleLunch}
                    onChange={(event) => patchEmployee(selectedEmployee.id, { flexibleLunch: event.target.checked })}
                  />
                  <span>{t("employeeFlexibleLunchToggle")}</span>
                </label>
                <Field label={t("employeeLunchMinutesLabel")}>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={selectedEmployee.lunchMinutes}
                    disabled={!selectedEmployee.flexibleLunch}
                    onChange={(event) => patchEmployee(selectedEmployee.id, { lunchMinutes: Number(event.target.value) })}
                  />
                  <small className="field-help">{t(selectedEmployee.flexibleLunch ? "employeeFlexibleLunchHelp" : "employeeFlexibleLunchDisabledHelp")}</small>
                </Field>
              </div>
            </div>
            <div className="subsection-grid attendance-subsection-grid">
              <div className="attendance-subsection-card">
                <h3>{t("restDaysTitle")}</h3>
                <div className="chip-grid">
                  {weekdayOrder.map((day) => (
                    <label className="check-chip" key={day}>
                      <input
                        type="checkbox"
                        checked={selectedEmployee.restDays.includes(day)}
                        onChange={(event) => {
                          const restDays = event.target.checked
                            ? [...selectedEmployee.restDays, day]
                            : selectedEmployee.restDays.filter((item) => item !== day);
                          patchEmployee(selectedEmployee.id, { restDays });
                        }}
                      />
                      <span>{weekdayLabels[lang][day]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="attendance-subsection-card">
                <h3>{t("exemptionsTitle")}</h3>
                <div className="chip-grid">
                  {[
                    ["late", t("exemptLate")],
                    ["early", t("exemptEarly")],
                    ["lunchPunch", t("exemptLunchPunch")],
                    ["overtime", t("exemptOvertime")],
                  ].map(([key, label]) => (
                    <label className="check-chip" key={key}>
                      <input
                        type="checkbox"
                        checked={selectedEmployee.exemptions[key as keyof Employee["exemptions"]]}
                        onChange={(event) =>
                          patchEmployee(selectedEmployee.id, {
                            exemptions: { ...selectedEmployee.exemptions, [key]: event.target.checked },
                          })
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            </div>
            ) : (
              <div className="attendance-rule-readonly-note">
                <strong>{t("individualAttendanceRulesReadOnlyTitle")}</strong>
                <span>{t("individualAttendanceRulesReadOnlyBody")}</span>
              </div>
            )}
          </section>

          <section className="panel">
            <SectionTitle title={t("empGroupSalary")} />
            <p className="panel-caption">{t("salaryEmployeeOverrideNote")}</p>
            <div className="payroll-settings-layout">
              <section className="payroll-settings-card payroll-settings-primary">
                <strong>{t("salaryMainPayTitle")}</strong>
                <div className="form-grid three payroll-settings-grid">
                  <Field label={t("salaryTypeLabel")}>
                    <select value={selectedEmployee.salary.type} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, type: event.target.value as "monthly" | "hourly" } })}>
                      <option value="monthly">{t("salaryTypeMonthly")}</option>
                      <option value="hourly">{t("salaryTypeHourly")}</option>
                    </select>
                  </Field>
                  <Field label={t("salaryCurrencyLabel")}>
                    <input value={selectedEmployee.salary.currency} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, currency: event.target.value } })} />
                  </Field>
                  {selectedEmployee.salary.type === "monthly" ? (
                    <Field label={t("salaryMonthlyAmount")}>
                      <input type="number" min="0" step="50" value={selectedEmployee.salary.monthlyAmount} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, monthlyAmount: Number(event.target.value) } })} />
                    </Field>
                  ) : (
                    <Field label={t("salaryHourlyRate")}>
                      <input type="number" min="0" step="0.5" value={selectedEmployee.salary.hourlyRate} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, hourlyRate: Number(event.target.value) } })} />
                    </Field>
                  )}
                </div>
              </section>

              <section className="payroll-settings-card">
                <strong>{t("salaryOtSettingsTitle")}</strong>
                <div className={cx("form-grid payroll-settings-grid", selectedEmployee.salary.type === "monthly" ? "two" : "one")}>
                  {selectedEmployee.salary.type === "monthly" ? (
                    <Field label={t("salaryOtHourlyRate")}>
                      <input type="number" min="0" step="0.5" value={selectedEmployee.salary.hourlyRate} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, hourlyRate: Number(event.target.value) } })} />
                    </Field>
                  ) : null}
                  <Field label={t("salaryOtMultiplier")}>
                    <input type="number" min="1" step="0.1" value={selectedEmployee.salary.otMultiplier} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, otMultiplier: Number(event.target.value) } })} />
                  </Field>
                </div>
                <p className="payroll-settings-note">
                  {selectedEmployee.salary.type === "monthly" ? t("salaryMonthlyOtHelp") : t("salaryHourlyOtHelp")}
                </p>
              </section>
            </div>
            <p className="panel-caption">{t("salaryHelpOT")}</p>
            {!monthlyReadiness.hasOperationalData ? (
              <div className="payroll-preview payroll-preview-empty">
                <div className="payroll-preview-header">
                  <strong>{t("payrollPreviewTitle")}</strong>
                  <span>{t("payrollPreviewMonth")} {selectedMonth}</span>
                </div>
                <div className="empty-cell payroll-preview-empty-message">
                  <strong>{t("payrollPreviewNoDataTitle")}</strong>
                  <span>{t("payrollPreviewNoDataBody")}</span>
                </div>
              </div>
            ) : (() => {
              const pay = payrollFor(data, selectedEmployee, selectedMonth);
              const fmt = (n: number) => `${pay.currency} ${n.toFixed(2)}`;
              return (
                <div className="payroll-preview">
                  <div className="payroll-preview-header">
                    <strong>{t("payrollPreviewTitle")}</strong>
                    <span>{t("payrollPreviewMonth")} {selectedMonth}</span>
                  </div>
                  <div className="payroll-preview-groups">
                    <section className="payroll-preview-card">
                      <div className="payroll-preview-card-head">
                        <strong>{t("payrollPreviewWorkSummary")}</strong>
                      </div>
                      <div className="payroll-preview-list">
                        <div className="payroll-preview-item"><span>{t("payrollPreviewWorkHours")}</span><strong>{formatDecimalHours(pay.workHours, lang)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollPreviewPaidLeaveHours")}</span><strong>{formatDecimalHours(pay.summary.paidLeaveHours, lang)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollPreviewOtHours")}</span><strong>{formatDecimalHours(pay.otHours, lang)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollPreviewLeaveDays")}</span><strong>{pay.summary.paidLeaveDays}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollColAbsentDays")}</span><strong>{pay.summary.absentDays}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollColDeductedAbsentDays")}</span><strong>{pay.summary.deductedAbsentDays}</strong></div>
                      </div>
                    </section>

                    <section className="payroll-preview-card payroll-preview-card-pay">
                      <div className="payroll-preview-card-head">
                        <strong>{t("payrollPreviewPaySummary")}</strong>
                      </div>
                      <div className="payroll-preview-list">
                        <div className="payroll-preview-item"><span>{t("payrollPreviewBase")}</span><strong>{fmt(pay.base)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollPreviewOtPay")}</span><strong>{fmt(pay.otPay)}</strong></div>
                        <div className="payroll-preview-item payroll-preview-gross"><span>{t("payrollPreviewGross")}</span><strong>{fmt(pay.gross)}</strong></div>
                      </div>
                    </section>

                    <section className="payroll-preview-card payroll-preview-card-deduct">
                      <div className="payroll-preview-card-head">
                        <strong>{t("payrollPreviewDeductionSummary")}</strong>
                      </div>
                      <div className="payroll-preview-list">
                        <div className="payroll-preview-item"><span>{t("payrollPreviewDeductibleLeaveDays")}</span><strong>{pay.summary.deductibleLeaveDays}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollPreviewDeductedUnpaidLeaveDays")}</span><strong>{pay.summary.deductedUnpaidLeaveDays}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollColAbsentDeduct")}</span><strong>−{fmt(pay.absentDeduct)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollColLeaveDeduct")}</span><strong>−{fmt(pay.unpaidLeaveDeduct)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollColShortHoursDeduct")}</span><strong>−{fmt(pay.shortHoursDeduct)}</strong></div>
                        <div className="payroll-preview-item"><span>{t("payrollColReviewDeduct")}</span><strong>−{fmt(pay.reviewDeduct)}</strong></div>
                        <div className="payroll-preview-item payroll-preview-total-deduct"><span>{t("payrollColTotalDeduct")}</span><strong>−{fmt(pay.totalDeduct)}</strong></div>
                      </div>
                    </section>
                  </div>
                  {pay.proration < 1 ? (
                    <p className="panel-caption muted">
                      {t("payrollPreviewProrationNote", {
                        proratedDays: pay.proratedDays,
                        totalDays: pay.totalMonthDays,
                      })}
                    </p>
                  ) : null}
                  <p className="panel-caption muted">
                    {selectedEmployee.salary.type === "monthly"
                      ? t("payrollPreviewNoteMonthly")
                      : t("payrollPreviewNoteHourly")}
                  </p>
                </div>
              );
            })()}
          </section>

          <section className="panel employee-warning-panel">
            <SectionTitle
              title={t("employeeWarningsTitle")}
              action={
                <span className={cx("mini-pill", !monthlyReadiness.hasOperationalData ? "mini-pill-muted" : employeeWarningTotal > 0 ? "mini-pill-warn" : "mini-pill-good")}>
                  {!monthlyReadiness.hasOperationalData
                    ? t("employeeWarningsNoDataShort")
                    : employeeWarningTotal > 0
                      ? t("employeeWarningsCount", { count: employeeWarningTotal })
                      : t("employeeWarningsClear")}
                </span>
              }
            />
            <p className="panel-caption">{t("employeeWarningsCaption")}</p>
            <p className="panel-caption muted">{t("employeeWarningsReadOnlyHint")}</p>
            <button
              type="button"
              className={cx("employee-warning-filter-reset", employeeReviewFilter === "all" && "employee-warning-filter-reset-active")}
              onClick={() => setEmployeeReviewFilter("all")}
            >
              {employeeReviewFilter === "all"
                ? t("employeeWarningsFilterAll")
                : t("employeeWarningsFilterActive", { label: employeeWarningActiveFilterLabel })}
            </button>
            <div className="employee-warning-summary">
              {employeeWarningFilterOptions.map((item) => (
                <button
                  type="button"
                  className={cx(
                    "employee-warning-tile",
                    item.value > 0 && `employee-warning-tile-${item.tone}`,
                    employeeReviewFilter === item.key && "employee-warning-tile-active",
                  )}
                  key={item.key}
                  aria-pressed={employeeReviewFilter === item.key}
                  onClick={() => setEmployeeReviewFilter((current) => (current === item.key ? "all" : item.key))}
                >
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className="table-wrap employee-warning-list">
              <table>
                <thead>
                  <tr>
                    <th>{t("colDate")}</th>
                    <th>{t("colStatus")}</th>
                    <th>{t("colFlags")}</th>
                    <th>{t("colIn")}</th>
                    <th>{t("colOut")}</th>
                    <th>{t("colHours")}</th>
                    <th>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {renderEmployeeWarningRows(employeeWarningRecentRecords)}
                  {employeeWarningVisibleRecords.length === 0 ? (
                    <tr><td colSpan={7} className="empty-cell">
                      {monthlyReadiness.hasOperationalData
                        ? employeeReviewFilter === "all"
                          ? t("employeeWarningsEmpty")
                          : t("employeeWarningsFilteredEmpty")
                        : t("employeeWarningsNoData")}
                    </td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {employeeWarningOlderRecords.length > 0 ? (
              <details className="employee-warning-older">
                <summary>{t("employeeWarningsOlderDetails", { count: employeeWarningOlderRecords.length })}</summary>
                <div className="table-wrap employee-warning-list employee-warning-older-list">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("colDate")}</th>
                        <th>{t("colStatus")}</th>
                        <th>{t("colFlags")}</th>
                        <th>{t("colIn")}</th>
                        <th>{t("colOut")}</th>
                        <th>{t("colHours")}</th>
                        <th>{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {renderEmployeeWarningRows(employeeWarningOlderRecords)}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </section>

          <section className="panel employee-punch-log">
            <SectionTitle
              title={t("employeePunchLogSimpleTitle")}
              action={<Button icon={FileSpreadsheet} variant="secondary" onClick={() => openReports("personal")}>{t("employeeOpenMonthlyReport")}</Button>}
            />
            <p className="panel-caption">{t("employeePunchLogCaption")}</p>
            <div className="punch-log-summary">
              <div>
                <span>{t("employeePunchEnrollNo")}</span>
                <strong>{selectedEmployee.enrollNo}</strong>
              </div>
              <div>
                <span>{t("monthLabel")}</span>
                <strong>{selectedMonth}</strong>
              </div>
              <div>
                <span>{t("employeePunchTotal")}</span>
                <strong>{employeePunchLog.length}</strong>
              </div>
            </div>
            <div className="table-wrap">
              <table className="machine-log-table">
                <thead>
                  <tr>
                    <th>{t("colDate")}</th>
                    <th>{t("colTime")}</th>
                    <th>{t("employeePunchType")}</th>
                    <th>{t("employeePunchDevice")}</th>
                    <th>{t("employeePunchMode")}</th>
                    <th>{t("employeePunchMachineCode")}</th>
                  </tr>
                </thead>
                <tbody>
                  {employeePunchLog.map((punch, index) => (
                    <tr key={punch.id}>
                      <td className="punch-detail-cell">
                        <strong>{punch.date}</strong>
                        <small>{t("employeePunchRawNo", { no: punch.rawNo || index + 1 })}</small>
                      </td>
                      <td>{punch.time}</td>
                      <td><span className="punch-type-pill">{punchKindLabels[lang][punch.kind]}</span></td>
                      <td>{punch.machineNo ? t("employeePunchDeviceNo", { no: punch.machineNo }) : t("employeePunchDeviceUnknown")}</td>
                      <td>{punch.verifyMode || (punch.source === "manual" ? t("employeePunchModeManual") : "-")}</td>
                      <td>
                        <span className="machine-code">{punch.inoutCode || inoutCodeForKind[punch.kind]}</span>
                        <small className="machine-code-note">{t("employeePunchMachineCodeHint")}</small>
                      </td>
                    </tr>
                  ))}
                  {employeePunchLog.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-cell">{t("employeePunchNoRecords")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderShifts() {
    if (shiftListMode || !selectedShift) {
      return renderShiftList();
    }
    return renderShiftDetail();
  }

  function renderShiftList() {
    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle
            title={t("shiftOptionsTitle")}
            action={<Button icon={Plus} onClick={() => { addShift(); setShiftListMode(false); }}>{t("addShift")}</Button>}
          />
          <div className="table-wrap">
            <table className="entity-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{t("shiftNameLabel")}</th>
                  <th>{t("shiftCodeLabel")}</th>
                  <th>{t("schedHeaderStart")}</th>
                  <th>{t("shiftLunchWindowLabel")}</th>
                  <th>{t("schedHeaderEnd")}</th>
                </tr>
              </thead>
              <tbody>
                {data.shifts.map((shift) => {
                  const monSched = shift.days[1];
                  return (
                    <tr
                      key={shift.id}
                      className="entity-row"
                      onClick={() => {
                        setSelectedShiftId(shift.id);
                        setShiftListMode(false);
                      }}
                    >
                      <td><span className="shift-color-dot" style={{ background: shift.color }} /></td>
                      <td className="entity-row-key">{translateDataValue(shift.name, lang)}</td>
                      <td>{shift.code}</td>
                      <td>{scheduleTimeLabel(monSched, "start", lang)}</td>
                      <td>{scheduleTimeLabel(monSched, "lunchStart", lang)} - {scheduleTimeLabel(monSched, "lunchEnd", lang)}</td>
                      <td>{scheduleTimeLabel(monSched, "end", lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderShiftDetail() {
    if (!selectedShift) return null;
    const samplePunch = selectedDateRecord?.clockIn || "10:12";
    const suggestedShift = findShiftForPunch(data.shifts, selectedDate, samplePunch);
    return (
      <div className="view-stack">
        <div className="detail-back-row">
          <Button icon={ArrowLeft} variant="ghost" onClick={() => setShiftListMode(true)}>{t("backToList")}</Button>
          <h2 className="detail-back-title">
            <span className="shift-color-dot" style={{ background: selectedShift.color }} />
            {translateDataValue(selectedShift.name, lang)}
          </h2>
        </div>

        <section className="panel">
          <SectionTitle title={t("shiftOptionsTitle")} />

          <div className="form-grid three">
            <Field label={t("shiftNameLabel")}><input value={translateDataValue(selectedShift.name, lang)} onChange={(event) => patchShift(selectedShift.id, { name: event.target.value })} /></Field>
            <Field label={t("shiftCodeLabel")}><input value={selectedShift.code} onChange={(event) => patchShift(selectedShift.id, { code: event.target.value })} /></Field>
            <Field label={t("shiftColorLabel")}>
              <input type="color" value={selectedShift.color} onChange={(event) => patchShift(selectedShift.id, { color: event.target.value })} />
            </Field>
          </div>

          <div className="table-wrap">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>{t("schedHeaderWeekday")}</th>
                  <th>{t("schedHeaderStart")}</th>
                  <th>{t("schedHeaderLunchStart")}</th>
                  <th>{t("schedHeaderLunchEnd")}</th>
                  <th>{t("schedHeaderEnd")}</th>
                  <th>{t("schedHeaderOtStart")}</th>
                  <th>{t("schedHeaderOtEnd")}</th>
                  <th>{t("schedHeaderOff")}</th>
                </tr>
              </thead>
              <tbody>
                {weekdayOrder.map((day) => {
                  const schedule = selectedShift.days[day];
                  return (
                    <tr key={day}>
                      <td>{weekdayLabels[lang][day]}</td>
                      {(["start", "lunchStart", "lunchEnd", "end", "otStart", "otEnd"] as Array<keyof Pick<DaySchedule, "start" | "lunchStart" | "lunchEnd" | "end" | "otStart" | "otEnd">>).map((key) => (
                        <td key={key}>
                          <input type="time" value={String(schedule[key])} onChange={(event) => patchShiftDay(selectedShift.id, day, { [key]: event.target.value })} />
                          {key !== "start" && scheduleTimeLabel(schedule, key, lang) !== String(schedule[key]) ? (
                            <small className="overnight-note">{t("nextDaySuffix", { count: 1 })}</small>
                          ) : null}
                        </td>
                      ))}
                      <td>
                        <input type="checkbox" checked={schedule.off} onChange={(event) => patchShiftDay(selectedShift.id, day, { off: event.target.checked })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionTitle title={t("autoShiftTitle")} />
          <p className="panel-caption">{t("autoShiftCaption")}</p>

          {(() => {
            const weekday = getWeekday(selectedDate);
            const candidates = data.shifts
              .filter((shift) => isAutoShiftCandidate(shift, selectedDate))
              .map((s) => {
                const startStr = s.days[weekday].start;
                const startMin = minutesFromTime(startStr);
                const punchMin = minutesFromTime(autoShiftSimTime);
                const diff = Math.abs(startMin - punchMin);
                return { shift: s, startStr, diff };
              })
              .sort((a, b) => a.diff - b.diff);
            const winner = candidates[0]?.shift;
            const verdict = !winner
              ? t("autoShiftSimVerdictNoFixedShift")
              : t("autoShiftSimVerdictClosest", { shift: translateDataValue(winner.name, lang) });

            return (
              <div className="auto-shift-sim">
                <div className="auto-shift-sim-input">
                  <Field label={t("autoShiftSimPunchLabel")}>
                    <input type="time" value={autoShiftSimTime} onChange={(event) => setAutoShiftSimTime(event.target.value)} />
                  </Field>
                </div>

                <div className="auto-shift-sim-distance">
                  <span className="mini-label">{t("autoShiftSimDistanceLabel")}</span>
                  <ul>
                    {candidates.map(({ shift, startStr, diff }, idx) => (
                      <li key={shift.id} className={cx(idx === 0 && "auto-shift-sim-winner")}>
                        <span className="auto-shift-sim-color" style={{ background: shift.color }} />
                        <strong>{translateDataValue(shift.name, lang)}</strong>
                        <span className="muted">{t("schedHeaderStart")} {startStr}</span>
                        <span>{t("autoShiftSimDistanceValue", { mins: diff })}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="auto-shift-sim-result">
                  <div>
                    <span className="mini-label">{t("autoShiftSuggested")}</span>
                    <strong>{winner ? translateDataValue(winner.name, lang) : "—"}</strong>
                  </div>
                  <div>
                    <span className="mini-label">{t("autoShiftSimVerdictLabel")}</span>
                    <strong className={cx(!winner ? "auto-shift-sim-bad" : "auto-shift-sim-good")}>
                      {verdict}
                    </strong>
                  </div>
                </div>
              </div>
            );
          })()}
        </section>
      </div>
    );
  }

  function renderTimeCards() {
    const hasOperationalData = monthlyReadiness.hasOperationalData;
    const unresolvedDeductionItems = deductionReviewItems.filter((item) => !isResolvedReviewDecision(item.decision));
    const actionableDeductionItems = hasOperationalData ? unresolvedDeductionItems : [];
    const unresolvedRecordKeys = new Set(
      actionableDeductionItems.map((item) => `${item.employee.id}:${item.date}`),
    );
    const unresolvedRecordKind = (record: AttendanceRecord, kinds: AttendanceReviewKind[]) =>
      actionableDeductionItems.some(
        (item) => item.employee.id === record.employee.id && item.date === record.date && kinds.includes(item.kind),
      );
    const pendingRecords = hasOperationalData
      ? monthRecords
          .filter((record) =>
            unresolvedRecordKeys.has(`${record.employee.id}:${record.date}`) ||
            record.flags.some((f) => f.kind === "lunchOver") ||
            record.overtimeMinutes > 0
          )
          .sort((a, b) => `${a.date} ${a.employee.enrollNo}`.localeCompare(`${b.date} ${b.employee.enrollNo}`))
      : [];
    const pendingStats = {
      all: pendingRecords.length,
      absent: actionableDeductionItems.filter((item) => item.kind === "absent").length,
      incomplete: actionableDeductionItems.filter((item) => item.kind === "missingPunch").length,
      shortHours: actionableDeductionItems.filter((item) => item.kind === "shortHours").length,
      lateEarly: actionableDeductionItems.filter((item) => item.kind === "late" || item.kind === "early").length,
      unpaidLeave: actionableDeductionItems.filter((item) => item.kind === "unpaidLeave").length,
    };
    const reviewKindsForRecord = (record: AttendanceRecord) =>
      actionableDeductionItems.filter((item) => item.employee.id === record.employee.id && item.date === record.date);
    const reviewRouteLabelForKinds = (kinds: AttendanceReviewKind[]) => {
      if (kinds.includes("absent")) return t("reviewRouteAbsent");
      if (kinds.includes("unpaidLeave")) return t("reviewRouteLeaveDeduction");
      if (kinds.includes("missingPunch")) return t("reviewRouteFixTimecard");
      return t("reviewRouteDailyDeduction");
    };
    const reviewRouteLabelForRecord = (record: AttendanceRecord) => {
      const kinds = reviewKindsForRecord(record).map((item) => item.kind);
      if (kinds.length) return reviewRouteLabelForKinds(kinds);
      if (record.overtimeMinutes > 0) return t("reviewRoutePayrollReview");
      return t("reviewRouteDailyDeduction");
    };
    const workflowTabForRecord = (record: AttendanceRecord): TimecardWorkflowTab => {
      const kinds = reviewKindsForRecord(record).map((item) => item.kind);
      if (kinds.includes("missingPunch")) return "fix";
      if (kinds.some((kind) => kind === "absent" || kind === "unpaidLeave" || kind === "late" || kind === "early" || kind === "shortHours")) {
        return "deduction";
      }
      return "monthly";
    };
    const primaryReviewItemForRecord = (record: AttendanceRecord): DeductionReviewItem | undefined => {
      const items = reviewKindsForRecord(record);
      return (
        items.find((item) => item.kind === "missingPunch") ??
        items.find((item) => item.kind === "absent" || item.kind === "unpaidLeave") ??
        items[0]
      );
    };
    const reviewIssueLabelsForRecord = (record: AttendanceRecord) => {
      const labels = reviewKindsForRecord(record).map((item) => deductionIssueLabel(item.kind));
      if (record.flags.some((flag) => flag.kind === "lunchOver")) labels.push(t("metricLunchOver"));
      if (record.overtimeMinutes > 0) labels.push(t("payrollOtWarnings"));
      return Array.from(new Set(labels.length ? labels : [formatFlags(record.flags, lang)]));
    };
    const openEmployeeMonthReview = (employee: Employee, reviewItems: DeductionReviewItem[], otRecords: AttendanceRecord[]) => {
      const nextItem = reviewItems.find((item) => !isResolvedReviewDecision(item.decision)) ?? reviewItems[0];
      const firstOtRecord = otRecords[0];
      setSelectedEmployeeId(employee.id);
      setSelectedDate(nextItem?.date ?? firstOtRecord?.date ?? selectedDate);
      setActiveTimecardReviewItemId(nextItem?.id ?? (firstOtRecord ? `ot-${employee.id}-${firstOtRecord.date}` : null));
      setTimecardWorkflowPrompt(null);
      setTimecardWorkflowTab("monthly");
      setTimecardStatusFilter("all");
      setTimecardPage(1);
      setTimecardDetailOpen(true);
      openThisMonth("timecards");
    };
    const normalizedSearch = timecardSearch.trim().toLowerCase();
    const employeeQueueRows = activeEmployees
      .map((employee) => {
        const reviewItems = deductionReviewItems
          .filter((item) => item.employee.id === employee.id)
          .sort((a, b) => `${a.date} ${a.kind}`.localeCompare(`${b.date} ${b.kind}`));
        const unresolvedItems = reviewItems.filter((item) => !isResolvedReviewDecision(item.decision));
        const otRecords = monthRecords
          .filter((record) => record.employee.id === employee.id && record.overtimeMinutes > 0)
          .sort((a, b) => a.date.localeCompare(b.date));
        const lateEarlyCount = unresolvedItems.filter((item) => item.kind === "late" || item.kind === "early").length;
        const shortHoursCount = unresolvedItems.filter((item) => item.kind === "shortHours").length;
        const absentCount = unresolvedItems.filter((item) => item.kind === "absent").length;
        const leaveDeductionCount = unresolvedItems.filter((item) => item.kind === "unpaidLeave").length;
        const missingPunchCount = unresolvedItems.filter((item) => item.kind === "missingPunch").length;
        const resolvedCount = reviewItems.filter((item) => isResolvedReviewDecision(item.decision)).length;
        const totalReviewItems = reviewItems.length + otRecords.length;
        const pendingReviewItems = unresolvedItems.length + otRecords.length;
        const shift = data.shifts.find((item) => item.id === employee.shiftId);
        const status: "notReviewed" | "partial" | "completed" | "needsCorrection" =
          missingPunchCount > 0
            ? "needsCorrection"
            : pendingReviewItems === 0
              ? "completed"
              : resolvedCount > 0
                ? "partial"
                : "notReviewed";
        return {
          employee,
          shift,
          reviewItems,
          otRecords,
          totalReviewItems,
          pendingReviewItems,
          lateEarlyCount,
          shortHoursCount,
          absentCount,
          leaveDeductionCount,
          missingPunchCount,
          otReviewCount: otRecords.length,
          status,
        };
      })
      .filter((row) => row.totalReviewItems > 0)
      .filter((row) => {
        if (timecardStatusFilter === "absent" && row.absentCount === 0) return false;
        if (timecardStatusFilter === "incomplete" && row.missingPunchCount === 0) return false;
        if (timecardStatusFilter === "shortHours" && row.shortHoursCount === 0) return false;
        if (timecardStatusFilter === "lateEarly" && row.lateEarlyCount === 0) return false;
        if (timecardStatusFilter === "unpaidLeave" && row.leaveDeductionCount === 0) return false;
        if (!normalizedSearch) return true;
        const haystack = [
          row.employee.enrollNo,
          row.employee.workNo,
          displayEmployeeName(row.employee),
          row.employee.department,
          row.employee.company,
          row.employee.position,
          row.shift ? translateDataValue(row.shift.name, lang) : "",
        ].join(" ").toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) =>
        `${a.status === "needsCorrection" ? "0" : "1"} ${String(999 - a.pendingReviewItems).padStart(3, "0")} ${a.employee.enrollNo}`
          .localeCompare(`${b.status === "needsCorrection" ? "0" : "1"} ${String(999 - b.pendingReviewItems).padStart(3, "0")} ${b.employee.enrollNo}`),
      );
    const filteredPendingRecords = pendingRecords.filter((record) => {
      if (timecardStatusFilter === "absent" && !unresolvedRecordKind(record, ["absent"])) return false;
      if (timecardStatusFilter === "incomplete" && !unresolvedRecordKind(record, ["missingPunch"])) return false;
      if (timecardStatusFilter === "shortHours" && !unresolvedRecordKind(record, ["shortHours"])) return false;
      if (timecardStatusFilter === "lateEarly" && !unresolvedRecordKind(record, ["late", "early"])) return false;
      if (timecardStatusFilter === "unpaidLeave" && !unresolvedRecordKind(record, ["unpaidLeave"])) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        record.date,
        record.employee.enrollNo,
        record.employee.workNo,
        displayEmployeeName(record.employee),
        record.employee.department,
        record.employee.company,
        record.shift ? translateDataValue(record.shift.name, lang) : "",
        statusLabels[lang][record.status],
        formatFlags(record.flags, lang),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    });
    const activeQueueTotal = timecardQueueMode === "employee" ? employeeQueueRows.length : filteredPendingRecords.length;
    const totalPages = Math.max(1, Math.ceil(activeQueueTotal / timecardPageSize));
    const currentTimecardPage = Math.min(timecardPage, totalPages);
    const pageStart = (currentTimecardPage - 1) * timecardPageSize;
    const pageEmployeeRows = employeeQueueRows.slice(pageStart, pageStart + timecardPageSize);
    const pageRecords = filteredPendingRecords.slice(pageStart, pageStart + timecardPageSize);
    const resultStart = activeQueueTotal === 0 ? 0 : pageStart + 1;
    const resultEnd = Math.min(pageStart + timecardPageSize, activeQueueTotal);
    const shiftOverride = selectedEmployee?.shiftOverrides?.[selectedDate] ?? "";
    const restOverride = selectedEmployee?.restOverrides?.[selectedDate];
    const currentRestValue = restOverride === undefined ? "" : restOverride ? "rest" : "work";
    const correctionAudits = dedupeTimecardCorrectionAudits(data.timecardCorrectionAudits ?? []);
    const selectedTimecardAudits = correctionAudits
      .filter((audit) => audit.employeeId === selectedEmployeeId && audit.date === selectedDate)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    const selectedEmployeeDeductionReviewItems = selectedEmployee
      ? deductionReviewItems
          .filter((item) => item.employee.id === selectedEmployee.id)
          .sort((a, b) => `${a.date} ${a.kind}`.localeCompare(`${b.date} ${b.kind}`))
      : [];
    const selectedDeductionReviewItems = selectedEmployeeDeductionReviewItems
      .filter((item) => item.date === selectedDate)
      .sort((a, b) => a.kind.localeCompare(b.kind));
    const activeDeductionReviewItem =
      selectedDeductionReviewItems.find((item) => item.id === activeTimecardReviewItemId) ??
      selectedEmployeeDeductionReviewItems.find((item) => item.id === activeTimecardReviewItemId);
    const visibleDeductionReviewItems =
      activeDeductionReviewItem && activeDeductionReviewItem.date === selectedDate
        ? [activeDeductionReviewItem]
        : selectedDeductionReviewItems;
    const selectedEmployeeOtReviewRecords = selectedEmployee
      ? monthRecords
          .filter((record) => record.employee.id === selectedEmployee.id && record.overtimeMinutes > 0)
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const selectedEmployeeMonthReviewCount = selectedEmployeeDeductionReviewItems.length + selectedEmployeeOtReviewRecords.length;
    const employeeMonthReviewGroups: Array<{
      id: string;
      label: string;
      caption: string;
      items: DeductionReviewItem[];
      otRecords: AttendanceRecord[];
    }> = selectedEmployee
      ? [
          {
            id: "time",
            label: t("employeeMonthReviewGroupTime"),
            caption: t("employeeMonthReviewGroupTimeCaption"),
            items: selectedEmployeeDeductionReviewItems.filter((item) => item.kind === "late" || item.kind === "early" || item.kind === "shortHours"),
            otRecords: [],
          },
          {
            id: "absent",
            label: t("employeeMonthReviewGroupAbsent"),
            caption: t("employeeMonthReviewGroupAbsentCaption"),
            items: selectedEmployeeDeductionReviewItems.filter((item) => item.kind === "absent"),
            otRecords: [],
          },
          {
            id: "leave",
            label: t("employeeMonthReviewGroupLeave"),
            caption: t("employeeMonthReviewGroupLeaveCaption"),
            items: selectedEmployeeDeductionReviewItems.filter((item) => item.kind === "unpaidLeave"),
            otRecords: [],
          },
          {
            id: "missing",
            label: t("employeeMonthReviewGroupMissing"),
            caption: t("employeeMonthReviewGroupMissingCaption"),
            items: selectedEmployeeDeductionReviewItems.filter((item) => item.kind === "missingPunch"),
            otRecords: [],
          },
          {
            id: "ot",
            label: t("employeeMonthReviewGroupOt"),
            caption: t("employeeMonthReviewGroupOtCaption"),
            items: [],
            otRecords: selectedEmployeeOtReviewRecords,
          },
        ]
      : [];
    const workflowTabs: Array<{ id: TimecardWorkflowTab; label: string; hint: string; icon: LucideIcon; count?: number }> = [
      {
        id: "monthly",
        label: t("timecardWorkflowMonthly"),
        hint: t("timecardWorkflowMonthlyHint"),
        icon: ListFilter,
        count: selectedEmployeeMonthReviewCount,
      },
      {
        id: "deduction",
        label: t("timecardWorkflowDeduction"),
        hint: t("timecardWorkflowDeductionHint"),
        icon: Wallet,
        count: selectedDeductionReviewItems.length,
      },
      {
        id: "fix",
        label: t("timecardWorkflowFix"),
        hint: t("timecardWorkflowFixHint"),
        icon: Fingerprint,
      },
      {
        id: "audit",
        label: t("timecardWorkflowAudit"),
        hint: t("timecardWorkflowAuditHint"),
        icon: Database,
        count: selectedTimecardAudits.length,
      },
    ];
    const openMonthlyReviewItem = (item: DeductionReviewItem) => {
      setSelectedDate(item.date);
      setActiveTimecardReviewItemId(item.id);
      setTimecardWorkflowPrompt(null);
      setTimecardWorkflowTab(item.kind === "missingPunch" ? "fix" : "deduction");
    };
    const openOtReviewItem = (record: AttendanceRecord) => {
      setSelectedDate(record.date);
      setActiveTimecardReviewItemId(`ot-${record.employee.id}-${record.date}`);
      setTimecardWorkflowPrompt(null);
      setTimecardWorkflowTab("monthly");
    };
    const nextPromptItem =
      timecardWorkflowPrompt?.kind === "deductionSaved" && timecardWorkflowPrompt.nextItemId
        ? selectedEmployeeDeductionReviewItems.find((item) => item.id === timecardWorkflowPrompt.nextItemId)
        : undefined;
    const recentCorrections = correctionAudits
      .filter((audit) => audit.date.startsWith(selectedMonth))
      .map((audit) => ({ audit, employee: data.employees.find((item) => item.id === audit.employeeId) }))
      .filter((item): item is { audit: TimecardCorrectionAudit; employee: Employee } => Boolean(item.employee))
      .sort((a, b) => `${b.audit.changedAt}${b.audit.employeeId}`.localeCompare(`${a.audit.changedAt}${a.audit.employeeId}`))
      .slice(0, 6);

    if (!timecardDetailOpen) {
      const statCards: Array<{ id: TimecardStatusFilter; label: string; value: number; tone: "neutral" | "warn" | "bad" | "good"; icon: LucideIcon }> = [
        { id: "all", label: t("timecardsFilterAll"), value: pendingStats.all, tone: pendingStats.all > 0 ? "warn" : "good", icon: Wand2 },
        { id: "incomplete", label: t("timecardsFilterMissing"), value: pendingStats.incomplete, tone: pendingStats.incomplete > 0 ? "warn" : "good", icon: AlertTriangle },
        { id: "shortHours", label: t("timecardsFilterShortHours"), value: pendingStats.shortHours, tone: pendingStats.shortHours > 0 ? "warn" : "good", icon: Clock3 },
        { id: "lateEarly", label: t("timecardsFilterLateEarly"), value: pendingStats.lateEarly, tone: pendingStats.lateEarly > 0 ? "warn" : "good", icon: Clock3 },
        { id: "absent", label: t("timecardsFilterAbsent"), value: pendingStats.absent, tone: pendingStats.absent > 0 ? "bad" : "good", icon: WifiOff },
        { id: "unpaidLeave", label: t("timecardsFilterLeaveDeduction"), value: pendingStats.unpaidLeave, tone: pendingStats.unpaidLeave > 0 ? "bad" : "good", icon: CalendarDays },
      ];

      return (
        <div className="view-stack timecards-overview">
          <section className="overview-headline">
            <div>
              <p className="overview-headline-eyebrow">{selectedMonth}</p>
              <h2>{t("timecardsOverviewTitle")}</h2>
            </div>
            <Button
              icon={Plus}
              variant="secondary"
              onClick={() => {
                setTimecardWorkflowTab("fix");
                setTimecardDetailOpen(true);
              }}
            >
              {t("timecardsManualEntry")}
            </Button>
          </section>

          <div className="timecard-summary-grid">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  className={cx(
                    "timecard-summary-card",
                    `metric-${card.tone}`,
                    timecardStatusFilter === card.id && "timecard-summary-card-active",
                  )}
                  onClick={() => {
                    setTimecardStatusFilter(card.id);
                    setTimecardPage(1);
                  }}
                >
                  <span className="metric-icon"><Icon size={18} aria-hidden="true" /></span>
                  <span>
                    <strong>{card.value}</strong>
                    <small>{card.label}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <section className="panel reviewed-records-panel recent-corrections-panel">
            <SectionTitle
              title={t("recentCorrectionsTitle")}
              action={<span className="setting-list-count">{t("reviewedRecordsCount", { count: recentCorrections.length })}</span>}
            />
            <p className="panel-caption">{t("recentCorrectionsCaption")}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("colDate")}</th>
                    <th>{t("colEmployee")}</th>
                    <th>{t("timecardAuditAction")}</th>
                    <th>{t("colNotes")}</th>
                    <th>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCorrections.map(({ audit, employee }) => (
                    <tr key={audit.id}>
                      <td>{audit.date}</td>
                      <td>{employee.enrollNo} · {displayEmployeeName(employee)}</td>
                      <td><span className="mini-pill mini-pill-muted">{audit.action === "clear" ? t("timecardAuditActionClear") : t("timecardAuditActionSave")}</span></td>
                      <td>{displayCorrectionReason(audit.reason, lang)}</td>
                      <td>
                        <Button
                          icon={Wand2}
                          variant="secondary"
                          onClick={() => {
                            openTimecardDetail(employee.id, audit.date, "audit");
                          }}
                        >
                          {t("openDetail")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {recentCorrections.length === 0 ? (
                    <tr><td colSpan={5} className="empty-cell">{t("recentCorrectionsEmpty")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <SectionTitle
              title={t("timecardsPendingDatesTitle")}
              action={<span className="setting-list-count">{t("timecardsPendingDatesCount", { count: activeQueueTotal })}</span>}
            />
            <p className="panel-caption">{t("timecardsEmployeeQueueCaption")}</p>

            <div className="timecard-controls">
              <label className="timecard-search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">{t("timecardsSearchLabel")}</span>
                <input
                  value={timecardSearch}
                  onChange={(event) => {
                    setTimecardSearch(event.target.value);
                    setTimecardPage(1);
                  }}
                  placeholder={t("timecardsSearchPlaceholder")}
                />
              </label>
              <Field label={t("timecardsFilterLabel")} compact>
                <select
                  value={timecardStatusFilter}
                  onChange={(event) => {
                    setTimecardStatusFilter(event.target.value as TimecardStatusFilter);
                    setTimecardPage(1);
                  }}
                >
                  <option value="all">{t("timecardsFilterAll")}</option>
                  <option value="incomplete">{t("timecardsFilterMissing")}</option>
                  <option value="shortHours">{t("timecardsFilterShortHours")}</option>
                  <option value="lateEarly">{t("timecardsFilterLateEarly")}</option>
                  <option value="absent">{t("timecardsFilterAbsent")}</option>
                  <option value="unpaidLeave">{t("timecardsFilterLeaveDeduction")}</option>
                </select>
              </Field>
              <Field label={t("timecardsQueueViewLabel")} compact>
                <span className="pay-rule-toggle timecard-queue-mode" aria-label={t("timecardsQueueViewLabel")}>
                  <button
                    type="button"
                    className={cx(timecardQueueMode === "employee" && "pay-rule-active")}
                    onClick={() => {
                      setTimecardQueueMode("employee");
                      setTimecardPage(1);
                    }}
                  >
                    {t("timecardsQueueViewEmployee")}
                  </button>
                  <button
                    type="button"
                    className={cx(timecardQueueMode === "date" && "pay-rule-active")}
                    onClick={() => {
                      setTimecardQueueMode("date");
                      setTimecardPage(1);
                    }}
                  >
                    {t("timecardsQueueViewDate")}
                  </button>
                </span>
              </Field>
              <Field label={t("pageLimitLabel")} compact>
                <select
                  value={timecardPageSize}
                  onChange={(event) => {
                    setTimecardPageSize(Number(event.target.value));
                    setTimecardPage(1);
                  }}
                >
                  {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </Field>
            </div>

            {timecardQueueMode === "employee" ? (
              <div className="table-wrap">
                <table className="timecard-table timecard-employee-queue-table">
                  <thead>
                    <tr>
                      <th>{t("colEmployee")}</th>
                      <th>{t("colDepartment")}</th>
                      <th>{t("colShift")}</th>
                      <th>{t("timecardsQueueTotalItems")}</th>
                      <th>{t("timecardsQueueLateEarly")}</th>
                      <th>{t("timecardsQueueAbsent")}</th>
                      <th>{t("timecardsQueueLeaveDeduction")}</th>
                      <th>{t("timecardsQueueMissingPunch")}</th>
                      <th>{t("timecardsQueueOtReview")}</th>
                      <th>{t("colStatus")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageEmployeeRows.map((row) => {
                      const statusLabel =
                        row.status === "needsCorrection"
                          ? t("timecardsQueueStatusNeedsCorrection")
                          : row.status === "partial"
                            ? t("timecardsQueueStatusPartial")
                            : row.status === "completed"
                              ? t("timecardsQueueStatusCompleted")
                              : t("timecardsQueueStatusNotReviewed");
                      const statusClassName =
                        row.status === "needsCorrection"
                          ? "mini-pill-warn"
                          : row.status === "completed"
                            ? "mini-pill-good"
                            : "mini-pill-muted";
                      return (
                        <tr key={row.employee.id}>
                          <td>
                            <div className="timecard-employee-cell">
                              <strong>{row.employee.enrollNo}</strong>
                              <span>{displayEmployeeName(row.employee)}</span>
                            </div>
                          </td>
                          <td>{translateDataValue(row.employee.department, lang)}</td>
                          <td>{row.shift ? translateDataValue(row.shift.name, lang) : "-"}</td>
                          <td>
                            <strong className="timecard-queue-total">{row.totalReviewItems}</strong>
                            <small>{t("timecardsQueuePendingCount", { count: row.pendingReviewItems })}</small>
                          </td>
                          <td>{row.lateEarlyCount + row.shortHoursCount}</td>
                          <td>{row.absentCount}</td>
                          <td>{row.leaveDeductionCount}</td>
                          <td>{row.missingPunchCount}</td>
                          <td>{row.otReviewCount}</td>
                          <td><span className={cx("mini-pill", statusClassName)}>{statusLabel}</span></td>
                          <td className="timecard-action-cell">
                            <Button
                              icon={Wand2}
                              variant="secondary"
                              onClick={() => openEmployeeMonthReview(row.employee, row.reviewItems, row.otRecords)}
                            >
                              {t("employeeWarningsFix")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {pageEmployeeRows.length === 0 ? (
                      <tr><td colSpan={11} className="empty-cell">{t("timecardsNoFilteredResults")}</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : (
            <div className="table-wrap">
              <table className="timecard-table">
                <thead>
                  <tr>
                    <th>{t("colDate")}</th>
                    <th>{t("colEmployee")}</th>
                    <th>{t("colDepartment")}</th>
                    <th>{t("colShift")}</th>
                    <th>{t("colStatus")}</th>
                    <th>{t("colNotes")}</th>
                    <th>{t("timecardsReviewLocation")}</th>
                    <th>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((record) => (
                    <tr key={`${record.employee.id}-${record.date}`}>
                      <td>{record.date}</td>
                      <td>{record.employee.enrollNo} · {displayEmployeeName(record.employee)}</td>
                      <td>{translateDataValue(record.employee.department, lang)}</td>
                      <td>{record.shift ? translateDataValue(record.shift.name, lang) : "-"}</td>
                      <td><span className={statusClass(record.status)}>{statusLabels[lang][record.status]}</span></td>
                      <td>
                        <div className="timecard-issue-tags">
                          {reviewIssueLabelsForRecord(record).map((label) => <span key={label}>{label}</span>)}
                        </div>
                      </td>
                      <td><span className="review-route-pill">{reviewRouteLabelForRecord(record)}</span></td>
                      <td className="timecard-action-cell">
                        <Button
                          icon={Wand2}
                          variant="secondary"
                          onClick={() => {
                            const reviewItem = primaryReviewItemForRecord(record);
                            openTimecardDetail(record.employee.id, record.date, workflowTabForRecord(record), reviewItem?.id ?? null);
                          }}
                        >
                          {t("openDetail")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {pageRecords.length === 0 ? (
                    <tr><td colSpan={8} className="empty-cell">{t("timecardsNoFilteredResults")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            )}

            <div className="pagination-bar">
              <span>{t("paginationSummary", { start: resultStart, end: resultEnd, total: activeQueueTotal })}</span>
              <div className="pagination-actions">
                <Button
                  icon={ChevronLeft}
                  variant="ghost"
                  disabled={currentTimecardPage <= 1}
                  onClick={() => setTimecardPage(Math.max(1, currentTimecardPage - 1))}
                >
                  {t("previousPage")}
                </Button>
                <span className="page-count">{currentTimecardPage} / {totalPages}</span>
                <Button
                  icon={ChevronRight}
                  variant="ghost"
                  disabled={currentTimecardPage >= totalPages}
                  onClick={() => setTimecardPage(Math.min(totalPages, currentTimecardPage + 1))}
                >
                  {t("nextPage")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="view-stack timecard-detail">
        <section className="detail-back-row">
          <Button icon={ArrowLeft} variant="ghost" onClick={() => setTimecardDetailOpen(false)}>
            {t("backToOverview")}
          </Button>
          <h2 className="detail-back-title">
            {selectedEmployee ? `${selectedEmployee.enrollNo} · ${displayEmployeeName(selectedEmployee)} · ${selectedDate}` : t("timecardsTitle")}
          </h2>
        </section>

        <section className="panel timecards-simple timecard-context-panel">
          <SectionTitle title={t("timecardContextTitle")} />
          <p className="panel-caption">{t("timecardContextCaption")}</p>

          <div className="timecards-pick">
            <Field label={t("colEmployee")}>
              <select
                value={selectedEmployeeId}
                onChange={(event) => {
                  setSelectedEmployeeId(event.target.value);
                  setActiveTimecardReviewItemId(null);
                  setTimecardWorkflowPrompt(null);
                  setTimecardWorkflowTab("monthly");
                }}
              >
                {data.employees.filter((e) => e.active).map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("colDate")}>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setActiveTimecardReviewItemId(null);
                  setTimecardWorkflowPrompt(null);
                }}
              />
            </Field>
          </div>

          {selectedEmployee ? (
            <div className="day-controls">
              <Field label={t("dayShiftSelectLabel")} compact>
                <select
                  value={shiftOverride}
                  onChange={(event) => setShiftOverride(selectedEmployee.id, selectedDate, event.target.value || null)}
                >
                  <option value="">
                    {selectedEmployee.autoShift
                      ? t("autoShiftPlaceholder")
                      : `${t("defaultShiftPrefix")}${translateDataValue(data.shifts.find((shift) => shift.id === selectedEmployee.shiftId)?.name ?? "-", lang)}`}
                  </option>
                  {data.shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>{translateDataValue(shift.name, lang)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("dayRestSelectLabel")} compact>
                <select
                  value={currentRestValue}
                  onChange={(event) => {
                    const value = event.target.value;
                    setRestOverride(selectedEmployee.id, selectedDate, value === "" ? null : value === "rest");
                  }}
                >
                  <option value="">{t("restDefault")}</option>
                  <option value="rest">{t("restToRest")}</option>
                  <option value="work">{t("restToWork")}</option>
                </select>
              </Field>
            </div>
          ) : null}

          {selectedEmployee && selectedDateRecord ? (
            <div className="timecards-status">
              <span className={statusClass(selectedDateRecord.status)}>{statusLabels[lang][selectedDateRecord.status]}</span>
              {selectedDateRecord.flags.length && selectedDateRecord.flags[0].kind !== "ok" ? (
                <strong>{formatFlags(selectedDateRecord.flags, lang)}</strong>
              ) : null}
              {selectedDateRecord.shift ? (
                <span className="shift-pill" style={{ borderColor: selectedDateRecord.shift.color }}>
                  {translateDataValue(selectedDateRecord.shift.name, lang)}
                </span>
              ) : null}
              <span className={cx("source-tag", selectedDateRecord.shiftSource === "override" && "source-override", selectedDateRecord.shiftSource === "auto" && "source-auto")}>
                {selectedDateRecord.shiftSource === "override"
                  ? t("sourceManualShort")
                  : selectedDateRecord.shiftSource === "auto"
                    ? t("sourceAutoShort")
                    : t("sourceDefault")}
              </span>
              {selectedDateRecord.workMinutes > 0 ? (
                <span className="muted">{t("workHoursPrefix")} {formatHoursLabel(selectedDateRecord.workMinutes, lang)}</span>
              ) : null}
            </div>
          ) : null}

          <nav className="timecard-workflow-tabs" aria-label={t("timecardWorkflowTabsLabel")}>
            {workflowTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cx("timecard-workflow-tab", timecardWorkflowTab === tab.id && "timecard-workflow-tab-active")}
                  onClick={() => setTimecardWorkflowTab(tab.id)}
                >
                  <Icon size={17} />
                  <span>
                    <strong>{tab.label}</strong>
                    <small>{tab.hint}</small>
                  </span>
                  {tab.count !== undefined ? <em>{tab.count}</em> : null}
                </button>
              );
            })}
          </nav>

          {timecardWorkflowPrompt ? (
            <section className={cx("timecard-workflow-prompt", timecardWorkflowPrompt.kind === "deductionSaved" && "timecard-workflow-prompt-saved")}>
              <div>
                <strong>
                  {timecardWorkflowPrompt.kind === "deductionSaved"
                    ? t("timecardGuidanceDecisionSavedTitle")
                    : timecardWorkflowPrompt.kind === "fixSaved"
                      ? t("timecardGuidanceFixSavedTitle")
                      : t("timecardGuidanceFixClearedTitle")}
                </strong>
                <span>
                  {timecardWorkflowPrompt.kind === "deductionSaved"
                    ? timecardWorkflowPrompt.needsFix
                      ? t("timecardGuidanceDecisionSavedNeedsFix")
                      : timecardWorkflowPrompt.nextItemId
                        ? t("timecardGuidanceDecisionSavedNext")
                        : t("timecardGuidanceDecisionSavedDone")
                    : timecardWorkflowPrompt.kind === "fixSaved"
                      ? timecardWorkflowPrompt.stillPending
                        ? t("timecardGuidanceFixSavedStillPending")
                        : t("timecardGuidanceFixSavedResolved")
                      : t("timecardGuidanceFixCleared")}
                </span>
              </div>
              <div className="timecard-workflow-prompt-actions">
                {timecardWorkflowPrompt.kind === "deductionSaved" && timecardWorkflowPrompt.needsFix ? (
                  <Button icon={Fingerprint} variant="secondary" onClick={() => setTimecardWorkflowTab("fix")}>
                    {t("timecardGuidanceGoFix")}
                  </Button>
                ) : null}
                {nextPromptItem ? (
                  <Button icon={Wand2} variant="secondary" onClick={() => openMonthlyReviewItem(nextPromptItem)}>
                    {t("timecardGuidanceReviewNext")}
                  </Button>
                ) : null}
                {timecardWorkflowPrompt.kind === "fixSaved" && timecardWorkflowPrompt.stillPending && selectedDeductionReviewItems.length > 0 ? (
                  <Button icon={Wallet} variant="secondary" onClick={() => setTimecardWorkflowTab("deduction")}>
                    {t("timecardGuidanceReviewUpdatedDeduction")}
                  </Button>
                ) : null}
                <Button icon={ListFilter} variant="ghost" onClick={() => setTimecardWorkflowTab("monthly")}>
                  {t("timecardGuidanceBackMonthly")}
                </Button>
              </div>
            </section>
          ) : null}

          <div className="timecard-workflow-body">
          {timecardWorkflowTab === "monthly" && selectedEmployee ? (
            <section className="employee-month-review-panel" aria-label={t("employeeMonthReviewTitle", { employee: displayEmployeeName(selectedEmployee) })}>
              <div className="employee-month-review-head">
                <div>
                  <span className="panel-eyebrow">{selectedMonth} · {selectedEmployee.enrollNo}</span>
                  <h3>{t("employeeMonthReviewTitle", { employee: displayEmployeeName(selectedEmployee) })}</h3>
                  <p>{t("employeeMonthReviewCaption")}</p>
                </div>
                <strong>{t("employeeMonthReviewCount", { count: selectedEmployeeMonthReviewCount })}</strong>
              </div>

              {selectedEmployeeMonthReviewCount > 0 ? (
                <div className="employee-month-review-groups">
                  {employeeMonthReviewGroups.map((group) => {
                    const groupCount = group.items.length + group.otRecords.length;
                    return (
                      <section key={group.id} className="employee-month-review-group">
                        <header className="employee-month-review-group-head">
                          <div>
                            <strong>{group.label}</strong>
                            <span>{group.caption}</span>
                          </div>
                          <em>{groupCount}</em>
                        </header>

                        {groupCount > 0 ? (
                          <div className="table-wrap employee-month-review-table-wrap">
                            <table className="employee-month-review-table">
                              <thead>
                                <tr>
                                  <th>{t("colDate")}</th>
                                  <th>{t("employeeMonthReviewColIssue")}</th>
                                  <th>{t("employeeMonthReviewColDuration")}</th>
                                  <th>{t("employeeMonthReviewColRuleSource")}</th>
                                  <th>{t("colStatus")}</th>
                                  <th>{t("employeeMonthReviewColDecision")}</th>
                                  <th>{t("employeeMonthReviewColImpact")}</th>
                                  <th>{t("actions")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((item) => {
                                  const pendingDraft = hasPendingDeductionDraft(item);
                                  const decision = deductionDecisionValue(item);
                                  const statusLabel = pendingDraft
                                    ? t("deductionDraftPending")
                                    : item.decision
                                      ? deductionDecisionLabel(item.decision)
                                      : t("deductionAuditPending");
                                  const currency = item.employee.salary.currency || "MYR";
                                  const finalImpact = decision || pendingDraft
                                    ? `${currency} ${deductionFinalAmountValue(item).toFixed(2)}`
                                    : "-";
                                  const isActive = item.id === activeTimecardReviewItemId || (!activeTimecardReviewItemId && item.date === selectedDate);
                                  return (
                                    <tr key={item.id} className={cx(isActive && "employee-month-review-row-active")}>
                                      <td>{item.date}</td>
                                      <td>{deductionIssueLabel(item.kind)}</td>
                                      <td>{deductionDurationLabel(item)}</td>
                                      <td className="employee-month-review-source">{deductionRuleResolution(item).message}</td>
                                      <td><span className={cx("mini-pill", pendingDraft ? "mini-pill-muted" : decisionPillClass(item.decision))}>{statusLabel}</span></td>
                                      <td>{decision ? deductionDecisionLabel(decision) : "-"}</td>
                                      <td>{finalImpact}</td>
                                      <td>
                                        <Button
                                          icon={Wand2}
                                          variant="secondary"
                                          onClick={() => openMonthlyReviewItem(item)}
                                        >
                                          {isActive ? t("employeeMonthReviewCurrentItem") : t("employeeWarningsFix")}
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {group.otRecords.map((record) => {
                                  const isActive = activeTimecardReviewItemId === `ot-${record.employee.id}-${record.date}` || (!activeTimecardReviewItemId && record.date === selectedDate);
                                  return (
                                    <tr key={`${record.employee.id}-${record.date}-ot`} className={cx(isActive && "employee-month-review-row-active")}>
                                      <td>{record.date}</td>
                                      <td>{t("payrollOtWarnings")}</td>
                                      <td>{formatHoursLabel(record.overtimeMinutes, lang)}</td>
                                      <td className="employee-month-review-source">{t("employeeMonthReviewOtSource")}</td>
                                      <td><span className="mini-pill mini-pill-muted">{t("reviewRoutePayrollReview")}</span></td>
                                      <td>-</td>
                                      <td>{t("employeeMonthReviewOtImpact", { hours: formatHoursLabel(record.overtimeMinutes, lang) })}</td>
                                      <td>
                                        <Button
                                          icon={Wand2}
                                          variant="secondary"
                                          onClick={() => openOtReviewItem(record)}
                                        >
                                          {isActive ? t("employeeMonthReviewCurrentItem") : t("employeeWarningsFix")}
                                        </Button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="employee-month-review-empty">{t("employeeMonthReviewGroupEmpty")}</p>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <p className="employee-month-review-empty">{t("employeeMonthReviewEmpty")}</p>
              )}
            </section>
          ) : null}

          {timecardWorkflowTab === "deduction" ? (
            visibleDeductionReviewItems.length > 0 ? (
            <section className="timecard-deduction-panel">
              <SectionTitle title={t("timecardsDeductionApprovalTitle")} />
              <details className="deduction-settings-source">
                <summary>{t("deductionSettingsSourceTitle")}</summary>
                <span>{t("timecardsDeductionApprovalCaption")}</span>
                <span>{t("deductionSettingsSourceBody")}</span>
              </details>
              <div className="timecard-deduction-list">
                {visibleDeductionReviewItems.map((item) => {
                  const currentAmountMode = deductionAmountModeValue(item);
                  const currentDecision = deductionDecisionValue(item);
                  const pendingDraft = hasPendingDeductionDraft(item);
                  const ruleResolution = deductionRuleResolution(item);
                  const selectedDeductionOption = deductionPresetOptionValue(item);
                  const currency = item.employee.salary.currency || "MYR";
                  const isHourlyEmployee = item.employee.salary.type === "hourly";
                  const isHourlyAutoNoDeduct = isHourlyEmployee && (item.kind === "absent" || item.kind === "unpaidLeave");
                  const isHourlyWorkedTimeIssue = isHourlyEmployee && (item.kind === "late" || item.kind === "early" || item.kind === "shortHours");
                  const canUseRuleDeduction = ruleResolution.available;
                  const hourlyAutoNeedsSave = isHourlyAutoNoDeduct && item.decision !== "accepted";
                  const presetOptionMissing = currentDecision === "deducted" && currentAmountMode === "settingsOption" && !selectedDeductionOption;
                  const ruleAmountMissing = currentDecision === "deducted" && currentAmountMode === "rules" && !ruleResolution.available;
                  const currentPayrollImpact = isHourlyAutoNoDeduct
                    ? 0
                    : item.decision && !pendingDraft
                    ? deductionFinalAmountValue(item)
                    : currentDecision === "deducted" && currentAmountMode === "rules"
                    ? ruleResolution.available ? ruleResolution.amount : 0
                    : currentDecision
                      ? deductionFinalAmountValue(item)
                      : 0;
                  const isAbsentApproval = item.kind === "absent";
                  const isLeaveApproval = item.kind === "unpaidLeave";
                  const leaveRecord = item.record.leave;
                  const leaveMcStatus = resolvedLeaveMcStatus(leaveRecord, data);
                  const leaveApprovalStatus = resolvedLeaveApprovalStatus(leaveRecord);
                  const leaveRequiresMc = leaveRecord ? isMcRequiredLeaveType(leaveRecord.type, data) : false;
                  const decisionRemarkRequired =
                    !isHourlyAutoNoDeduct &&
                    (currentDecision === "accepted" || currentDecision === "pending") &&
                    !deductionRemarkValue(item).trim();
                  const saveDisabled = isHourlyAutoNoDeduct
                    ? !hourlyAutoNeedsSave && !pendingDraft
                    : !currentDecision || !pendingDraft || decisionRemarkRequired || presetOptionMissing || ruleAmountMissing;
                  const statusPillClass = pendingDraft
                    ? "mini-pill-muted"
                    : item.decision
                      ? decisionPillClass(item.decision)
                      : "mini-pill-muted";
                  const statusLabel = pendingDraft
                    ? t("deductionDraftPending")
                    : item.decision
                      ? deductionDecisionLabel(item.decision)
                      : t("deductionAuditPending");
                  const settingsOptionSourceMessage = selectedDeductionOption
                    ? t("deductionSettingsOptionSource", {
                        option: translateDataValue(selectedDeductionOption.label, lang),
                        amount: `${currency} ${selectedDeductionOption.amount.toFixed(2)}`,
                      })
                    : t("deductionSettingsOptionRequiredHint");
                  const decisionSourceMessage =
                    isHourlyAutoNoDeduct
                      ? ruleResolution.message
                      : currentDecision === "accepted"
                        ? t("deductionNoDeductSource")
                        : currentDecision === "pending"
                          ? t("deductionPendingSource")
                        : currentDecision === "deducted" && currentAmountMode === "settingsOption"
                          ? settingsOptionSourceMessage
                          : currentDecision === "deducted" && currentAmountMode === "rules"
                            ? ruleResolution.message
                            : t("deductionDecisionSourcePending");
                  return (
                    <article key={item.id} className={cx("timecard-deduction-card", isAbsentApproval && "timecard-deduction-card-absent")}>
                      <div className="timecard-deduction-workflow">
                        <section className="timecard-deduction-step timecard-deduction-step-summary">
                          <div className="deduction-step-heading">
                            <span>{t("deductionStepIssueSummary")}</span>
                            <em className={cx("mini-pill", statusPillClass)}>{statusLabel}</em>
                          </div>
                          <div className="deduction-issue-hero">
                            <span className="mini-pill mini-pill-muted">{deductionIssueLabel(item.kind)}</span>
                            <strong>{deductionDurationLabel(item)}</strong>
                          </div>
                          <dl className="deduction-issue-facts">
                            <div>
                              <dt>{t("deductionIssueTypeLabel")}</dt>
                              <dd>{deductionReviewRouteLabel(item.kind)}</dd>
                            </div>
                            <div>
                              <dt>{t("deductionDurationLabelText")}</dt>
                              <dd>{deductionDurationLabel(item)}</dd>
                            </div>
                            <div>
                              <dt>{t("deductionThisMonthLabel")}</dt>
                              <dd>{item.occurrenceCount}</dd>
                            </div>
                            <div>
                              <dt>{t("deductionDetectedByLabel")}</dt>
                              <dd>{t("deductionDetectedByRules")}</dd>
                            </div>
                          </dl>
                          <span className="deduction-source-line">{deductionSettingsSourceLabel(item)}</span>
                          {item.relatedCorrectionReason ? (
                            <span className="deduction-source-line">
                              {t("deductionSavedCorrectionReason", { reason: translateDataValue(item.relatedCorrectionReason, lang) })}
                            </span>
                          ) : null}
                          {isLeaveApproval && leaveRecord ? (
                            <dl className="deduction-issue-facts deduction-leave-facts">
                              <div>
                                <dt>{t("deductionLeaveTypeLabel")}</dt>
                                <dd>{translateDataValue(leaveRecord.type, lang)}</dd>
                              </div>
                              <div>
                                <dt>{t("deductionLeaveDateLabel")}</dt>
                                <dd>{leaveRecord.date}</dd>
                              </div>
                              <div>
                                <dt>{t("deductionLeaveHoursLabel")}</dt>
                                <dd>{formatDecimalHours(leaveRecord.hours, lang)}</dd>
                              </div>
                              <div>
                                <dt>{t("deductionLeaveMcStatusLabel")}</dt>
                                <dd>{leaveMcStatusLabel(leaveMcStatus)}</dd>
                              </div>
                              <div>
                                <dt>{t("leaveMcAttachmentLabel")}</dt>
                                <dd>
                                  {leaveRecord.mcAttachment ? (
                                    <span className="deduction-attachment-link">
                                      <a href={leaveRecord.mcAttachment.dataUrl} target="_blank" rel="noreferrer">
                                        {t("leaveMcAttachmentView")}
                                      </a>
                                      <small>{leaveRecord.mcAttachment.name}</small>
                                    </span>
                                  ) : t("leaveMcAttachmentMissing")}
                                </dd>
                              </div>
                              <div>
                                <dt>{t("deductionLeaveApprovalStatusLabel")}</dt>
                                <dd>{leaveApprovalStatusLabel(leaveApprovalStatus)}</dd>
                              </div>
                              <div>
                                <dt>{t("deductionLeaveSettingsLabel")}</dt>
                                <dd>
                                  {t(item.leavePayRule === "paid" ? "deductionLeaveTypePaid" : "deductionLeaveTypeDeduct")}
                                  {" · "}
                                  {t(leaveRequiresMc ? "deductionLeaveMcRequired" : "deductionLeaveMcNotRequired")}
                                </dd>
                              </div>
                            </dl>
                          ) : null}
                          <details className="timecard-deduction-details">
                            <summary>{t("deductionOccurrenceDetails")}</summary>
                            <ul>
                              {item.occurrenceDetails.map((occurrence) => (
                                <li key={`${item.id}-${occurrence.date}`}>
                                  <span>{occurrence.date}</span>
                                  <strong>{deductionOccurrenceDetailLabel(occurrence)}</strong>
                                  {occurrence.decision ? (
                                    <em className={cx("mini-pill", decisionPillClass(occurrence.decision))}>
                                      {deductionDecisionLabel(occurrence.decision)}
                                    </em>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </section>

                        <section className="timecard-deduction-step timecard-deduction-step-decision">
                          <div className="deduction-step-heading">
                            <span>{t("deductionStepDecision")}</span>
                          </div>
                          {isHourlyAutoNoDeduct ? (
                            <>
                              <div className="deduction-hourly-note">
                                <strong>{t("deductionHourlyNoSeparateDeductTitle")}</strong>
                                <span>{t("deductionHourlyNoSeparateDeductBody")}</span>
                              </div>
                              <span className="pay-rule-toggle deduction-decision-toggle deduction-decision-toggle-two" aria-label={t("deductionHrDecision")}>
                                <button type="button" disabled>
                                  {t("deductionDecisionRuleAmount")}
                                </button>
                                <button
                                  type="button"
                                  className={cx(currentDecision === "accepted" && "pay-rule-active deduction-decision-active-accept")}
                                  onClick={() => setDeductionReviewDecision(item, "accepted")}
                                >
                                  {t("deductionDecisionNoDeduct")}
                                </button>
                              </span>
                              <div className="deduction-rule-note deduction-rule-note-warning">
                                <span>{ruleResolution.message}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              {isHourlyWorkedTimeIssue ? (
                                <div className="deduction-hourly-note">
                                  <strong>{t("deductionHourlyWorkedHoursTitle")}</strong>
                                  <span>{t("deductionHourlyWorkedHoursBody")}</span>
                                </div>
                              ) : null}
                              <span
                                className="pay-rule-toggle deduction-decision-toggle"
                                aria-label={t("deductionHrDecision")}
                              >
                                <button
                                  type="button"
                                  disabled={!canUseRuleDeduction}
                                  className={cx(currentDecision === "deducted" && currentAmountMode === "rules" && "pay-rule-active deduction-decision-active-deduct")}
                                  onClick={() => {
                                    if (canUseRuleDeduction) setDeductionReviewAmountMode(item, "rules");
                                  }}
                                >
                                  {t("deductionDecisionRuleAmount")}
                                </button>
                                <button
                                  type="button"
                                  className={cx(currentDecision === "accepted" && "pay-rule-active deduction-decision-active-accept")}
                                  onClick={() => setDeductionReviewDecision(item, "accepted")}
                                >
                                  {t("deductionDecisionNoDeduct")}
                                </button>
                                <button
                                  type="button"
                                  className={cx(currentDecision === "deducted" && currentAmountMode === "settingsOption" && "pay-rule-active deduction-decision-active-deduct")}
                                  onClick={() => setDeductionReviewPresetOption(item, deductionPresetOptionIdValue(item))}
                                >
                                  {t("deductionDecisionSettingsOption")}
                                </button>
                                {isLeaveApproval ? (
                                  <button
                                    type="button"
                                    className={cx(currentDecision === "pending" && "pay-rule-active")}
                                    onClick={() => setDeductionReviewDecision(item, "pending")}
                                  >
                                    {t("deductionDecisionPendingCorrection")}
                                  </button>
                                ) : null}
                              </span>
                              <div
                                className={cx(
                                  "deduction-rule-note",
                                  currentDecision === "deducted" && currentAmountMode === "settingsOption"
                                    ? selectedDeductionOption
                                      ? "deduction-rule-note-ok"
                                      : "deduction-rule-note-warning"
                                    : canUseRuleDeduction
                                      ? "deduction-rule-note-ok"
                                      : "deduction-rule-note-warning",
                                )}
                              >
                                <span>
                                  {currentDecision === "deducted" && currentAmountMode === "settingsOption"
                                    ? settingsOptionSourceMessage
                                    : ruleResolution.message}
                                </span>
                              </div>
                            </>
                          )}
                          {!isHourlyAutoNoDeduct && currentDecision === "deducted" && currentAmountMode === "settingsOption" ? (
                            <label className="timecard-deduction-field timecard-deduction-preset-option">
                              <span>{t("deductionPresetOptionLabel")}</span>
                              <select
                                className="deduction-reason-select"
                                value={deductionPresetOptionIdValue(item)}
                                onChange={(event) => setDeductionReviewPresetOption(item, event.target.value)}
                              >
                                <option value="">{t("deductionPresetOptionPlaceholder")}</option>
                                {data.settings.deductionAmountOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {translateDataValue(option.label, lang)} · {item.employee.salary.currency || "MYR"} {option.amount.toFixed(2)}
                                  </option>
                                ))}
                              </select>
                              {presetOptionMissing ? <small>{t("deductionPresetOptionRequired")}</small> : null}
                            </label>
                          ) : null}
                        </section>

                        <section className="timecard-deduction-step timecard-deduction-step-reason">
                          <div className="deduction-step-heading">
                            <span>{t("deductionStepReason")}</span>
                          </div>
                          <label className="timecard-deduction-field">
                            <span>{t("deductionReasonPresetLabel")}</span>
                            <select
                              className="deduction-reason-select"
                              value={deductionReasonSelectValue(item)}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDeductionRemarkDrafts((current) => ({
                                  ...current,
                                  [item.id]: value === "__custom__" ? "" : value,
                                }));
                              }}
                            >
                              <option value="">{t("deductionReasonSelectPlaceholder")}</option>
                              {data.settings.deductionReasons.map((reason) => (
                                <option key={reason} value={reason}>{translateDataValue(reason, lang)}</option>
                              ))}
                              <option value="__custom__">{t("deductionReasonCustomOption")}</option>
                            </select>
                          </label>
                          <label className="timecard-deduction-field">
                            <span>{t("deductionExtraRemarkLabel")}</span>
                            <input
                              className="deduction-remark-input"
                              value={deductionRemarkValue(item)}
                              onChange={(event) =>
                                setDeductionRemarkDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                              }
                              placeholder={currentDecision === "accepted" ? t("deductionRemarkPlaceholder") : t("deductionRemarkOptionalPlaceholder")}
                            />
                          </label>
                          <small>{t("deductionReasonSourceHint")}</small>
                          {decisionRemarkRequired ? <small>{t("deductionDecisionRemarkRequired")}</small> : null}
                        </section>

                        <section className="timecard-deduction-step timecard-deduction-step-save">
                          <div className="deduction-step-heading">
                            <span>{t("deductionStepFinal")}</span>
                          </div>
                          <div className="deduction-final-card">
                            <span>{pendingDraft || !item.decision ? t("deductionPreviewAmount") : t("deductionSavedFinalAmount")}</span>
                            <strong>{currency} {currentPayrollImpact.toFixed(2)}</strong>
                            <small>{decisionSourceMessage}</small>
                          </div>
                          {item.decision && !pendingDraft ? (
                            <small>{item.reviewedBy || t("timecardAuditActorHr")} · {auditChangedAt(item.updatedAt, lang)}</small>
                          ) : null}
                          <Button
                            icon={Save}
                            variant="secondary"
                            disabled={saveDisabled}
                            onClick={() => {
                              if (isHourlyAutoNoDeduct) {
                                saveDeductionReview(
                                  item,
                                  "none",
                                  deductionRemarkValue(item) || t("deductionHourlyNoSeparateDeductAudit"),
                                );
                                return;
                              }
                              if (isAbsentApproval) {
                                saveAbsentReview(item);
                                return;
                              }
                              if (currentDecision === "pending") {
                                savePendingReview(item);
                                return;
                              }
                              if (currentDecision === "accepted") {
                                saveDeductionReview(item, "none");
                                return;
                              }
                              if (currentDecision === "deducted" && currentAmountMode === "settingsOption") {
                                if (selectedDeductionOption) saveDeductionReview(item, "settingsOption", deductionRemarkValue(item), selectedDeductionOption);
                                return;
                              }
                              if (currentDecision === "deducted") saveDeductionReview(item, "rules");
                            }}
                          >
                            {t("deductionSaveDecision")}
                          </Button>
                        </section>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            ) : (
              <section className="timecard-empty-workflow">
                <SectionTitle title={t("timecardsDeductionApprovalTitle")} />
                <p>{t("timecardWorkflowNoDeductionItems")}</p>
              </section>
            )
          ) : null}

          {timecardWorkflowTab === "fix" ? (
          <section className="timecard-fix-panel">
            <SectionTitle title={t("timecardsTitle")} />
            <p className="panel-caption">{t("timecardsCaptionSimple")}</p>
          <div className="timecards-punches">
            {(["in", "breakOut", "breakIn", "out"] as PunchKind[]).map((kind) => (
              <Field key={kind} label={punchKindLabels[lang][kind]}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="HH:MM"
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  maxLength={5}
                  value={punchTimes[kind]}
                  onChange={(event) => setPunchTimes((current) => ({ ...current, [kind]: event.target.value }))}
                />
              </Field>
            ))}
          </div>

          <div className="timecard-reason-grid">
            <Field label={t("timecardReasonLabel")} required error={punchNoteError}>
              <select
                value={correctionReason}
                onChange={(event) => {
                  setCorrectionReason(event.target.value);
                  if (punchNoteError) setPunchNoteError("");
                }}
              >
                <option value="">{t("timecardReasonSelectPlaceholder")}</option>
                {data.settings.correctionReasons.map((reason) => (
                  <option key={reason} value={reason}>{translateDataValue(reason, lang)}</option>
                ))}
              </select>
              <small className="field-source-note">{t("timecardCorrectionReasonSource")}</small>
            </Field>
            <Field label={t("timecardReasonDetailLabel")}>
              <input
                value={punchNote}
                onChange={(event) => setPunchNote(event.target.value)}
                placeholder={t("notePlaceholder")}
              />
            </Field>
          </div>

          <div className="timecards-actions">
            <Button icon={Save} onClick={savePunchesForDate}>{t("save")}</Button>
            <Button icon={Trash2} variant="ghost" onClick={clearPunchesForDate}>{t("clear")}</Button>
          </div>
          </section>
          ) : null}

          {timecardWorkflowTab === "audit" ? (
          <section className="timecard-audit-panel">
            <SectionTitle title={t("timecardAuditTitle")} />
            <p className="panel-caption">{t("timecardAuditCaption")}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("timecardAuditWhen")}</th>
                    <th>{t("timecardAuditWho")}</th>
                    <th>{t("timecardAuditAction")}</th>
                    <th>{t("timecardAuditBefore")}</th>
                    <th>{t("timecardAuditAfter")}</th>
                    <th>{t("timecardAuditReason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTimecardAudits.map((audit) => (
                    <tr key={audit.id}>
                      <td>{auditChangedAt(audit.changedAt, lang)}</td>
                      <td>{audit.actor}</td>
                      <td>{audit.action === "clear" ? t("timecardAuditActionClear") : t("timecardAuditActionSave")}</td>
                      <td>{auditPunchSummary(audit.beforePunches, lang)}</td>
                      <td>{auditPunchSummary(audit.afterPunches, lang)}</td>
                      <td>{displayCorrectionReason(audit.reason, lang)}</td>
                    </tr>
                  ))}
                  {selectedTimecardAudits.length === 0 ? (
                    <tr><td colSpan={6} className="empty-cell">{t("timecardAuditEmpty")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}
            </div>
          </section>
      </div>
    );
  }

  function renderLeave() {
    const leaveDraftRequiresMc = isMcRequiredLeaveType(leaveDraft.type, data);
    const otEmployee = data.employees.find((employee) => employee.id === otSimEmployeeId) ?? activeEmployees[0];
    const otBaseRecord = otEmployee ? calculateAttendance(data, otEmployee, otSimDate) : undefined;
    const otSimRecord = (() => {
      if (!otEmployee || !otBaseRecord?.shift || !otBaseRecord.schedule) return undefined;
      const existingPunches = data.punches.filter((punch) => punch.employeeId === otEmployee.id && punch.date === otSimDate);
      const byKind = (kind: PunchKind) => existingPunches.find((punch) => punch.kind === kind)?.time ?? "";
      const schedule = otBaseRecord.schedule;
      const simPunches: Punch[] = ([
        ["in", byKind("in") || schedule.start],
        ["breakOut", byKind("breakOut") || schedule.lunchStart],
        ["breakIn", byKind("breakIn") || schedule.lunchEnd],
        ["out", otSimClockOut],
      ] as Array<[PunchKind, string]>)
        .filter(([, time]) => Boolean(time))
        .map(([kind, time]) => ({
          id: `sim-${otEmployee.id}-${otSimDate}-${kind}`,
          employeeId: otEmployee.id,
          date: otSimDate,
          time,
          kind,
          source: "manual",
          note: "simulation",
        }));
      const simData: AppData = {
        ...data,
        punches: [
          ...data.punches.filter((punch) => !(punch.employeeId === otEmployee.id && punch.date === otSimDate)),
          ...simPunches,
        ],
      };
      return calculateAttendance(simData, otEmployee, otSimDate);
    })();
    const otPay = otSimRecord && otEmployee
      ? (otSimRecord.overtimeMinutes / 60) * otEmployee.salary.hourlyRate * otEmployee.salary.otMultiplier
      : 0;
    const leaveDraftMayDeduct = !isPaidLeaveType(leaveDraft.type, data);
    const editingLeaveRequiresMc = editingLeaveDraft ? isMcRequiredLeaveType(editingLeaveDraft.type, data) : false;
    const recentLeaveAudits = [...(data.leaveAuditTrail ?? [])]
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
      .slice(0, 8);

    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle title={t("leaveInputTitle")} />
          <p className="panel-caption">{t("leaveInputSimpleHint")}</p>
          <div className="leave-entry-compact">
            <div className="leave-entry-row leave-entry-row-primary">
              <Field label={t("colEmployee")}>
                <select value={leaveDraft.employeeId} onChange={(event) => setLeaveDraft({ ...leaveDraft, employeeId: event.target.value })}>
                  {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>)}
                </select>
              </Field>
              <Field label={t("colDate")}>
                <input type="date" value={leaveDraft.date} onChange={(event) => setLeaveDraft({ ...leaveDraft, date: event.target.value })} />
              </Field>
            </div>
            <div className="leave-entry-row leave-entry-row-secondary">
              <Field label={t("leaveTypeLabel")}>
                <select
                  value={leaveDraft.type}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    const nextRequiresMc = isMcRequiredLeaveType(nextType, data);
                    setLeaveDraft({
                      ...leaveDraft,
                      type: nextType,
                      mcStatus: nextRequiresMc ? "pending" : "notRequired",
                      mcAttachment: nextRequiresMc ? leaveDraft.mcAttachment : undefined,
                    });
                  }}
                >
                  {data.settings.leaveTypes.map((type) => <option key={type} value={type}>{translateDataValue(type, lang)}</option>)}
                </select>
              </Field>
              <Field label={t("leaveHoursLabel")}>
                <input type="number" min="0" step="0.5" value={leaveDraft.hours} onChange={(event) => setLeaveDraft({ ...leaveDraft, hours: Number(event.target.value) })} />
              </Field>
              <Field label={t("leaveApprovalStatusLabel")}>
                <select value={leaveDraft.approvalStatus} onChange={(event) => setLeaveDraft({ ...leaveDraft, approvalStatus: event.target.value as NonNullable<LeaveEntry["approvalStatus"]> })}>
                  <option value="approved">{t("leaveApprovalApproved")}</option>
                  <option value="pending">{t("leaveApprovalPending")}</option>
                  <option value="rejected">{t("leaveApprovalRejected")}</option>
                </select>
              </Field>
            </div>
            {leaveDraftRequiresMc ? (
              <section className="leave-mc-panel">
                <div className="leave-mc-panel-head">
                  <strong>{t("leaveMcSupportTitle")}</strong>
                  <span>{t("leaveMcSupportHint")}</span>
                </div>
                <div className="leave-entry-row leave-entry-row-mc">
                  <Field label={t("leaveMcStatusLabel")}>
                    <select value={leaveDraft.mcStatus} onChange={(event) => setLeaveDraft({ ...leaveDraft, mcStatus: event.target.value as NonNullable<LeaveEntry["mcStatus"]> })}>
                      <option value="provided">{t("leaveMcProvided")}</option>
                      <option value="notProvided">{t("leaveMcNotProvided")}</option>
                      <option value="pending">{t("leaveMcPending")}</option>
                      <option value="notRequired">{t("leaveMcNotRequired")}</option>
                    </select>
                  </Field>
                  <Field label={t("leaveMcAttachmentLabel")}>
                    <div className="mc-attachment-field">
                      <label className="button button-secondary mc-upload-button">
                        <Upload size={16} aria-hidden="true" />
                        <span>{leaveDraft.mcAttachment ? t("leaveMcAttachmentChange") : t("leaveMcAttachmentUpload")}</span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                          onChange={(event) => {
                            void handleLeaveDraftMcAttachment(event.currentTarget.files?.[0]);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      {leaveDraft.mcAttachment ? (
                        <span className="mc-attachment-chip">
                          <a href={leaveDraft.mcAttachment.dataUrl} target="_blank" rel="noreferrer">{leaveDraft.mcAttachment.name}</a>
                          <small>{formatFileSize(leaveDraft.mcAttachment.size)}</small>
                          <button type="button" className="link-button" onClick={() => setLeaveDraft((current) => ({ ...current, mcAttachment: undefined }))}>
                            {t("remove")}
                          </button>
                        </span>
                      ) : (
                        <small>{leaveDraft.mcStatus === "provided" ? t("leaveMcAttachmentRequired") : t("leaveMcAttachmentHint")}</small>
                      )}
                    </div>
                  </Field>
                </div>
              </section>
            ) : null}
            {leaveDraftMayDeduct ? (
              <div className="leave-deduct-warning" role="note">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>{t("leaveDeductibleWarning")}</span>
              </div>
            ) : null}
            <div className="leave-entry-row leave-entry-row-actions">
              <Field label={t("colNote")}>
                <input value={leaveDraft.note} onChange={(event) => setLeaveDraft({ ...leaveDraft, note: event.target.value })} placeholder={t("leaveNotePlaceholder")} />
              </Field>
              <Button icon={Plus} className="leave-entry-add-button" onClick={addLeave}>{t("addLeaveRecord")}</Button>
            </div>
          </div>
        </section>

        <section className="panel">
          <SectionTitle title={t("leaveRecordsTitle")} />
          <div className="table-wrap">
            <table className="leave-records-table">
              <thead>
                <tr>
                  <th>{t("colDate")}</th>
                  <th>{t("colEmployee")}</th>
                  <th>{t("rcLeaveType")}</th>
                  <th>{t("colLeaveHours")}</th>
                  <th>{t("leaveMcStatusLabel")}</th>
                  <th>{t("leaveMcAttachmentLabel")}</th>
                  <th>{t("leaveApprovalStatusLabel")}</th>
                  <th>{t("colNote")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.leaves.map((leave) => {
                  const employee = data.employees.find((item) => item.id === leave.employeeId);
                  return (
                    <tr key={leave.id}>
                      <td className="leave-date-cell">{leave.date}</td>
                      <td className="leave-employee-cell">{employee ? displayEmployeeName(employee) : "-"}</td>
                      <td className="leave-type-cell">{translateDataValue(leave.type, lang)}</td>
                      <td className="leave-hours-cell">{leave.hours}</td>
                      <td className="leave-status-cell"><span className="status-pill">{leaveMcStatusLabel(resolvedLeaveMcStatus(leave, data))}</span></td>
                      <td className="leave-attachment-cell">
                        <div className="mc-record-cell">
                          {leave.mcAttachment ? (
                            <>
                              <a href={leave.mcAttachment.dataUrl} target="_blank" rel="noreferrer">{t("leaveMcAttachmentView")}</a>
                              <small>{leave.mcAttachment.name} · {formatFileSize(leave.mcAttachment.size)}</small>
                            </>
                          ) : (
                            <span className="muted-text">{t("leaveMcAttachmentMissing")}</span>
                          )}
                          {isMcRequiredLeaveType(leave.type, data) && !leave.mcAttachment ? (
                            <button type="button" className="link-button" onClick={() => openLeaveEditor(leave)}>{t("leaveMcAttachmentUpload")}</button>
                          ) : null}
                        </div>
                      </td>
                      <td className="leave-status-cell"><span className="status-pill">{leaveApprovalStatusLabel(resolvedLeaveApprovalStatus(leave))}</span></td>
                      <td className="leave-note-cell">{leave.note ? translateDataValue(leave.note, lang) : "-"}</td>
                      <td className="leave-action-cell">
                        <div className="leave-record-actions">
                          <Button icon={Pencil} variant="secondary" onClick={() => openLeaveEditor(leave)}>{t("viewEditLeave")}</Button>
                          <Button icon={Trash2} variant="ghost" onClick={() => removeLeave(leave.id)}>{t("remove")}</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.leaves.length === 0 ? (
                  <tr><td colSpan={9} className="empty-cell">{t("leaveRecordsEmpty")}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {recentLeaveAudits.length > 0 ? (
            <details className="leave-audit-summary">
              <summary>{t("leaveAuditTrailTitle")}</summary>
              <ul>
                {recentLeaveAudits.map((entry) => (
                  <li key={entry.id}>
                    <span>{auditChangedAt(entry.changedAt, lang)} · {entry.actor}</span>
                    <strong>{entry.field ? `${entry.field} · ${leaveAuditActionLabel(entry.action)}` : leaveAuditActionLabel(entry.action)}</strong>
                    {entry.oldValue || entry.newValue ? <small>{entry.oldValue ? `${entry.oldValue} → ${entry.newValue || "-"}` : entry.newValue}</small> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        {editingLeaveDraft ? (
          <div className="leave-edit-overlay" role="dialog" aria-modal="true" aria-label={t("editLeaveRecordTitle")}>
            <section className="leave-edit-dialog">
              <div className="leave-edit-head">
                <div>
                  <strong>{t("editLeaveRecordTitle")}</strong>
                  <span>{t("editLeaveRecordHint")}</span>
                </div>
                <button type="button" className="icon-button" aria-label={t("cancel")} onClick={closeLeaveEditor}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="leave-edit-body">
                <div className="leave-entry-row leave-entry-row-primary">
                  <Field label={t("colEmployee")}>
                    <select value={editingLeaveDraft.employeeId} onChange={(event) => setEditingLeaveDraft((current) => current ? ({ ...current, employeeId: event.target.value }) : current)}>
                      {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("colDate")}>
                    <input type="date" value={editingLeaveDraft.date} onChange={(event) => setEditingLeaveDraft((current) => current ? ({ ...current, date: event.target.value }) : current)} />
                  </Field>
                </div>
                <div className="leave-entry-row leave-entry-row-secondary">
                  <Field label={t("leaveTypeLabel")}>
                    <select
                      value={editingLeaveDraft.type}
                      onChange={(event) => {
                        const nextType = event.target.value;
                        const nextRequiresMc = isMcRequiredLeaveType(nextType, data);
                        setEditingLeaveDraft((current) => current ? ({
                          ...current,
                          type: nextType,
                          mcStatus: nextRequiresMc ? current.mcStatus === "notRequired" ? "pending" : current.mcStatus : "notRequired",
                          mcAttachment: nextRequiresMc ? current.mcAttachment : undefined,
                        }) : current);
                      }}
                    >
                      {data.settings.leaveTypes.map((type) => <option key={type} value={type}>{translateDataValue(type, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("leaveHoursLabel")}>
                    <input type="number" min="0" step="0.5" value={editingLeaveDraft.hours} onChange={(event) => setEditingLeaveDraft((current) => current ? ({ ...current, hours: Number(event.target.value) }) : current)} />
                  </Field>
                  <Field label={t("leaveApprovalStatusLabel")}>
                    <select value={editingLeaveDraft.approvalStatus} onChange={(event) => setEditingLeaveDraft((current) => current ? ({ ...current, approvalStatus: event.target.value as NonNullable<LeaveEntry["approvalStatus"]> }) : current)}>
                      <option value="approved">{t("leaveApprovalApproved")}</option>
                      <option value="pending">{t("leaveApprovalPending")}</option>
                      <option value="rejected">{t("leaveApprovalRejected")}</option>
                    </select>
                  </Field>
                </div>
                {editingLeaveRequiresMc ? (
                  <section className="leave-mc-panel">
                    <div className="leave-mc-panel-head">
                      <strong>{t("leaveMcSupportTitle")}</strong>
                      <span>{t("leaveMcSupportHint")}</span>
                    </div>
                    <div className="leave-entry-row leave-entry-row-mc">
                      <Field label={t("leaveMcStatusLabel")}>
                        <select value={editingLeaveDraft.mcStatus} onChange={(event) => setEditingLeaveDraft((current) => current ? ({ ...current, mcStatus: event.target.value as NonNullable<LeaveEntry["mcStatus"]> }) : current)}>
                          <option value="provided">{t("leaveMcProvided")}</option>
                          <option value="notProvided">{t("leaveMcNotProvided")}</option>
                          <option value="pending">{t("leaveMcPending")}</option>
                          <option value="notRequired">{t("leaveMcNotRequired")}</option>
                        </select>
                      </Field>
                      <Field label={t("leaveMcAttachmentLabel")}>
                        <div className="mc-attachment-field">
                          <label className="button button-secondary mc-upload-button">
                            <Upload size={16} aria-hidden="true" />
                            <span>{editingLeaveDraft.mcAttachment ? t("leaveMcAttachmentChange") : t("leaveMcAttachmentUpload")}</span>
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                              onChange={(event) => {
                                void handleEditingLeaveMcAttachment(event.currentTarget.files?.[0]);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {editingLeaveDraft.mcAttachment ? (
                            <span className="mc-attachment-chip">
                              <a href={editingLeaveDraft.mcAttachment.dataUrl} target="_blank" rel="noreferrer">{editingLeaveDraft.mcAttachment.name}</a>
                              <small>{formatFileSize(editingLeaveDraft.mcAttachment.size)}</small>
                              <button type="button" className="link-button" onClick={() => setEditingLeaveDraft((current) => current ? ({ ...current, mcAttachment: undefined }) : current)}>
                                {t("remove")}
                              </button>
                            </span>
                          ) : (
                            <small>{editingLeaveDraft.mcStatus === "provided" ? t("leaveMcAttachmentRequired") : t("leaveMcAttachmentHint")}</small>
                          )}
                        </div>
                      </Field>
                    </div>
                  </section>
                ) : null}
                <Field label={t("colNote")}>
                  <input value={editingLeaveDraft.note} onChange={(event) => setEditingLeaveDraft((current) => current ? ({ ...current, note: event.target.value }) : current)} placeholder={t("leaveNotePlaceholder")} />
                </Field>
              </div>
              <div className="leave-edit-footer">
                <Button variant="ghost" onClick={closeLeaveEditor}>{t("cancel")}</Button>
                <Button icon={Save} onClick={saveLeaveEdit}>{t("saveLeaveChanges")}</Button>
              </div>
            </section>
          </div>
        ) : null}

        <section className="panel overtime-panel">
          <SectionTitle title={t("otCheckTitle")} />
          <div className="overtime-sim">
            <div className="form-grid four">
              <Field label={t("colEmployee")}>
                <select value={otEmployee?.id ?? ""} onChange={(event) => setOtSimEmployeeId(event.target.value)}>
                  {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>)}
                </select>
              </Field>
              <Field label={t("colDate")}>
                <input type="date" value={otSimDate} onChange={(event) => setOtSimDate(event.target.value)} />
              </Field>
              <Field label={t("otSimClockOutLabel")}>
                <input type="time" value={otSimClockOut} onChange={(event) => setOtSimClockOut(event.target.value)} />
              </Field>
            </div>

            {otSimRecord && otBaseRecord?.schedule && otEmployee ? (
              <div className="overtime-sim-result">
                <div>
                  <span>{t("colShift")}</span>
                  <strong>{otSimRecord.shift?.name ? translateDataValue(otSimRecord.shift.name, lang) : "-"}</strong>
                </div>
                <div>
                  <span>{t("otSimWindowLabel")}</span>
                  <strong>{otBaseRecord.schedule.otStart} - {otBaseRecord.schedule.otEnd}</strong>
                </div>
                <div>
                  <span>{t("otSimWorkHours")}</span>
                  <strong>{formatHoursLabel(otSimRecord.workMinutes, lang)}</strong>
                </div>
                <div>
                  <span>{t("colOT")}</span>
                  <strong>{formatDuration(otSimRecord.overtimeMinutes, lang)}</strong>
                </div>
                <div className="overtime-sim-pay">
                  <span>{t("otSimOtPay")}</span>
                  <strong>{otEmployee.salary.currency || "MYR"} {otPay.toFixed(2)}</strong>
                </div>
              </div>
            ) : (
              <div className="empty-list">{t("otSimNoShift")}</div>
            )}
          </div>

          <SectionTitle title={t("otRecordsTitle")} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("colDate")}</th>
                  <th>{t("colEmployee")}</th>
                  <th>{t("colShift")}</th>
                  <th>{t("colOut")}</th>
                  <th>{t("colOT")}</th>
                  <th>{t("colNotes")}</th>
                </tr>
              </thead>
              <tbody>
                {monthRecords.filter((record) => record.overtimeMinutes > 0).map((record) => (
                  <tr key={`${record.employee.id}-${record.date}`}>
                    <td>{record.date}</td>
                    <td>{displayEmployeeName(record.employee)}</td>
                    <td>{record.shift?.name ? translateDataValue(record.shift.name, lang) : "-"}</td>
                    <td>{recordPunchTime(record, "out", lang)}</td>
                    <td>{formatDuration(record.overtimeMinutes, lang)}</td>
                    <td>{formatFlags(record.flags, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderReports() {
    const activeReportEmployeeId = reportType === "personal" ? selectedEmployeeId : reportEmployeeFilter;
    const reportEmployee = activeReportEmployeeId === "all"
      ? undefined
      : data.employees.find((employee) => employee.id === activeReportEmployeeId);
    const formatProfileValue = (value: string) => value ? translateDataValue(value, lang) : t("notSet");
    const formatSelectedProfileValue = (employees: Employee[], key: "company" | "department" | "position", multipleLabel: string) => {
      const values = Array.from(new Set(employees.map((employee) => employee[key]).filter(Boolean)));
      if (values.length === 0) return t("notSet");
      if (values.length === 1) return translateDataValue(values[0], lang);
      return multipleLabel;
    };
    const reportSummaryEmployees = reportEmployee ? [reportEmployee] : filteredEmployees;
    const isAllReportScope =
      !reportEmployee
      && companyFilter === "all"
      && departmentFilter === "all"
      && activeReportEmployeeId === "all";
    const reportSummary = reportEmployee
      ? {
          company: formatProfileValue(reportEmployee.company),
          department: formatProfileValue(reportEmployee.department),
          position: formatProfileValue(reportEmployee.position),
          employee: t("employeePrint", { name: displayEmployeeName(reportEmployee), enrollNo: reportEmployee.enrollNo || t("notSet") }),
        }
      : {
          company: isAllReportScope
            ? t("all")
            : companyFilter !== "all"
              ? translateDataValue(companyFilter, lang)
              : formatSelectedProfileValue(reportSummaryEmployees, "company", t("multipleCompanies")),
          department: isAllReportScope
            ? t("all")
            : departmentFilter !== "all"
              ? translateDataValue(departmentFilter, lang)
              : formatSelectedProfileValue(reportSummaryEmployees, "department", t("multipleDepartments")),
          position: isAllReportScope ? t("all") : formatSelectedProfileValue(reportSummaryEmployees, "position", t("multiplePositions")),
          employee: isAllReportScope ? t("all") : t("multipleEmployees"),
        };
    const reportFilteredSummaryLinesBase = [
      t("monthOnly", { month: selectedMonth }),
      t("companyPrint", { value: reportSummary.company }),
      t("departmentPrint", { value: reportSummary.department }),
      t("positionPrint", { value: reportSummary.position }),
      reportEmployee ? reportSummary.employee : t("employeePrintValue", { value: reportSummary.employee }),
    ];
    const reportSelectedRowSet = new Set(reportSelectedRowIds);
    const selectedReportRows = report.rows.filter((_, rowIndex) => reportSelectedRowSet.has(String(rowIndex)));
    const selectedReportRowCount = selectedReportRows.length;
    const allReportRowsSelected = report.rows.length > 0 && selectedReportRowCount === report.rows.length;
    const selectedExportDisabled = selectedReportRowCount === 0;
    const reportPrintRows = selectedReportRowCount > 0 ? selectedReportRows : report.rows;
    const reportOutputScopeLine = (kind: "print" | "export", selectedCount: number) => {
      if (kind === "print") {
        return selectedCount > 0 ? t("printScopeSelected", { count: selectedCount }) : t("printScopeFiltered");
      }
      return selectedCount > 0 ? t("exportScopeSelected", { count: selectedCount }) : t("exportScopeFiltered");
    };
    const reportEmployeesFromRows = (rows: ReportRow[]) => {
      const noColumns = [t("rcEmployeeNo"), t("employeePunchEnrollNo"), t("payrollColEnrollNo")];
      const nameColumns = [t("rcName"), t("employeePunchName"), t("payrollColName")];
      const ids = new Set<string>();
      if (reportEmployee && rows.length > 0) ids.add(reportEmployee.id);
      rows.forEach((row) => {
        const employeeNo = noColumns.map((column) => row[column]).find((value) => value !== undefined && value !== "");
        const employeeName = nameColumns.map((column) => row[column]).find((value) => value !== undefined && value !== "");
        const employee = data.employees.find((item) =>
          (employeeNo !== undefined && String(employeeNo) === item.enrollNo) ||
          (employeeName !== undefined && String(employeeName) === displayEmployeeName(item)),
        );
        if (employee) ids.add(employee.id);
      });
      return Array.from(ids)
        .map((id) => data.employees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => Boolean(employee));
    };
    const selectedReportEmployees = reportEmployeesFromRows(selectedReportRows);
    const selectedEmployeeScopeLine = (employees: Employee[]) => {
      if (employees.length === 1) {
        const employee = employees[0];
        return t("selectedEmployeePrint", { name: displayEmployeeName(employee), enrollNo: employee.enrollNo || t("notSet") });
      }
      return t("selectedEmployeesPrint", { count: employees.length });
    };
    const reportSelectedSummaryLines = (kind: "print" | "export") => {
      const employeeScopeLines = selectedReportEmployees.length > 0 ? [selectedEmployeeScopeLine(selectedReportEmployees)] : [];
      return [
        t("monthOnly", { month: selectedMonth }),
        reportOutputScopeLine(kind, selectedReportRowCount),
        ...employeeScopeLines,
        t("companyPrint", { value: selectedReportEmployees.length ? formatSelectedProfileValue(selectedReportEmployees, "company", t("multipleCompanies")) : t("notSet") }),
        t("departmentPrint", { value: selectedReportEmployees.length ? formatSelectedProfileValue(selectedReportEmployees, "department", t("multipleDepartments")) : t("notSet") }),
        t("positionPrint", { value: selectedReportEmployees.length ? formatSelectedProfileValue(selectedReportEmployees, "position", t("multiplePositions")) : t("notSet") }),
      ];
    };
    const reportFilteredSummaryLines = (kind: "print" | "export") => [
      ...reportFilteredSummaryLinesBase,
      reportOutputScopeLine(kind, 0),
    ];
    const reportOutputSummaryLines = (kind: "print" | "export") =>
      selectedReportRowCount > 0 ? reportSelectedSummaryLines(kind) : reportFilteredSummaryLines(kind);
    const reportPrintSummaryLines = reportOutputSummaryLines("print");
    const reportExportSummaryLines = () => [
      ...reportOutputSummaryLines("export"),
      t("exportDatePrint", { value: auditChangedAt(new Date().toISOString(), lang) }),
    ];
    const reportPrintButtonLabel = selectedReportRowCount > 0 ? t("printSelectedButton") : t("printFilteredButton");
    const reportPrintShape = reportType === "punchGrid"
      ? punchGridGroupedReportShape(report.columns, reportPrintRows, lang)
      : { columns: report.columns, rows: reportPrintRows };
    const punchGridPrintLayout: PunchGridPrintLayout = reportType === "punchGrid" && reportPrintRows.length > PUNCH_GRID_DETAIL_PRINT_ROW_LIMIT
      ? "matrix"
      : "employee";
    const punchGridPrintEmployees = reportType === "punchGrid"
      ? punchGridEmployeePrintSections(report.columns, reportPrintRows, lang)
      : [];
    const punchGridPrintMatrixWeeks = reportType === "punchGrid"
      ? punchGridMatrixPrintWeeks(report.columns, reportPrintRows, lang)
      : [];
    const punchGridSelectedEmployeesForDocs = reportType === "punchGrid"
      ? punchGridEmployeePrintSections(report.columns, selectedReportRows, lang)
      : [];
    const reportExportBaseName = safeFilenameSegment(`${report.title}-${selectedMonth}`);
    const toggleReportRowSelection = (rowId: string, selected: boolean) => {
      setReportSelectedRowIds((current) => {
        const next = new Set(current);
        if (selected) next.add(rowId);
        else next.delete(rowId);
        return Array.from(next).sort((a, b) => Number(a) - Number(b));
      });
    };
    const toggleAllReportRows = (selected: boolean) => {
      setReportSelectedRowIds(selected ? report.rows.map((_, rowIndex) => String(rowIndex)) : []);
    };
    const exportSelectedReportCsv = () => {
      if (selectedExportDisabled) return;
      downloadText(`${reportExportBaseName}-selected.csv`, dataUrlRows(report.columns, selectedReportRows), "text/csv;charset=utf-8");
    };
    const exportSelectedReportExcel = async () => {
      if (selectedExportDisabled) return;
      await downloadXlsxReport(
        `${reportExportBaseName}-selected.xlsx`,
        report.title,
        reportExportSummaryLines(),
        report.columns,
        selectedReportRows,
      );
    };
    const reportDocumentShape = () => {
      if (reportType !== "punchGrid" || report.columns.length <= 6) {
        return { columns: report.columns, rows: selectedReportRows };
      }
      return punchGridGroupedReportShape(report.columns, selectedReportRows, lang);
    };
    const exportSelectedReportDocs = async () => {
      if (selectedExportDisabled) return;
      if (reportType === "punchGrid") {
        await downloadPunchGridDocxReport(
          `${reportExportBaseName}-selected.docx`,
          report.title,
          [...reportExportSummaryLines(), t("punchGridPrintOrder")],
          punchGridSelectedEmployeesForDocs,
        );
        return;
      }
      const documentShape = reportDocumentShape();
      await downloadDocxReport(
        `${reportExportBaseName}-selected.docx`,
        report.title,
        reportExportSummaryLines(),
        documentShape.columns,
        documentShape.rows,
      );
    };
    const reportCardHint = (id: ReportId) => {
      switch (id) {
        case "summary": return t("reportSummaryHint");
        case "punchGrid": return t("reportPunchGridHint");
        case "personal": return t("reportPersonalHint");
        case "raw": return t("reportRawHint");
        case "lateEarly": return t("reportLateEarlyHint");
        case "leave": return t("reportLeaveHint");
        case "overtime": return t("reportOvertimeHint");
        case "absent": return t("reportAbsentHint");
        default: return "";
      }
    };
    const requiredReportCards: Array<{ id: ReportId; title: string; hint: string }> = reportOptions.map((option) => ({
      id: option.id,
      title: option.label[lang],
      hint: reportCardHint(option.id),
    }));
    const reportCardMap = new Map(requiredReportCards.map((card) => [card.id, card]));
    const reportGroups: Array<{ title: string; ids: ReportId[] }> = [
      { title: t("reportGroupMonthly"), ids: ["summary", "punchGrid", "lateEarly", "leave", "overtime", "absent"] },
      { title: t("reportGroupPersonal"), ids: ["personal"] },
      { title: t("reportGroupDevice"), ids: ["raw"] },
    ];

    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle
            title={t("reportFiltersTitle")}
          />
          <div className="report-purpose-note" role="note">
            <div>
              <strong>{t("employeeWorkFileTitle")}</strong>
              <span>{t("employeeWorkFileHint")}</span>
            </div>
            <div>
              <strong>{t("officialReportTitle")}</strong>
              <span>{t("officialReportHint")}</span>
            </div>
          </div>
          <div className="report-format-groups">
            {reportGroups.map((group) => (
              <section key={group.title} className="report-format-group" aria-label={group.title}>
                <h3>{group.title}</h3>
                <div className="report-format-strip">
                  {group.ids.map((reportId) => {
                    const card = reportCardMap.get(reportId);
                    if (!card) return null;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        className={cx("report-format-card", reportType === card.id && "report-format-card-active")}
                        onClick={() => setReportType(card.id)}
                      >
                        <strong>{card.title}</strong>
                        <span>{card.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="toolbar reports-toolbar">
            <Field label={t("companyLabel")} compact>
              <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
                <option value="all">{t("allCompanies")}</option>
                {data.settings.companies.map((company) => <option key={company} value={company}>{translateDataValue(company, lang)}</option>)}
              </select>
            </Field>
            <Field label={t("departmentLabel")} compact>
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                <option value="all">{t("allDepartments")}</option>
                {data.settings.departments.map((department) => <option key={department} value={department}>{translateDataValue(department, lang)}</option>)}
              </select>
            </Field>
            <Field label={t("colEmployee")} compact>
              <select
                value={activeReportEmployeeId}
                onChange={(event) => {
                  if (reportType === "personal") setSelectedEmployeeId(event.target.value);
                  else setReportEmployeeFilter(event.target.value);
                }}
              >
                {reportType !== "personal" ? <option value="all">{t("allEmployees")}</option> : null}
                {data.employees.filter((e) => e.active).map((employee) => <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className={cx("panel report-panel", `report-print-${reportType}`)}>
          <SectionTitle
            title={report.title}
            action={<span className="hint">{t("monthOnceConstraint", { month: selectedMonth })}</span>}
          />
          <div className="report-print-header">
            <div className="report-print-title">
              <strong>{report.title}</strong>
              <span>{t("monthOnly", { month: selectedMonth })}</span>
            </div>
            <div className="report-print-meta">
              {reportPrintSummaryLines.slice(1).map((line) => <span key={line}>{line}</span>)}
              {reportType === "punchGrid" ? <span>{t("punchGridPrintOrder")}</span> : null}
            </div>
          </div>
          <div className="report-export-bar">
            <div>
              <strong>{t("selectedReportRows", { count: selectedReportRowCount })}</strong>
              <span>{t("reportEditableExportHint")}</span>
            </div>
            <div className="inline-actions report-export-actions">
              <Button
                icon={Printer}
                variant="secondary"
                onClick={() => handlePrint(
                  ".report-panel",
                  report.title,
                  reportType === "punchGrid" ? "landscape" : "portrait",
                  reportType === "punchGrid",
                )}
              >
                {reportPrintButtonLabel}
              </Button>
              <Button icon={Download} variant="secondary" disabled={selectedExportDisabled} onClick={exportSelectedReportCsv}>{t("exportSelectedCsv")}</Button>
              <Button icon={FileSpreadsheet} variant="secondary" disabled={selectedExportDisabled} onClick={exportSelectedReportExcel}>{t("exportSelectedExcel")}</Button>
              <Button icon={FileText} variant="secondary" disabled={selectedExportDisabled} onClick={exportSelectedReportDocs}>{t("exportSelectedDocs")}</Button>
            </div>
          </div>
          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  <th className="report-select-col">
                    <input
                      type="checkbox"
                      aria-label={t("selectAllReportRows")}
                      checked={allReportRowsSelected}
                      disabled={report.rows.length === 0}
                      onChange={(event) => toggleAllReportRows(event.target.checked)}
                    />
                  </th>
                  {report.columns.map((column) => <th key={column} className={reportColumnClassName(column)}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    <td className="report-select-col">
                      <input
                        type="checkbox"
                        aria-label={t("selectReportRow", { index: rowIndex + 1 })}
                        checked={reportSelectedRowSet.has(String(rowIndex))}
                        onChange={(event) => toggleReportRowSelection(String(rowIndex), event.target.checked)}
                      />
                    </td>
                    {report.columns.map((column) => <td key={column} className={reportCellClassName(column, row[column])}>{row[column]}</td>)}
                  </tr>
                ))}
                {report.rows.length === 0 ? <tr><td colSpan={report.columns.length + 1} className="empty-cell">{t("noMatchingRecords")}</td></tr> : null}
              </tbody>
            </table>
          </div>
          {reportType === "punchGrid" ? (
            punchGridPrintLayout === "employee" ? (
              <div className="print-only-table punch-grid-employee-print" data-print-content="true">
                {punchGridPrintEmployees.map((employee, employeeIndex) => (
                  <section className="punch-grid-employee-section" key={`${employee.employeeNo}-${employeeIndex}`}>
                    <div className="punch-grid-employee-head">
                      <strong>{employee.heading}</strong>
                    </div>
                    {employee.weeks.map((week) => (
                      <div className="punch-grid-week" key={week.label}>
                        <h4>{week.label}</h4>
                        <table>
                          <thead>
                            <tr>
                              {week.days.map((day) => <th key={day.day}>{day.label}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {week.days.map((day) => (
                                <td key={day.day} className="report-multiline-col">{day.value}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </section>
                ))}
                {punchGridPrintEmployees.length === 0 ? <div className="empty-cell">{t("noMatchingRecords")}</div> : null}
              </div>
            ) : (
              <div className="print-only-table punch-grid-matrix-print" data-print-content="true">
                {punchGridPrintMatrixWeeks.map((week) => (
                  <section className="punch-grid-matrix-week" key={week.label}>
                    <h4>{week.label}</h4>
                    <table>
                      <thead>
                        <tr>
                          <th className="report-name-col">{t("colEmployee")}</th>
                          <th className="report-center-col">{t("colDepartment")}</th>
                          <th className="report-center-col">{t("colShift")}</th>
                          {week.days.map((day) => <th key={day.day} className="report-center-col">{day.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {week.rows.map((row) => (
                          <tr key={row.key}>
                            <td className="report-name-col punch-grid-matrix-employee-cell">
                              <strong>{row.name}</strong>
                              <span>{row.employeeNo}</span>
                            </td>
                            <td className="report-center-col">{row.department}</td>
                            <td className="report-center-col">{row.shift}</td>
                            {row.dayValues.map((day) => (
                              <td key={day.day} className="report-multiline-col">{day.value}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                ))}
                {punchGridPrintMatrixWeeks.length === 0 ? <div className="empty-cell">{t("noMatchingRecords")}</div> : null}
              </div>
            )
          ) : (
            <div className="table-wrap report-table print-only-table report-selection-print-table">
              <table data-print-table="true">
                <thead>
                  <tr>
                    {reportPrintShape.columns.map((column) => (
                      <th key={column} className={reportColumnClassName(column)}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportPrintShape.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {reportPrintShape.columns.map((column) => (
                        <td key={column} className={reportCellClassName(column, row[column])}>{row[column]}</td>
                      ))}
                    </tr>
                  ))}
                  {reportPrintShape.rows.length === 0 ? (
                    <tr><td colSpan={reportPrintShape.columns.length} className="empty-cell">{t("noMatchingRecords")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderPayroll() {
    const rows = monthlyReadiness.hasOperationalData
      ? activeEmployees
          .filter((employee) => companyFilter === "all" || employee.company === companyFilter)
          .filter((employee) => departmentFilter === "all" || employee.department === departmentFilter)
          .map((employee) => {
            const pay = payrollFor(data, employee, selectedMonth);
            return {
              employee,
              summary: pay.summary,
              workHours: pay.workHours,
              paidLeaveHours: pay.summary.paidLeaveHours,
              paidLeaveDays: pay.summary.paidLeaveDays,
              otHours: pay.otHours,
              base: pay.base,
              otPay: pay.otPay,
              absentDeduct: pay.absentDeduct,
              unpaidLeaveDeduct: pay.unpaidLeaveDeduct,
              absentDays: pay.summary.absentDays,
              deductedAbsentDays: pay.summary.deductedAbsentDays,
              unpaidLeaveDays: pay.summary.deductibleLeaveDays,
              deductedUnpaidLeaveDays: pay.summary.deductedUnpaidLeaveDays,
              shortHoursDeduct: pay.shortHoursDeduct,
              reviewDeduct: pay.reviewDeduct,
              totalDeduct: pay.totalDeduct,
              gross: pay.gross,
              proration: pay.proration,
              warningFlags: pay.warningFlags,
            };
          })
      : [];
    const grandTotalByCurrency = rows.reduce<Record<string, number>>((acc, row) => {
      const cur = row.employee.salary.currency || "MYR";
      acc[cur] = (acc[cur] ?? 0) + row.gross;
      return acc;
    }, {});
    const payrollSelectedEmployeeSet = new Set(payrollSelectedEmployeeIds);
    const selectedPayrollRows = rows.filter((row) => payrollSelectedEmployeeSet.has(row.employee.id));
    const selectedPayrollRowCount = selectedPayrollRows.length;
    const payrollOutputRows = selectedPayrollRowCount > 0 ? selectedPayrollRows : rows;
    const allPayrollRowsSelected = rows.length > 0 && selectedPayrollRowCount === rows.length;
    const payrollOutputScopeLine = (kind: "print" | "export") => {
      if (kind === "print") {
        return selectedPayrollRowCount > 0 ? t("printScopeSelected", { count: selectedPayrollRowCount }) : t("printScopeFiltered");
      }
      return selectedPayrollRowCount > 0 ? t("exportScopeSelected", { count: selectedPayrollRowCount }) : t("exportScopeFiltered");
    };
    const payrollPrintScopeLine = payrollOutputScopeLine("print");
    const payrollPrintButtonLabel = selectedPayrollRowCount > 0 ? t("printSelectedButton") : t("printFilteredButton");
    const payrollGrandTotalByCurrency = payrollOutputRows.reduce<Record<string, number>>((acc, row) => {
      const cur = row.employee.salary.currency || "MYR";
      acc[cur] = (acc[cur] ?? 0) + row.gross;
      return acc;
    }, {});
    const togglePayrollRowSelection = (employeeId: string, selected: boolean) => {
      setPayrollSelectedEmployeeIds((current) => {
        const next = new Set(current);
        if (selected) next.add(employeeId);
        else next.delete(employeeId);
        return Array.from(next).sort();
      });
    };
    const toggleAllPayrollRows = (selected: boolean) => {
      setPayrollSelectedEmployeeIds(selected ? rows.map((row) => row.employee.id) : []);
    };
    const readinessLabel =
      monthlyReadiness.status === "empty"
        ? t("payrollEmptyTitle")
        : monthlyReadiness.status === "ready"
          ? t("payrollReadyTitle")
          : t("payrollPendingTitle", { count: monthlyReadiness.unresolvedCount });
    const readinessDetail =
      monthlyReadiness.status === "pending"
        ? t("payrollExportWarning", { count: monthlyReadiness.unresolvedCount })
        : monthlyReadiness.status === "empty"
          ? t("payrollEmptySubtitle")
          : t("payrollReadySubtitle");
    const payrollWarningsText = (row: { warningFlags: string[] }) => {
      const labels = row.warningFlags.map((flag) => {
        switch (flag) {
          case "missing":
            return t("metricMissingPunch");
          case "absent":
            return t("metricAbsentDays");
          case "lateEarly":
            return t("metricLateEarly");
          case "shortHours":
            return t("metricShortHours");
          case "acceptedShortHours":
            return t("payrollAcceptedShortHours");
          case "deductedShortHours":
            return t("payrollDeductedShortHours");
          case "overtime":
            return t("payrollOtWarnings");
          case "unpaidLeave":
            return t("payrollColUnpaidLeaveDays");
          default:
            return flag;
        }
      });
      return labels.length > 0 ? labels.join(" / ") : t("payrollWarningNo");
    };

    const payrollExportColumns = [
      t("payrollReadinessStatus"),
      t("payrollColEnrollNo"),
      t("payrollColName"),
      t("payrollColDept"),
      t("payrollColType"),
      t("payrollColWorkHours"),
      t("payrollColPaidLeaveHours"),
      t("payrollColOtHours"),
      t("payrollColLeaveDays"),
      t("payrollColAbsentDays"),
      t("payrollColDeductedAbsentDays"),
      t("payrollColUnpaidLeaveDays"),
      t("payrollColDeductedUnpaidLeaveDays"),
      t("payrollColOtWarning"),
      t("salaryCurrencyLabel"),
      t("payrollColBase"),
      t("payrollColOtPay"),
      t("payrollColAbsentDeduct"),
      t("payrollColLeaveDeduct"),
      t("payrollColShortHoursDeduct"),
      t("payrollColReviewDeduct"),
      t("payrollColTotalDeduct"),
      t("payrollColGross"),
    ];
    const payrollExportRows = payrollOutputRows.map((row) => ({
      [t("payrollReadinessStatus")]: readinessLabel,
      [t("payrollColEnrollNo")]: row.employee.enrollNo,
      [t("payrollColName")]: displayEmployeeName(row.employee),
      [t("payrollColDept")]: translateDataValue(row.employee.department, lang),
      [t("payrollColType")]: row.employee.salary.type === "monthly" ? t("salaryTypeMonthly") : t("salaryTypeHourly"),
      [t("payrollColWorkHours")]: row.workHours.toFixed(2),
      [t("payrollColPaidLeaveHours")]: row.paidLeaveHours.toFixed(2),
      [t("payrollColOtHours")]: row.otHours.toFixed(2),
      [t("payrollColLeaveDays")]: row.paidLeaveDays,
      [t("payrollColAbsentDays")]: row.absentDays,
      [t("payrollColDeductedAbsentDays")]: row.deductedAbsentDays,
      [t("payrollColUnpaidLeaveDays")]: row.unpaidLeaveDays,
      [t("payrollColDeductedUnpaidLeaveDays")]: row.deductedUnpaidLeaveDays,
      [t("payrollColOtWarning")]: payrollWarningsText(row),
      [t("salaryCurrencyLabel")]: row.employee.salary.currency,
      [t("payrollColBase")]: row.base.toFixed(2),
      [t("payrollColOtPay")]: row.otPay.toFixed(2),
      [t("payrollColAbsentDeduct")]: row.absentDeduct.toFixed(2),
      [t("payrollColLeaveDeduct")]: row.unpaidLeaveDeduct.toFixed(2),
      [t("payrollColShortHoursDeduct")]: row.shortHoursDeduct.toFixed(2),
      [t("payrollColReviewDeduct")]: row.reviewDeduct.toFixed(2),
      [t("payrollColTotalDeduct")]: row.totalDeduct.toFixed(2),
      [t("payrollColGross")]: row.gross.toFixed(2),
    }));
    const payrollCompactColumns = [
      t("payrollColEnrollNo"),
      t("payrollColName"),
      t("payrollColDept"),
      t("payrollColType"),
      t("payrollColWorkHours"),
      t("payrollColOtHours"),
      t("payrollColTotalDeduct"),
      t("payrollColGross"),
      t("payrollColOtWarning"),
    ];
    const formatPayrollMoney = (currency: string, amount: number, negative = false) =>
      `${negative ? "-" : ""}${currency} ${amount.toFixed(2)}`;
    const payrollCompactRows = payrollOutputRows.map((row) => ({
      [t("payrollColEnrollNo")]: row.employee.enrollNo,
      [t("payrollColName")]: displayEmployeeName(row.employee),
      [t("payrollColDept")]: translateDataValue(row.employee.department, lang),
      [t("payrollColType")]: row.employee.salary.type === "monthly" ? t("salaryTypeMonthly") : t("salaryTypeHourly"),
      [t("payrollColWorkHours")]: row.workHours.toFixed(2),
      [t("payrollColOtHours")]: row.otHours.toFixed(2),
      [t("payrollColTotalDeduct")]: formatPayrollMoney(row.employee.salary.currency, row.totalDeduct, true),
      [t("payrollColGross")]: formatPayrollMoney(row.employee.salary.currency, row.gross),
      [t("payrollColOtWarning")]: payrollWarningsText(row),
    }));
    const payrollCompactHeaderClassName = (column: string) => cx("payroll-compact-header-cell", reportColumnClassName(column));
    const payrollCompactBodyClassName = (column: string) => {
      if (column === t("payrollColName")) return "report-name-col";
      if (column === t("payrollColOtWarning")) return "report-text-col";
      if (column === t("payrollColWorkHours") || column === t("payrollColOtHours")) return "payroll-compact-hours-col";
      if (column === t("payrollColTotalDeduct") || column === t("payrollColGross")) return "payroll-compact-amount-col";
      return reportColumnClassName(column);
    };
    const formatPayrollSelectedProfileValue = (employees: Employee[], key: "company" | "department", multipleLabel: string) => {
      const values = Array.from(new Set(employees.map((employee) => employee[key]).filter(Boolean)));
      if (values.length === 0) return t("notSet");
      if (values.length === 1) return translateDataValue(values[0], lang);
      return multipleLabel;
    };
    const payrollSelectedEmployeeScopeLine = () => {
      if (selectedPayrollRows.length === 1) {
        const employee = selectedPayrollRows[0].employee;
        return t("selectedEmployeePrint", { name: displayEmployeeName(employee), enrollNo: employee.enrollNo || t("notSet") });
      }
      return t("selectedEmployeesPrint", { count: selectedPayrollRows.length });
    };
    const payrollFilteredSummaryLines = (kind: "print" | "export") => [
      t("monthOnly", { month: selectedMonth }),
      t("companyPrint", { value: companyFilter === "all" ? t("all") : translateDataValue(companyFilter, lang) }),
      t("departmentPrint", { value: departmentFilter === "all" ? t("all") : translateDataValue(departmentFilter, lang) }),
      t("payrollReadinessStatus") + ": " + readinessLabel,
      payrollOutputScopeLine(kind),
    ];
    const payrollSelectedSummaryLines = (kind: "print" | "export") => {
      const employees = selectedPayrollRows.map((row) => row.employee);
      return [
        t("monthOnly", { month: selectedMonth }),
        payrollOutputScopeLine(kind),
        payrollSelectedEmployeeScopeLine(),
        t("companyPrint", { value: formatPayrollSelectedProfileValue(employees, "company", t("multipleCompanies")) }),
        t("departmentPrint", { value: formatPayrollSelectedProfileValue(employees, "department", t("multipleDepartments")) }),
        t("payrollReadinessStatus") + ": " + readinessLabel,
      ];
    };
    const payrollOutputSummaryLines = (kind: "print" | "export") =>
      selectedPayrollRowCount > 0 ? payrollSelectedSummaryLines(kind) : payrollFilteredSummaryLines(kind);
    const payrollPrintSummaryLines = payrollOutputSummaryLines("print");
    const payrollExportSummaryLines = () => [
      ...payrollOutputSummaryLines("export"),
      t("exportDatePrint", { value: auditChangedAt(new Date().toISOString(), lang) }),
    ];

    function exportPayrollCsv() {
      downloadText(`payroll-${selectedMonth}.csv`, dataUrlRows(payrollExportColumns, payrollExportRows), "text/csv;charset=utf-8");
    }

    async function exportPayrollExcel() {
      await downloadXlsxReport(
        `payroll-${selectedMonth}.xlsx`,
        t("payrollTitle"),
        payrollExportSummaryLines(),
        payrollExportColumns,
        payrollExportRows,
      );
    }

    async function exportPayrollDocs() {
      await downloadDocxReport(
        `payroll-${selectedMonth}.docx`,
        t("payrollTitle"),
        payrollExportSummaryLines(),
        payrollCompactColumns,
        payrollCompactRows,
      );
    }

    return (
      <div className="view-stack">
        <section className="panel report-panel payroll-print-panel">
          <SectionTitle
            title={t("payrollTitle")}
            action={
              <div className="inline-actions">
                <Button icon={Download} onClick={exportPayrollCsv}>{selectedPayrollRowCount > 0 ? t("exportSelectedCsv") : t("csvButton")}</Button>
                <Button icon={FileSpreadsheet} variant="secondary" onClick={exportPayrollExcel}>{selectedPayrollRowCount > 0 ? t("exportSelectedExcel") : t("exportExcel")}</Button>
                <Button icon={FileText} variant="secondary" onClick={exportPayrollDocs}>{selectedPayrollRowCount > 0 ? t("exportSelectedDocs") : t("exportDocs")}</Button>
                <Button icon={Printer} variant="secondary" onClick={() => handlePrint(".payroll-print-panel", t("payrollTitle"), "landscape", true)}>{payrollPrintButtonLabel}</Button>
              </div>
            }
          />
          <p className="panel-caption">{t("payrollSubtitle")}</p>
          <div className={cx("payroll-export-status", `payroll-export-status-${monthlyReadiness.status}`)}>
            <strong>{readinessLabel}</strong>
            <span>{readinessDetail}</span>
            <span>{payrollPrintScopeLine}</span>
          </div>
          <div className="toolbar reports-toolbar">
            <Field label={t("monthLabel")} compact>
              <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
            </Field>
            <Field label={t("companyLabel")} compact>
              <select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)}>
                <option value="all">{t("allCompanies")}</option>
                {data.settings.companies.map((company) => <option key={company} value={company}>{translateDataValue(company, lang)}</option>)}
              </select>
            </Field>
            <Field label={t("departmentLabel")} compact>
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                <option value="all">{t("allDepartments")}</option>
                {data.settings.departments.map((department) => <option key={department} value={department}>{translateDataValue(department, lang)}</option>)}
              </select>
            </Field>
          </div>
          <div className="report-print-header">
            <div className="report-print-title">
              <strong>{t("payrollTitle")}</strong>
              <span>{t("monthOnly", { month: selectedMonth })}</span>
            </div>
            <div className="report-print-meta">
              {payrollPrintSummaryLines.slice(1).map((line) => <span key={line}>{line}</span>)}
            </div>
          </div>
          <div className="print-only-table payroll-compact-print-table">
            <table className="payroll-table payroll-compact-table" data-print-table="true">
              <colgroup>
                <col className="payroll-compact-col-enroll" />
                <col className="payroll-compact-col-name" />
                <col className="payroll-compact-col-dept" />
                <col className="payroll-compact-col-type" />
                <col className="payroll-compact-col-hours" />
                <col className="payroll-compact-col-hours" />
                <col className="payroll-compact-col-money" />
                <col className="payroll-compact-col-money" />
                <col className="payroll-compact-col-notes" />
              </colgroup>
              <thead>
                <tr>
                  {payrollCompactColumns.map((column) => (
                    <th key={column} className={payrollCompactHeaderClassName(column)}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payrollCompactRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {payrollCompactColumns.map((column) => (
                      <td key={column} className={payrollCompactBodyClassName(column)}>{row[column]}</td>
                    ))}
                  </tr>
                ))}
                {payrollCompactRows.length === 0 ? (
                  <tr><td colSpan={payrollCompactColumns.length} className="empty-cell">{t("noMatchingRecords")}</td></tr>
                ) : null}
              </tbody>
              {payrollCompactRows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={Math.max(1, payrollCompactColumns.length - 1)} className="num"><strong>{t("payrollGrandTotal")}</strong></td>
                    <td className="num"><strong>{Object.entries(payrollGrandTotalByCurrency).map(([cur, sum]) => `${cur} ${sum.toFixed(2)}`).join(" / ")}</strong></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <div className="table-wrap report-table payroll-screen-table">
            <p className="table-help">{t("payrollClickEmployeeHint")}</p>
            <table className="payroll-table">
              <colgroup>
                <col className="payroll-col-select" />
                <col className="payroll-col-enroll" />
                <col className="payroll-col-name" />
                <col className="payroll-col-dept" />
                <col className="payroll-col-type" />
                <col className="payroll-col-hours" />
                <col className="payroll-col-hours-wide" />
                <col className="payroll-col-hours" />
                <col className="payroll-col-days" />
                <col className="payroll-col-days" />
                <col className="payroll-col-days-wide" />
                <col className="payroll-col-days-wide" />
                <col className="payroll-col-days-wide" />
                <col className="payroll-col-notes" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-payable" />
              </colgroup>
              <thead>
                <tr>
                  <th className="report-select-col">
                    <input
                      type="checkbox"
                      aria-label={t("selectAllReportRows")}
                      checked={allPayrollRowsSelected}
                      disabled={rows.length === 0}
                      onChange={(event) => toggleAllPayrollRows(event.target.checked)}
                    />
                  </th>
                  <th className="payroll-sticky payroll-group-info">{t("payrollColEnrollNo")}</th>
                  <th className="payroll-sticky payroll-sticky-name payroll-group-info">{t("payrollColName")}</th>
                  <th className="payroll-group-info">{t("payrollColDept")}</th>
                  <th className="payroll-group-info">{t("payrollColType")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColWorkHours")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColPaidLeaveHours")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColOtHours")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColLeaveDays")}</th>
                  <th className="num payroll-group-deduct">{t("payrollColAbsentDays")}</th>
                  <th className="num payroll-group-deduct">{t("payrollColDeductedAbsentDays")}</th>
                  <th className="num payroll-group-deduct">{t("payrollColUnpaidLeaveDays")}</th>
                  <th className="num payroll-group-deduct">{t("payrollColDeductedUnpaidLeaveDays")}</th>
                  <th className="payroll-group-deduct">{t("payrollColOtWarning")}</th>
                  <th className="num payroll-group-money">{t("payrollColBase")}</th>
                  <th className="num payroll-group-money">{t("payrollColOtPay")}</th>
                  <th className="num payroll-group-money">{t("payrollColAbsentDeduct")}</th>
                  <th className="num payroll-group-money">{t("payrollColLeaveDeduct")}</th>
                  <th className="num payroll-group-money">{t("payrollColShortHoursDeduct")}</th>
                  <th className="num payroll-group-money">{t("payrollColReviewDeduct")}</th>
                  <th className="num payroll-group-money">{t("payrollColTotalDeduct")}</th>
                  <th className="num payroll-group-payable">{t("payrollColGross")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.employee.id}>
                    <td className="report-select-col">
                      <input
                        type="checkbox"
                        aria-label={t("selectReportRow", { index: rowIndex + 1 })}
                        checked={payrollSelectedEmployeeSet.has(row.employee.id)}
                        onChange={(event) => togglePayrollRowSelection(row.employee.id, event.target.checked)}
                      />
                    </td>
                    <td className="payroll-sticky" data-label={t("payrollColEnrollNo")}>{row.employee.enrollNo}</td>
                    <td className="payroll-sticky payroll-sticky-name" data-label={t("payrollColName")}>
                      <button
                        type="button"
                        className="payroll-name-button"
                        onClick={() => openEmployeeMonthlyReport(row.employee.id)}
                      >
                        {displayEmployeeName(row.employee)}
                        <span>{t("payrollOpenReportHint")}</span>
                      </button>
                    </td>
                    <td data-label={t("payrollColDept")}>{translateDataValue(row.employee.department, lang)}</td>
                    <td data-label={t("payrollColType")}>{row.employee.salary.type === "monthly" ? t("salaryTypeMonthly") : t("salaryTypeHourly")}</td>
                    <td className="num" data-label={t("payrollColWorkHours")}>{row.workHours.toFixed(2)}</td>
                    <td className="num" data-label={t("payrollColPaidLeaveHours")}>{row.paidLeaveHours.toFixed(2)}</td>
                    <td className="num" data-label={t("payrollColOtHours")}>{row.otHours.toFixed(2)}</td>
                    <td className="num" data-label={t("payrollColLeaveDays")}>{row.paidLeaveDays}</td>
                    <td className="num" data-label={t("payrollColAbsentDays")}>{row.absentDays}</td>
                    <td className="num" data-label={t("payrollColDeductedAbsentDays")}>{row.deductedAbsentDays}</td>
                    <td className="num" data-label={t("payrollColUnpaidLeaveDays")}>{row.unpaidLeaveDays}</td>
                    <td className="num" data-label={t("payrollColDeductedUnpaidLeaveDays")}>{row.deductedUnpaidLeaveDays}</td>
                    <td className="payroll-notes-cell" data-label={t("payrollColOtWarning")}>
                      <span
                        className={cx(
                          "mini-pill",
                          row.warningFlags.some((flag) => flag !== "overtime" && flag !== "acceptedShortHours" && flag !== "deductedShortHours")
                            ? "mini-pill-warn"
                            : row.warningFlags.some((flag) => flag === "overtime" || flag === "acceptedShortHours" || flag === "deductedShortHours")
                              ? "mini-pill-muted"
                              : "mini-pill-good",
                        )}
                      >
                        {payrollWarningsText(row)}
                      </span>
                    </td>
                    <td className="num payroll-money-cell" data-label={t("payrollColBase")}><span>{row.employee.salary.currency}</span> {row.base.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColOtPay")}><span>{row.employee.salary.currency}</span> {row.otPay.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColAbsentDeduct")}>-<span>{row.employee.salary.currency}</span> {row.absentDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColLeaveDeduct")}>-<span>{row.employee.salary.currency}</span> {row.unpaidLeaveDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColShortHoursDeduct")}>-<span>{row.employee.salary.currency}</span> {row.shortHoursDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColReviewDeduct")}>-<span>{row.employee.salary.currency}</span> {row.reviewDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColTotalDeduct")}>-<span>{row.employee.salary.currency}</span> {row.totalDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell payroll-payable-cell" data-label={t("payrollColGross")}><strong><span>{row.employee.salary.currency}</span> {row.gross.toFixed(2)}</strong></td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr><td colSpan={22} className="empty-cell">{t("noMatchingRecords")}</td></tr>
                ) : null}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={21} className="num"><strong>{t("payrollGrandTotal")}</strong></td>
                    <td className="num"><strong>{Object.entries(grandTotalByCurrency).map(([cur, sum]) => `${cur} ${sum.toFixed(2)}`).join(" / ")}</strong></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="panel-caption muted">{t("payrollPreviewNote")}</p>
        </section>
      </div>
    );
  }

  function renderSettingsShell() {
    const tabs: Array<{ id: SettingsTab; label: string; icon: LucideIcon }> = [
      { id: "shifts", label: t("navShifts"), icon: Clock3 },
      { id: "holidays", label: t("settingsTabHolidays"), icon: CalendarDays },
      { id: "permissions", label: t("settingsTabPermissions"), icon: LockKeyhole },
      { id: "devices", label: t("settingsTabDevices"), icon: Fingerprint },
      { id: "lists", label: t("settingsTabLists"), icon: ListFilter },
      { id: "data", label: t("settingsTabData"), icon: Database },
    ];
    void SETTINGS_TABS;
    return (
      <div className="settings-shell">
        <nav className="settings-subnav" aria-label={t("settingsSubnavAria")}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={cx("settings-subnav-item", settingsTab === tab.id && "settings-subnav-active")}
                onClick={() => setSettingsTab(tab.id)}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="settings-body">
          {settingsTab === "shifts" ? renderShifts() : null}
          {settingsTab === "holidays" ? renderSettingsHolidays() : null}
          {settingsTab === "permissions" ? renderSettingsPermissions() : null}
          {settingsTab === "devices" ? renderSettingsDevices() : null}
          {settingsTab === "lists" ? renderSettingsLists() : null}
          {settingsTab === "data" ? renderSettingsData() : null}
        </div>
      </div>
    );
  }

  function renderSettingsPermissions() {
    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle title={t("permissionsTitle")} />
          <div className="permission-stack">
            <div className="permission-block">
              <label className="permission-item">
                <LockKeyhole size={20} />
                <span>{t("requirePasswordLabel")}</span>
                <input
                  type="checkbox"
                  checked={data.settings.requirePassword}
                  onChange={(event) =>
                    setData((current) => ({
                      ...current,
                      settings: { ...current.settings, requirePassword: event.target.checked },
                    }))
                  }
                />
              </label>
              {data.settings.requirePassword ? (
                <div className="permission-children">
                  <Field label={t("hrPasswordSettingLabel")}>
                    <input
                      type="password"
                      value={data.settings.hrPassword}
                      onChange={(event) =>
                        setData((current) => ({
                          ...current,
                          settings: { ...current.settings, hrPassword: event.target.value },
                        }))
                      }
                    />
                  </Field>
                  <Field label={t("lockScreenHintLabel")}>
                    <input
                      value={data.settings.localPasswordHint}
                      onChange={(event) =>
                        setData((current) => ({
                          ...current,
                          settings: { ...current.settings, localPasswordHint: event.target.value },
                        }))
                      }
                    />
                  </Field>
                </div>
              ) : null}
            </div>

            <div className="permission-block">
              <label className="permission-item">
                <KeyRound size={20} />
                <span>{t("usbKeyEnableLabel")}</span>
                <input
                  type="checkbox"
                  checked={data.settings.usbLicenseRequired}
                  onChange={(event) =>
                    setData((current) => ({
                      ...current,
                      settings: { ...current.settings, usbLicenseRequired: event.target.checked },
                    }))
                  }
                />
              </label>
              {data.settings.usbLicenseRequired ? (
                <div className="permission-children">
                  <Field label={t("usbTokenSettingLabel")}>
                    <input
                      value={data.settings.usbToken}
                      onChange={(event) =>
                        setData((current) => ({
                          ...current,
                          settings: { ...current.settings, usbToken: event.target.value },
                        }))
                      }
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="panel">
          <SectionTitle title={t("entryPreferenceTitle")} />
          <div className="entry-pref-row">
            <Field label={t("workdayLabel")} compact>
              <input
                type="date"
                value={data.settings.businessDate}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, businessDate: event.target.value },
                  }))
                }
              />
            </Field>
            <p className="entry-pref-help">{t("defaultEntryDateHelp")}</p>
          </div>
        </section>
      </div>
    );
  }

  function renderSettingsDevices() {
    const device = data.settings.device;
    const options = [
      { key: "fingerprint", label: t("deviceFingerprint"), icon: Fingerprint },
      { key: "face", label: t("deviceFace"), icon: ScanFace },
      { key: "card", label: t("deviceCard"), icon: CreditCard },
    ] as const;
    const patchDevice = (patch: Partial<typeof device>) => {
      setData((current) => ({
        ...current,
        settings: { ...current.settings, device: { ...current.settings.device, ...patch } },
      }));
    };

    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle title={t("deviceSettingsTitle")} />
          <p className="panel-caption">{t("deviceSettingsCaption")}</p>
          <div className="form-grid three">
            <Field label={t("deviceModelLabel")}>
              <input
                value={device.model}
                placeholder={t("deviceModelPlaceholder")}
                onChange={(event) => patchDevice({ model: event.target.value })}
              />
            </Field>
          </div>
          <div className="device-grid">
            {options.map(({ key, label, icon: Icon }) => {
              const active = Boolean(device[key]);
              return (
                <label key={key} className={cx("device-option", active && "device-option-active")}>
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => patchDevice({ [key]: event.target.checked })}
                  />
                  <Icon size={20} aria-hidden="true" />
                  <span>{label}</span>
                  <strong>{active ? t("deviceEnabled") : t("deviceDisabled")}</strong>
                </label>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  function renderSettingsHolidays() {
    const visibleHolidays = data.holidays
      .filter((holiday) => holidayYear === "all" || holiday.date.startsWith(holidayYear))
      .sort((a, b) => a.date.localeCompare(b.date));
    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle title={t("holidayInputTitle")} />
          <form
            className="holiday-add-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (holidayDraft.name.trim()) addHoliday();
            }}
          >
            <Field label={t("holidayDateLabel")} compact>
              <input type="date" value={holidayDraft.date} onChange={(event) => setHolidayDraft({ ...holidayDraft, date: event.target.value })} />
            </Field>
            <Field label={t("holidayNameLabel")} compact>
              <input value={holidayDraft.name} onChange={(event) => setHolidayDraft({ ...holidayDraft, name: event.target.value })} />
            </Field>
            <Button icon={Plus} type="submit" disabled={!holidayDraft.name.trim()}>{t("addHoliday")}</Button>
          </form>
        </section>

        <section className="panel">
          <header className="holiday-table-head">
            <strong>{t("holidayTableTitle")}</strong>
            <Field label={t("yearFilterLabel")} compact>
              <select value={holidayYear} onChange={(event) => setHolidayYear(event.target.value)}>
                <option value="all">{t("allYears")}</option>
                {(() => {
                  const baseYear = Number(data.settings.businessDate.slice(0, 4));
                  const years = new Set<string>([
                    ...data.holidays.map((holiday) => holiday.date.slice(0, 4)),
                    ...[0, 1, 2].map((offset) => String(baseYear + offset)),
                  ]);
                  return [...years].sort().map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ));
                })()}
              </select>
            </Field>
          </header>
          {visibleHolidays.length === 0 ? (
            <div className="holiday-empty">{t("noHolidaysHint")}</div>
          ) : (
            <ul className="holiday-rows">
              {visibleHolidays.map((holiday) => (
                <li key={holiday.id} className="holiday-row">
                  <span className="holiday-row-date">{holiday.date}</span>
                  <span className="holiday-row-name">{holiday.name}</span>
                  <button
                    type="button"
                    className="holiday-row-delete"
                    onClick={() => removeHoliday(holiday.id)}
                    aria-label={t("settingListDelete")}
                    title={t("settingListDelete")}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  function renderSettingsLists() {
    const deleteAria = t("settingListDelete");
    const emptyHint = t("settingListEmpty");
    return (
      <div className="view-stack">
        <section className="panel settings-list-panel">
          <header className="settings-list-intro">
            <div>
              <p className="overview-headline-eyebrow">{t("settingsTabLists")}</p>
              <h2>{t("settingMasterListsTitle")}</h2>
              <p>{t("settingMasterListsHint")}</p>
            </div>
          </header>
          <div className="settings-list-groups">
            <section className="settings-list-group">
              <div className="settings-list-group-head">
                <h3>{t("settingProfileListsTitle")}</h3>
                <p>{t("settingProfileListsHint")}</p>
              </div>
              <div className="settings-grid">
                <SettingList
                  title={t("settingListCompanies")}
                  addPlaceholder={t("settingListAddCompany")}
                  items={data.settings.companies}
                  value={newCompany}
                  onValue={setNewCompany}
                  onAdd={() => { addSettingItem("companies", newCompany); setNewCompany(""); }}
                  onEdit={(oldValue, nextValue) => editSettingItem("companies", oldValue, nextValue)}
                  onRemove={(value) => removeSettingItem("companies", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                  editAria={t("settingListEdit")}
                  saveLabel={t("save")}
                  cancelLabel={t("cancel")}
                />
                <SettingList
                  title={t("settingListDepartments")}
                  addPlaceholder={t("settingListAddDepartment")}
                  items={data.settings.departments}
                  value={newDepartment}
                  onValue={setNewDepartment}
                  onAdd={() => { addSettingItem("departments", newDepartment); setNewDepartment(""); }}
                  onEdit={(oldValue, nextValue) => editSettingItem("departments", oldValue, nextValue)}
                  onRemove={(value) => removeSettingItem("departments", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                  editAria={t("settingListEdit")}
                  saveLabel={t("save")}
                  cancelLabel={t("cancel")}
                />
                <SettingList
                  title={t("settingListPositions")}
                  addPlaceholder={t("settingListAddPosition")}
                  items={data.settings.positions}
                  value={newPosition}
                  onValue={setNewPosition}
                  onAdd={() => { addSettingItem("positions", newPosition); setNewPosition(""); }}
                  onEdit={(oldValue, nextValue) => editSettingItem("positions", oldValue, nextValue)}
                  onRemove={(value) => removeSettingItem("positions", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                  editAria={t("settingListEdit")}
                  saveLabel={t("save")}
                  cancelLabel={t("cancel")}
                />
                <SettingList
                  title={t("settingListNationalities")}
                  addPlaceholder={t("settingListAddNationality")}
                  items={data.settings.nationalities}
                  value={newNationality}
                  onValue={setNewNationality}
                  onAdd={() => { addSettingItem("nationalities", newNationality); setNewNationality(""); }}
                  onEdit={(oldValue, nextValue) => editSettingItem("nationalities", oldValue, nextValue)}
                  onRemove={(value) => removeSettingItem("nationalities", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                  editAria={t("settingListEdit")}
                  saveLabel={t("save")}
                  cancelLabel={t("cancel")}
                />
              </div>
            </section>
            <section className="settings-list-group">
              <div className="settings-list-group-head">
                <h3>{t("settingAttendanceListsTitle")}</h3>
                <p>{t("settingAttendanceListsHint")}</p>
              </div>
              <div className="setting-workflow-bridge" aria-label={t("settingWorkflowTitle")}>
                <strong>{t("settingWorkflowTitle")}</strong>
                <span>{t("settingWorkflowSetup")}</span>
                <span>{t("settingWorkflowReview")}</span>
                <span>{t("settingWorkflowPayroll")}</span>
              </div>
              <div className="settings-grid">
                <div className="setting-list-block setting-deduction-amounts setting-deduction-rules">
                  <header className="setting-list-head">
                    <strong>{t("settingDeductionCalculationTitle")}</strong>
                  </header>
                  <p className="setting-list-help">{t("settingDeductionCalculationHint")}</p>
                  <div className="form-grid two">
                    <Field label={t("settingDeductionFullDayAmount")}>
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={data.settings.deductionAmounts.fullDayDeductPerDay}
                        onChange={(event) =>
                          patchDeductionAmountSettings({ fullDayDeductPerDay: Math.max(0, Number(event.target.value) || 0) })
                        }
                      />
                    </Field>
                    <Field label={t("settingDeductionMinuteHourlyRate")}>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={data.settings.deductionAmounts.minuteDeductHourlyRate}
                        onChange={(event) =>
                          patchDeductionAmountSettings({ minuteDeductHourlyRate: Math.max(0, Number(event.target.value) || 0) })
                        }
                      />
                    </Field>
                  </div>
                </div>
                <div className="setting-list-block setting-deduction-amounts setting-deduction-options">
                  <header className="setting-list-head">
                    <strong>{t("settingDeductionAmountOptionsTitle")}</strong>
                  </header>
                  <p className="setting-list-help">{t("settingDeductionAmountOptionsHint")}</p>
                  <div className="deduction-option-manager">
                    <div className="form-grid two deduction-option-add">
                      <Field label={t("settingDeductionAmountOptionName")}>
                        <input
                          value={newDeductionAmountOption.label}
                          onChange={(event) => setNewDeductionAmountOption((current) => ({ ...current, label: event.target.value }))}
                          placeholder={t("settingDeductionAmountOptionNamePlaceholder")}
                        />
                      </Field>
                      <Field label={t("settingDeductionAmountOptionAmount")}>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={newDeductionAmountOption.amount}
                          onChange={(event) => setNewDeductionAmountOption((current) => ({ ...current, amount: event.target.value }))}
                          placeholder="0.00"
                        />
                      </Field>
                      <Button
                        icon={Plus}
                        variant="secondary"
                        disabled={!newDeductionAmountOption.label.trim() || !Number.isFinite(Number(newDeductionAmountOption.amount))}
                        onClick={addDeductionAmountOption}
                      >
                        {t("settingDeductionAmountOptionAdd")}
                      </Button>
                    </div>
                    <ul className="setting-list-rows">
                      {data.settings.deductionAmountOptions.length === 0 ? (
                        <li className="setting-list-empty">{emptyHint}</li>
                      ) : (
                        data.settings.deductionAmountOptions.map((option) => {
                          const editing = editingDeductionAmountOptionId === option.id;
                          return (
                            <li key={option.id} className={cx("setting-list-row deduction-amount-option-row", editing && "deduction-amount-option-row-editing")}>
                              {editing ? (
                                <>
                                  <input
                                    className="setting-list-edit-input"
                                    value={editingDeductionAmountOption.label}
                                    onChange={(event) => setEditingDeductionAmountOption((current) => ({ ...current, label: event.target.value }))}
                                    onKeyDown={(event) => {
                                      if (event.key === "Escape") cancelEditDeductionAmountOption();
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        saveEditDeductionAmountOption();
                                      }
                                    }}
                                    autoFocus
                                  />
                                  <input
                                    className="setting-list-edit-input"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    value={editingDeductionAmountOption.amount}
                                    onChange={(event) => setEditingDeductionAmountOption((current) => ({ ...current, amount: event.target.value }))}
                                    onKeyDown={(event) => {
                                      if (event.key === "Escape") cancelEditDeductionAmountOption();
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        saveEditDeductionAmountOption();
                                      }
                                    }}
                                  />
                                  <span className="setting-list-row-actions">
                                    <button
                                      type="button"
                                      className="setting-list-row-action"
                                      onClick={saveEditDeductionAmountOption}
                                      disabled={!editingDeductionAmountOption.label.trim() || !Number.isFinite(Number(editingDeductionAmountOption.amount))}
                                      aria-label={t("save")}
                                      title={t("save")}
                                    >
                                      <Save size={14} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="setting-list-row-action"
                                      onClick={cancelEditDeductionAmountOption}
                                      aria-label={t("cancel")}
                                      title={t("cancel")}
                                    >
                                      <X size={14} aria-hidden="true" />
                                    </button>
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="setting-list-row-label">{translateDataValue(option.label, lang)}</span>
                                  <strong>{option.amount.toFixed(2)}</strong>
                                  <span className="setting-list-row-actions">
                                    <button
                                      type="button"
                                      className="setting-list-row-action"
                                      onClick={() => startEditDeductionAmountOption(option)}
                                      aria-label={t("settingListEdit")}
                                      title={t("settingListEdit")}
                                    >
                                      <Pencil size={14} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="setting-list-row-delete"
                                      onClick={() => removeDeductionAmountOption(option.id)}
                                      aria-label={t("settingListDelete")}
                                      title={t("settingListDelete")}
                                    >
                                      <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                  </span>
                                </>
                              )}
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                </div>
            <SettingList
              title={t("settingListCorrectionReasons")}
              addPlaceholder={t("settingListAddCorrectionReason")}
              items={data.settings.correctionReasons}
              value={newCorrectionReason}
              onValue={setNewCorrectionReason}
              onAdd={() => { addSettingItem("correctionReasons", newCorrectionReason); setNewCorrectionReason(""); }}
              onEdit={(oldValue, nextValue) => editSettingItem("correctionReasons", oldValue, nextValue)}
              onRemove={(value) => removeSettingItem("correctionReasons", value)}
              renderItem={(item) => translateDataValue(item, lang)}
              emptyHint={emptyHint}
              deleteAria={deleteAria}
              editAria={t("settingListEdit")}
              saveLabel={t("save")}
              cancelLabel={t("cancel")}
            />
            <SettingList
              title={t("settingListDeductionReasons")}
              addPlaceholder={t("settingListAddDeductionReason")}
              items={data.settings.deductionReasons}
              value={newDeductionReason}
              onValue={setNewDeductionReason}
              onAdd={() => { addSettingItem("deductionReasons", newDeductionReason); setNewDeductionReason(""); }}
              onEdit={(oldValue, nextValue) => editSettingItem("deductionReasons", oldValue, nextValue)}
              onRemove={(value) => removeSettingItem("deductionReasons", value)}
              renderItem={(item) => translateDataValue(item, lang)}
              emptyHint={emptyHint}
              deleteAria={deleteAria}
              editAria={t("settingListEdit")}
              saveLabel={t("save")}
              cancelLabel={t("cancel")}
            />
            <div className="setting-list-block">
              <header className="setting-list-head">
                <strong>{t("settingListLeaveTypes")}</strong>
                <span className="setting-list-count">{data.settings.leaveTypes.length}</span>
              </header>
              <p className="setting-list-help">{t("settingLeaveApprovalHint")}</p>
              <ul className="setting-list-rows">
                {data.settings.leaveTypes.length === 0 ? (
                  <li className="setting-list-empty">{emptyHint}</li>
                ) : (
                  data.settings.leaveTypes.map((type) => {
                    const paid = isPaidLeaveType(type, data);
                    const requiresMc = isMcRequiredLeaveType(type, data);
                    return (
                      <li key={type} className="setting-list-row leave-type-row">
                        <span className="setting-list-row-label">{translateDataValue(type, lang)}</span>
                        <span className="pay-rule-toggle" aria-label={t("settingLeavePayRuleAria")}>
                          <button
                            type="button"
                            className={cx(paid && "pay-rule-active")}
                            onClick={() => setLeaveTypePaid(type, true)}
                          >
                            {t("leavePayRulePaid")}
                          </button>
                          <button
                            type="button"
                            className={cx(!paid && "pay-rule-active")}
                            onClick={() => setLeaveTypePaid(type, false)}
                          >
                            {t("leavePayRuleDeduct")}
                          </button>
                        </span>
                        <span className="pay-rule-toggle mc-rule-toggle" aria-label={t("settingLeaveMcRuleAria")}>
                          <button
                            type="button"
                            className={cx(requiresMc && "pay-rule-active")}
                            onClick={() => setLeaveTypeMcRequired(type, true)}
                          >
                            {t("leaveMcRequired")}
                          </button>
                          <button
                            type="button"
                            className={cx(!requiresMc && "pay-rule-active")}
                            onClick={() => setLeaveTypeMcRequired(type, false)}
                          >
                            {t("leaveMcNotRequiredShort")}
                          </button>
                        </span>
                        <button
                          type="button"
                          className="setting-list-row-delete"
                          onClick={() => removeSettingItem("leaveTypes", type)}
                          aria-label={deleteAria}
                          title={deleteAria}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              <form
                className="setting-list-add"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (newLeaveType.trim()) {
                    addSettingItem("leaveTypes", newLeaveType);
                    setNewLeaveType("");
                  }
                }}
              >
                <input value={newLeaveType} onChange={(event) => setNewLeaveType(event.target.value)} placeholder={t("settingListAddLeaveType")} />
                <Button icon={Plus} type="submit" disabled={!newLeaveType.trim()} />
              </form>
            </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    );
  }

  function renderSettingsData() {
    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle title={t("localDataTitle")} />
          <div className="backup-actions">
            <Button icon={Database} onClick={exportBackup}>{t("backupJson")}</Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void restoreBackup(file);
                event.currentTarget.value = "";
              }}
            />
            <Button icon={Upload} variant="secondary" onClick={() => restoreInputRef.current?.click()}>{t("restoreJson")}</Button>
            <Button icon={RefreshCcw} variant="ghost" onClick={resetSampleData}>{t("resetSample")}</Button>
          </div>
        </section>
      </div>
    );
  }
}

function SettingList({
  title,
  items,
  value,
  onValue,
  onAdd,
  onEdit,
  onRemove,
  renderItem,
  addPlaceholder,
  emptyHint,
  deleteAria,
  editAria,
  saveLabel,
  cancelLabel,
}: {
  title: string;
  items: string[];
  value: string;
  onValue: (value: string) => void;
  onAdd: () => void;
  onEdit: (oldValue: string, nextValue: string) => void;
  onRemove: (value: string) => void;
  renderItem?: (item: string) => string;
  addPlaceholder: string;
  emptyHint: string;
  deleteAria: string;
  editAria: string;
  saveLabel: string;
  cancelLabel: string;
}) {
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const startEdit = (item: string) => {
    setEditingItem(item);
    setEditingValue(item);
  };
  const cancelEdit = () => {
    setEditingItem(null);
    setEditingValue("");
  };
  const saveEdit = () => {
    if (!editingItem || !editingValue.trim()) return;
    onEdit(editingItem, editingValue);
    cancelEdit();
  };
  return (
    <div className="setting-list-block">
      <header className="setting-list-head">
        <strong>{title}</strong>
        <span className="setting-list-count">{items.length}</span>
      </header>
      <ul className="setting-list-rows">
        {items.length === 0 ? (
          <li className="setting-list-empty">{emptyHint}</li>
        ) : (
          items.map((item) => {
            const editing = editingItem === item;
            return (
              <li key={item} className={cx("setting-list-row", editing && "setting-list-row-editing")}>
                {editing ? (
                  <>
                    <input
                      className="setting-list-edit-input"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelEdit();
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveEdit();
                        }
                      }}
                      autoFocus
                    />
                    <span className="setting-list-row-actions">
                      <button
                        type="button"
                        className="setting-list-row-action"
                        onClick={saveEdit}
                        disabled={!editingValue.trim()}
                        aria-label={saveLabel}
                        title={saveLabel}
                      >
                        <Save size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="setting-list-row-action"
                        onClick={cancelEdit}
                        aria-label={cancelLabel}
                        title={cancelLabel}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="setting-list-row-label">{renderItem ? renderItem(item) : item}</span>
                    <span className="setting-list-row-actions">
                      <button
                        type="button"
                        className="setting-list-row-action"
                        onClick={() => startEdit(item)}
                        aria-label={editAria}
                        title={editAria}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="setting-list-row-delete"
                        onClick={() => onRemove(item)}
                        aria-label={deleteAria}
                        title={deleteAria}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </span>
                  </>
                )}
              </li>
            );
          })
        )}
      </ul>
      <form
        className="setting-list-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onAdd();
        }}
      >
        <input
          value={value}
          onChange={(event) => onValue(event.target.value)}
          placeholder={addPlaceholder}
        />
        <Button icon={Plus} type="submit" disabled={!value.trim()} />
      </form>
    </div>
  );
}

function buildReport(
  reportType: ReportId,
  records: AttendanceRecord[],
  employees: Employee[],
  data: AppData,
  month: string,
  selectedEmployeeId: string,
  lang: Lang = "zh",
): { title: string; columns: string[]; rows: Array<Record<string, string | number>> } {
  const tr = (key: keyof typeof dict.zh): string => dict[lang][key] ?? dict.zh[key];

  if (reportType === "summary") {
    const colNo = tr("rcEmployeeNo");
    const colName = tr("rcName");
    const colDept = tr("rcDepartment");
    const colShift = tr("rcShift");
    const colWorkDays = tr("rcWorkDays");
    const colAttendDays = tr("rcAttendDays");
    const colAbsent = tr("rcAbsent");
    const colLateMins = tr("rcLateMins");
    const colLateTimes = tr("rcLateTimes");
    const colEarlyMins = tr("rcEarlyMins");
    const colEarlyTimes = tr("rcEarlyTimes");
    const colOTHours = tr("rcOTHours");
    const columns = [colNo, colName, colDept, colShift, colWorkDays, colAttendDays, colAbsent, colLateMins, colLateTimes, colEarlyMins, colEarlyTimes, colOTHours];
    const rows = employees.map((employee) => {
      const summary = summarizeEmployee(data, employee, month);
      const employeeRecords = records.filter((record) => record.employee.id === employee.id);
      const shift = data.shifts.find((item) => item.id === employee.shiftId);
      const scheduledDays = employeeRecords.filter((record) => !["rest", "holiday", "scheduled"].includes(record.status)).length;
      const attendedDays = Math.max(0, scheduledDays - summary.absentDays);
      const lateMinutes = employeeRecords.reduce((sum, record) => sum + record.lateMinutes, 0);
      const earlyMinutes = employeeRecords.reduce((sum, record) => sum + record.earlyMinutes, 0);
      return {
        [colNo]: employee.enrollNo,
        [colName]: displayEmployeeName(employee),
        [colDept]: translateDataValue(employee.department, lang),
        [colShift]: shift ? translateDataValue(shift.name, lang) : "-",
        [colWorkDays]: scheduledDays,
        [colAttendDays]: attendedDays,
        [colAbsent]: summary.absentDays,
        [colLateMins]: formatDuration(lateMinutes, lang),
        [colLateTimes]: summary.lateCount,
        [colEarlyMins]: formatDuration(earlyMinutes, lang),
        [colEarlyTimes]: summary.earlyCount,
        [colOTHours]: formatHours(summary.overtimeMinutes),
      };
    });
    return { title: tr("reportSummaryTitle"), columns, rows };
  }

  if (reportType === "punchGrid") {
    const days = monthDates(month);
    const dayColumns = days.map((date) => String(Number(date.slice(-2))));
    const colNo = tr("rcEmployeeNo");
    const colName = tr("rcName");
    const colDept = tr("rcDepartment");
    const colShift = tr("rcShift");
    const columns = [colNo, colName, colDept, colShift, ...dayColumns];
    const rows = employees.map((employee) => {
      const shift = data.shifts.find((item) => item.id === employee.shiftId);
      const row: Record<string, string | number> = {
        [colNo]: employee.enrollNo,
        [colName]: displayEmployeeName(employee),
        [colDept]: translateDataValue(employee.department, lang),
        [colShift]: shift ? translateDataValue(shift.name, lang) : "-",
      };
      days.forEach((date, index) => {
        const record = records.find((item) => item.employee.id === employee.id && item.date === date);
        const dayLabel = dayColumns[index];
        row[dayLabel] = punchGridCellText(record, lang);
      });
      return row;
    });
    return { title: tr("reportPunchGridTitle"), columns, rows };
  }

  if (reportType === "personal") {
    const employeeRecords = records.filter((record) => record.employee.id === selectedEmployeeId);
    const colDate = tr("rcDate");
    const colWeekday = tr("rcWeekday");
    const colS1In = tr("rcSection1In");
    const colS1Out = tr("rcSection1Out");
    const colS2In = tr("rcSection2In");
    const colS2Out = tr("rcSection2Out");
    const colS3In = tr("rcSection3In");
    const colS3Out = tr("rcSection3Out");
    const colStatus = tr("rcStatus");
    const colNotes = tr("rcNotes");
    const columns = [colDate, colWeekday, colS1In, colS1Out, colS2In, colS2Out, colS3In, colS3Out, colStatus, colNotes];
    const rows = employeeRecords.map((record) => ({
      [colDate]: record.date,
      [colWeekday]: weekdayLabels[lang][record.weekday],
      [colS1In]: recordPunchTime(record, "in", lang),
      [colS1Out]: recordPunchTime(record, "breakOut", lang),
      [colS2In]: recordPunchTime(record, "breakIn", lang),
      [colS2Out]: recordPunchTime(record, "out", lang),
      [colS3In]: "",
      [colS3Out]: "",
      [colStatus]: statusLabels[lang][record.status],
      [colNotes]: formatFlags(record.flags, lang),
    }));
    return { title: tr("reportPersonalTitle"), columns, rows };
  }

  if (reportType === "lateEarly") {
    const colDate = tr("rcDate");
    const colNo = tr("rcEmployeeNo");
    const colName = tr("rcName");
    const colDept = tr("rcDepartment");
    const colShift = tr("rcShift");
    const colLate = tr("rcLate");
    const colEarly = tr("rcEarly");
    const colNotes = tr("rcNotes");
    const columns = [colDate, colNo, colName, colDept, colShift, colLate, colEarly, colNotes];
    const rows = records
      .filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0)
      .map((record) => ({
        [colDate]: record.date,
        [colNo]: record.employee.enrollNo,
        [colName]: displayEmployeeName(record.employee),
        [colDept]: translateDataValue(record.employee.department, lang),
        [colShift]: record.shift?.name ? translateDataValue(record.shift.name, lang) : "-",
        [colLate]: formatDuration(record.lateMinutes, lang),
        [colEarly]: formatDuration(record.earlyMinutes, lang),
        [colNotes]: formatFlags(record.flags, lang),
      }));
    return { title: tr("reportLateEarlyTitle"), columns, rows };
  }

  if (reportType === "leave") {
    const colDate = tr("rcDate");
    const colNo = tr("rcEmployeeNo");
    const colName = tr("rcName");
    const colDept = tr("rcDepartment");
    const colLeaveType = tr("rcLeaveType");
    const colLeaveHours = tr("rcLeaveHours");
    const colMcStatus = tr("leaveMcStatusLabel");
    const colMcAttachment = tr("leaveMcAttachmentLabel");
    const colApprovalStatus = tr("leaveApprovalStatusLabel");
    const colNote = tr("rcNote");
    const columns = [colDate, colNo, colName, colDept, colLeaveType, colLeaveHours, colMcStatus, colMcAttachment, colApprovalStatus, colNote];
    const rows = data.leaves
      .filter((leave) => employees.some((employee) => employee.id === leave.employeeId) && leave.date.startsWith(month))
      .map((leave) => {
        const employee = data.employees.find((item) => item.id === leave.employeeId)!;
        const mcStatus = resolvedLeaveMcStatus(leave, data);
        const approvalStatus = resolvedLeaveApprovalStatus(leave);
        return {
          [colDate]: leave.date,
          [colNo]: employee.enrollNo,
          [colName]: displayEmployeeName(employee),
          [colDept]: translateDataValue(employee.department, lang),
          [colLeaveType]: translateDataValue(leave.type, lang),
          [colLeaveHours]: leave.hours,
          [colMcStatus]: dict[lang][
            mcStatus === "provided"
              ? "leaveMcProvided"
              : mcStatus === "notProvided"
                ? "leaveMcNotProvided"
                : mcStatus === "pending"
                  ? "leaveMcPending"
                  : "leaveMcNotRequired"
          ],
          [colMcAttachment]: leave.mcAttachment ? leave.mcAttachment.name : dict[lang].leaveMcAttachmentMissing,
          [colApprovalStatus]: dict[lang][
            approvalStatus === "approved"
              ? "leaveApprovalApproved"
              : approvalStatus === "rejected"
                ? "leaveApprovalRejected"
                : "leaveApprovalPending"
          ],
          [colNote]: leave.note,
        };
      });
    return { title: tr("reportLeaveTitle"), columns, rows };
  }

  if (reportType === "overtime") {
    const colDate = tr("rcDate");
    const colNo = tr("rcEmployeeNo");
    const colName = tr("rcName");
    const colDept = tr("rcDepartment");
    const colShift = tr("rcShift");
    const colOut = tr("rcOut");
    const colOT = tr("rcOT");
    const columns = [colDate, colNo, colName, colDept, colShift, colOut, colOT];
    const rows = records
      .filter((record) => record.overtimeMinutes > 0)
      .map((record) => ({
        [colDate]: record.date,
        [colNo]: record.employee.enrollNo,
        [colName]: displayEmployeeName(record.employee),
        [colDept]: translateDataValue(record.employee.department, lang),
        [colShift]: record.shift?.name ? translateDataValue(record.shift.name, lang) : "-",
        [colOut]: recordPunchTime(record, "out", lang),
        [colOT]: formatDuration(record.overtimeMinutes, lang),
      }));
    return { title: tr("reportOvertimeTitle"), columns, rows };
  }

  if (reportType === "absent") {
    const colDate = tr("rcDate");
    const colNo = tr("rcEmployeeNo");
    const colName = tr("rcName");
    const colDept = tr("rcDepartment");
    const colShift = tr("rcShift");
    const colStatus = tr("rcStatus");
    const columns = [colDate, colNo, colName, colDept, colShift, colStatus];
    const rows = records
      .filter((record) => record.status === "absent")
      .map((record) => ({
        [colDate]: record.date,
        [colNo]: record.employee.enrollNo,
        [colName]: displayEmployeeName(record.employee),
        [colDept]: translateDataValue(record.employee.department, lang),
        [colShift]: record.shift?.name ? translateDataValue(record.shift.name, lang) : "-",
        [colStatus]: statusLabels[lang][record.status],
      }));
    return { title: tr("reportAbsentTitle"), columns, rows };
  }

  const colRawNo = tr("employeePunchNo");
  const colMachineNo = tr("employeePunchMachineNo");
  const colNo = tr("employeePunchEnrollNo");
  const colName = tr("employeePunchName");
  const colKind = tr("employeePunchType");
  const colInout = tr("employeePunchInoutCode");
  const colMode = tr("employeePunchMode");
  const colDateTime = tr("employeePunchDateTime");
  const columns = [colRawNo, colMachineNo, colNo, colName, colKind, colInout, colMode, colDateTime];
  const inoutCodeForKind: Record<PunchKind, string> = { in: "0", breakOut: "2", breakIn: "3", out: "1" };
  const rows = data.punches
    .filter((punch) => punch.date.startsWith(month))
    .filter((punch) => employees.some((employee) => employee.id === punch.employeeId))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map((punch, index) => {
      const employee = data.employees.find((item) => item.id === punch.employeeId)!;
      return {
        [colRawNo]: punch.rawNo || index + 1,
        [colMachineNo]: punch.machineNo || "-",
        [colNo]: punch.deviceEnrollNo || employee.enrollNo,
        [colName]: punch.deviceName || displayEmployeeName(employee),
        [colKind]: punchKindLabels[lang][punch.kind],
        [colInout]: punch.inoutCode || inoutCodeForKind[punch.kind],
        [colMode]: punch.verifyMode || (punch.source === "manual" ? tr("employeePunchModeManual") : "-"),
        [colDateTime]: punch.rawDateTime || `${punch.date} ${punch.time}`,
      };
    });
  return { title: tr("reportRawTitle"), columns, rows };
}

export default App;
