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
  FileSpreadsheet,
  Fingerprint,
  KeyRound,
  ListFilter,
  LockKeyhole,
  LogOut,
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
  DEFAULT_PAID_LEAVE_TYPES,
  displayEmployeeName,
  findShiftForPunch,
  formatDuration,
  formatFlags,
  formatHours,
  getMonthlyReadiness,
  getRecordsForMonth,
  getWeekday,
  isAutoShiftCandidate,
  isPaidLeaveType,
  makePunchId,
  monthDates,
  minutesFromTime,
  normalizeShiftRules,
  parsePunchKind,
  payrollFor,
  punchDateForAttendanceTime,
  punchKindLabels,
  statusLabels,
  summarizeEmployee,
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
import type {
  AppData,
  AttendanceReview,
  AttendanceRecord,
  DaySchedule,
  Employee,
  Gender,
  LeaveEntry,
  Punch,
  PunchKind,
  Shift,
  TimecardCorrectionAudit,
  TimecardCorrectionAuditPunch,
  Weekday,
} from "./types";

const STORAGE_KEY = "tms-hr-prototype-state-v2";
const SESSION_KEY = "tms-hr-prototype-session-v1";
const VIEW_STORAGE_KEY = "tms-hr-active-view-v1";
const MONTH_STAGE_STORAGE_KEY = "tms-hr-month-stage-v1";
const FOCUS_EMPLOYEE_KEY = "tms-hr-focus-employee-v1";

type ViewId = "thisMonth" | "employees" | "reports" | "settings";
type MonthStage = "home" | "import" | "timecards" | "leave" | "payroll";
type ConditionWorkMode = "fixed" | "auto" | "flexible";
type EmployeeStatusFilter = "all" | "active" | "inactive";

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
  return { ...raw, type: normalizeDataValue(raw.type), note: normalizeDataValue(raw.note) };
}

function hydratePunch(raw: Punch): Punch {
  return { ...raw, note: normalizeDataValue(raw.note) };
}

function hydrateAttendanceReview(raw: AttendanceReview): AttendanceReview {
  return { ...raw, note: normalizeDataValue(raw.note) };
}

function hydrateTimecardCorrectionAudit(raw: TimecardCorrectionAudit): TimecardCorrectionAudit {
  return { ...raw, reason: normalizeDataValue(raw.reason) };
}

function hydrateData(raw: AppData): AppData {
  const leaveTypes = normalizeDataList(raw.settings.leaveTypes);
  const paidLeaveTypes = normalizeDataList(raw.settings.paidLeaveTypes);
  const seed = createSeedData();
  const positions = buildPositionList(raw, seed);
  const nationalities = buildNationalityList(raw, seed);
  const correctionReasons = buildCorrectionReasonList(raw, seed);
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
    punches: raw.punches.map(hydratePunch),
    attendanceReviews: (raw.attendanceReviews ?? []).map(hydrateAttendanceReview),
    timecardCorrectionAudits: (raw.timecardCorrectionAudits ?? []).map(hydrateTimecardCorrectionAudit),
    settings: {
      ...raw.settings,
      departments: normalizeDataList(raw.settings.departments),
      positions,
      nationalities,
      leaveTypes,
      paidLeaveTypes: paidLeaveTypes.length ? paidLeaveTypes : DEFAULT_PAID_LEAVE_TYPES.filter((type) => leaveTypes.includes(type)),
      correctionReasons,
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
type TimecardStatusFilter = "all" | "absent" | "incomplete" | "shortHours" | "lateEarly";

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
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dataUrlRows(columns: string[], rows: Array<Record<string, string | number>>) {
  return "\uFEFF" + [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
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
  const [activeView, setActiveView] = useState<ViewId>(() => {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return (VIEW_IDS as ReadonlyArray<string>).includes(stored ?? "") ? (stored as ViewId) : "thisMonth";
  });
  const [monthStage, setMonthStage] = useState<MonthStage>(() => {
    const stored = window.localStorage.getItem(MONTH_STAGE_STORAGE_KEY);
    return (MONTH_STAGES as ReadonlyArray<string>).includes(stored ?? "") ? (stored as MonthStage) : "home";
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("shifts");
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
  const [timecardPage, setTimecardPage] = useState(1);
  const [timecardPageSize, setTimecardPageSize] = useState(10);
  const [timecardDetailOpen, setTimecardDetailOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reportType, setReportType] = useState<ReportId>("summary");
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
  const [leaveDraft, setLeaveDraft] = useState({
    employeeId: selectedEmployeeId,
    date: data.settings.businessDate,
    type: data.settings.leaveTypes[0] ?? "Annual leave",
    hours: 8,
    note: "",
  });
  const [otSimEmployeeId, setOtSimEmployeeId] = useState(selectedEmployeeId);
  const [otSimDate, setOtSimDate] = useState(data.settings.businessDate);
  const [otSimClockOut, setOtSimClockOut] = useState("23:00");
  const [correctionReason, setCorrectionReason] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const initialDataRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);

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
    window.localStorage.setItem(VIEW_STORAGE_KEY, activeView);
  }, [activeView]);

  useEffect(() => {
    window.localStorage.setItem(MONTH_STAGE_STORAGE_KEY, monthStage);
  }, [monthStage]);

  useEffect(() => {
    if (selectedEmployeeId) window.localStorage.setItem(FOCUS_EMPLOYEE_KEY, selectedEmployeeId);
  }, [selectedEmployeeId]);

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
    openThisMonth("timecards");
  }

  function openTimecardDetail(employeeId: string, date: string) {
    setSelectedEmployeeId(employeeId);
    setSelectedDate(date);
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
  const t = useMemo(() => makeT(lang), [lang]);

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

  function buildConditionPatchFromDraft(): Partial<Employee> {
    const flexibleWork = bulkConditionDraft.workMode === "flexible";
    return {
      shiftId: bulkConditionDraft.shiftId || (data.shifts[0]?.id ?? ""),
      autoShift: bulkConditionDraft.workMode === "auto" && !flexibleWork,
      flexibleWork,
      workLengthHours: bulkConditionDraft.workLengthHours,
      flexibleLunch: bulkConditionDraft.flexibleLunch,
      lunchMinutes: bulkConditionDraft.lunchMinutes,
      graceMinutes: bulkConditionDraft.graceMinutes,
      exemptions: { ...bulkConditionDraft.exemptions },
    };
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
    const currentRecord = calculateAttendance(data, selectedEmployee, selectedDate);
    const kinds: PunchKind[] = ["in", "breakOut", "breakIn", "out"];
    const nextPunches = kinds
      .filter((kind) => punchTimes[kind])
      .map<Punch>((kind) => ({
        id: makePunchId(selectedEmployee.id, selectedDate, kind),
        employeeId: selectedEmployee.id,
        date: punchDateForAttendanceTime(selectedDate, currentRecord.schedule, kind, punchTimes[kind]),
        time: punchTimes[kind],
        kind,
        source: "manual",
        note: reason,
      }));
    const currentRecordPunchIds = new Set(currentRecord.punches.map((punch) => punch.id));
    const beforePunches = auditPunchSnapshot(currentRecord.punches);
    const afterPunches = auditPunchSnapshot(nextPunches);
    const audit: TimecardCorrectionAudit = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      employeeId: selectedEmployee.id,
      date: selectedDate,
      action: "save",
      actor: t("timecardAuditActorHr"),
      reason,
      changedAt: new Date().toISOString(),
      beforePunches,
      afterPunches,
    };

    const nextData = {
      ...data,
      punches: [
        ...data.punches.filter((punch) => {
          if (punch.employeeId !== selectedEmployee.id) return true;
          return !currentRecordPunchIds.has(punch.id);
        }),
        ...nextPunches,
      ],
      attendanceReviews: (data.attendanceReviews ?? []).filter((review) => {
        return !(review.employeeId === selectedEmployee.id && review.date === selectedDate && review.kind === "shortHours");
      }),
      timecardCorrectionAudits: [...(data.timecardCorrectionAudits ?? []), audit],
    };
    const nextRecord = calculateAttendance(nextData, selectedEmployee, selectedDate);
    const stillPending =
      nextRecord.status === "absent" ||
      nextRecord.status === "incomplete" ||
      nextRecord.lateMinutes > 0 ||
      nextRecord.earlyMinutes > 0 ||
      nextRecord.overtimeMinutes > 0 ||
      nextRecord.flags.some((flag) => flag.kind === "lunchOver" || flag.kind === "underWork");

    setData(nextData);
    showSavedToast(stillPending ? t("timecardSavedStillPending") : t("timecardSavedResolved"));
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
    const currentRecord = calculateAttendance(data, selectedEmployee, selectedDate);
    const currentRecordPunchIds = new Set(currentRecord.punches.map((punch) => punch.id));
    const audit: TimecardCorrectionAudit = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      employeeId: selectedEmployee.id,
      date: selectedDate,
      action: "clear",
      actor: t("timecardAuditActorHr"),
      reason,
      changedAt: new Date().toISOString(),
      beforePunches: auditPunchSnapshot(currentRecord.punches),
      afterPunches: [],
    };
    setData((current) => ({
      ...current,
      punches: current.punches.filter((punch) => {
        if (punch.employeeId !== selectedEmployee.id) return true;
        return !currentRecordPunchIds.has(punch.id);
      }),
      timecardCorrectionAudits: [...(current.timecardCorrectionAudits ?? []), audit],
    }));
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

  function addLeave() {
    if (!leaveDraft.employeeId || !leaveDraft.date || !leaveDraft.type) return;
    const leave: LeaveEntry = {
      id: `leave-${Date.now()}`,
      employeeId: leaveDraft.employeeId,
      date: leaveDraft.date,
      type: leaveDraft.type,
      hours: Number(leaveDraft.hours) || 8,
      note: leaveDraft.note,
    };
    setData((current) => ({ ...current, leaves: [...current.leaves, leave] }));
    setLeaveDraft({ ...leaveDraft, note: "" });
  }

  function removeLeave(id: string) {
    setData((current) => ({ ...current, leaves: current.leaves.filter((leave) => leave.id !== id) }));
  }

  function addSettingItem(kind: "companies" | "departments" | "positions" | "nationalities" | "leaveTypes" | "correctionReasons", value: string) {
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

  function removeSettingItem(kind: "companies" | "departments" | "positions" | "nationalities" | "leaveTypes" | "correctionReasons", value: string) {
    const clean = kind === "companies" ? value : normalizeDataValue(value);
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [kind]: current.settings[kind].filter((item) => item !== clean),
        ...(kind === "leaveTypes"
          ? { paidLeaveTypes: current.settings.paidLeaveTypes.filter((item) => item !== clean) }
          : {}),
      },
    }));
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

  const report = useMemo(() => buildReport(reportType, filteredRecords, filteredEmployees, data, selectedMonth, selectedEmployeeId, lang), [
    data,
    filteredEmployees,
    filteredRecords,
    lang,
    reportType,
    selectedEmployeeId,
    selectedMonth,
  ]);

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
      <aside className="rail">
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
            aria-label={mobileMenuOpen ? t("mobileMenuClose") : t("mobileMenuOpen")}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            <span>{activeNavLabel}</span>
          </button>
        </div>

        <div className={cx("mobile-menu-panel", mobileMenuOpen && "mobile-menu-open")}>
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
            value={actionableOvertimeHours === "-" ? "—" : `${actionableOvertimeHours} h`}
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
    const importExceptions = monthRecords
      .filter((record) => record.status === "absent" || record.status === "incomplete" || record.lateMinutes > 0 || record.earlyMinutes > 0 || record.overtimeMinutes > 0 || record.flags.some((f) => f.kind === "lunchOver" || f.kind === "underWork"))
      .slice(0, 10);
    const recentPunches = [...data.punches]
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
      .slice(0, 14);

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
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("colDate")}</th>
                  <th>{t("colEmployee")}</th>
                  <th>{t("colShift")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colNotes")}</th>
                </tr>
              </thead>
              <tbody>
                {importExceptions.map((record) => (
                  <tr
                    key={`${record.employee.id}-${record.date}`}
                    onClick={() => {
                      setSelectedEmployeeId(record.employee.id);
                      setSelectedDate(record.date);
                      setTimecardDetailOpen(true);
                      openThisMonth("timecards");
                    }}
                  >
                    <td>{record.date}</td>
                    <td>{record.employee.enrollNo} · {displayEmployeeName(record.employee)}</td>
                    <td>{record.shift ? translateDataValue(record.shift.name, lang) : "-"}</td>
                    <td><span className={statusClass(record.status)}>{statusLabels[lang][record.status]}</span></td>
                    <td>{formatFlags(record.flags, lang)}</td>
                  </tr>
                ))}
                {importExceptions.length === 0 ? <tr><td colSpan={5} className="empty-cell">{t("noExceptionsAfterImport")}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionTitle title={t("recentPunchLogs")} />
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
              </tbody>
            </table>
          </div>
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
          <div className={cx("bulk-condition-panel", !bulkSetupOpen && bulkSelectedEmployeeIds.length === 0 && "bulk-condition-panel-collapsed")} aria-label={t("bulkConditionsTitle")}>
            <div className="bulk-condition-head">
              <div>
                <strong>{t("bulkConditionsTitle")}</strong>
                <span>{t("bulkSelectedCount", { count: bulkSelectedEmployeeIds.length })}</span>
              </div>
              <div className="inline-actions">
                <Button icon={Settings2} variant="ghost" onClick={() => setBulkSetupOpen((open) => !open)}>
                  {bulkSetupOpen || bulkSelectedEmployeeIds.length > 0 ? t("hideBulkSetup") : t("showBulkSetup")}
                </Button>
                <Button
                  icon={CheckCircle2}
                  variant="secondary"
                  onClick={() => setBulkSelectionFor(visibleEmployeeIds, !allVisibleSelected)}
                  disabled={visibleEmployeeIds.length === 0}
                >
                  {allVisibleSelected ? t("bulkClearVisible") : t("bulkSelectVisible")}
                </Button>
                <Button
                  icon={Save}
                  onClick={applyBulkConditions}
                  disabled={bulkSelectedEmployeeIds.length === 0}
                >
                  {t("bulkApplyConditions")}
                </Button>
              </div>
            </div>
            {bulkSetupOpen || bulkSelectedEmployeeIds.length > 0 ? (
              <>
                <div className="bulk-condition-grid">
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
                  <Field label={t("shiftLabel")} compact>
                    <select
                      value={bulkConditionDraft.shiftId}
                      onChange={(event) => setBulkConditionDraft((current) => ({ ...current, shiftId: event.target.value }))}
                    >
                      {data.shifts.map((shift) => <option key={shift.id} value={shift.id}>{translateDataValue(shift.name, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("employeeWorkLengthLabel")} compact>
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      value={bulkConditionDraft.workLengthHours}
                      disabled={bulkConditionDraft.workMode !== "flexible"}
                      onChange={(event) => setBulkConditionDraft((current) => ({ ...current, workLengthHours: Number(event.target.value) }))}
                    />
                  </Field>
                  <Field label={t("employeeGraceMinutesLabel")} compact>
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={bulkConditionDraft.graceMinutes}
                      onChange={(event) => setBulkConditionDraft((current) => ({ ...current, graceMinutes: Number(event.target.value) }))}
                    />
                  </Field>
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
              </>
            ) : null}
          </div>
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
                  return (
                    <tr
                      key={employee.id}
                      className="entity-row"
                      onClick={() => {
                        setSelectedEmployeeId(employee.id);
                        setEmployeeListMode(false);
                      }}
                    >
                      <td className="select-cell" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={t("selectEmployeeAria", { name: displayEmployeeName(employee) || employee.enrollNo })}
                          checked={bulkSelectedEmployeeIds.includes(employee.id)}
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
    const inoutCodeForKind: Record<PunchKind, string> = { in: "0", breakOut: "2", breakIn: "3", out: "1" };
    const employeePunchLog = data.punches
      .filter((punch) => punch.employeeId === selectedEmployee.id && punch.date.startsWith(selectedMonth))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const employeeMonthRecords = monthDates(selectedMonth).map((date) => calculateAttendance(data, selectedEmployee, date));
    const employeeWarningRecords = monthlyReadiness.hasOperationalData ? employeeMonthRecords.filter((record) => {
      const unpaidLeave = Boolean(record.leave && !isPaidLeaveType(record.leave.type, data));
      const attentionFlag = record.flags.some((flag) =>
        ["late", "early", "ot", "lunchOver", "underWork", "noRecord", "noShift", "missingPunch", "holidayWork", "restDayWork"].includes(flag.kind),
      );
      return record.status === "absent" || record.status === "incomplete" || attentionFlag || unpaidLeave;
    }) : [];
    const employeeWarningCounts = {
      missing: employeeWarningRecords.filter((record) => record.status === "incomplete" || record.flags.some((flag) => flag.kind === "missingPunch" || flag.kind === "noShift")).length,
      absent: employeeWarningRecords.filter((record) => record.status === "absent").length,
      shortHours: employeeWarningRecords.filter((record) => record.flags.some((flag) => flag.kind === "underWork")).length,
      lateEarly: employeeWarningRecords.filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0).length,
      lunch: employeeWarningRecords.filter((record) => record.flags.some((flag) => flag.kind === "lunchOver")).length,
      ot: employeeWarningRecords.filter((record) => record.overtimeMinutes > 0 || record.flags.some((flag) => flag.kind === "ot")).length,
      unpaidLeave: employeeWarningRecords.filter((record) => record.leave && !isPaidLeaveType(record.leave.type, data)).length,
    };
    const employeeWarningTotal = Object.values(employeeWarningCounts).reduce((sum, count) => sum + count, 0);
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
            <SectionTitle title={t("empGroupAttendance")} />
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
          </section>

          <section className="panel">
            <SectionTitle title={t("empGroupSalary")} />
            <div className="form-grid three">
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
              ) : null}
              <Field label={t("salaryHourlyRate")}>
                <input type="number" min="0" step="0.5" value={selectedEmployee.salary.hourlyRate} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, hourlyRate: Number(event.target.value) } })} />
              </Field>
              <Field label={t("salaryOtMultiplier")}>
                <input type="number" min="1" step="0.1" value={selectedEmployee.salary.otMultiplier} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, otMultiplier: Number(event.target.value) } })} />
              </Field>
              <Field label={t("salaryLeaveDeduct")}>
                <input type="number" min="0" step="10" value={selectedEmployee.salary.leaveDeductPerDay} onChange={(event) => patchEmployee(selectedEmployee.id, { salary: { ...selectedEmployee.salary, leaveDeductPerDay: Number(event.target.value) } })} />
              </Field>
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
                  <div className="payroll-preview-grid">
                    <div><span>{t("payrollPreviewWorkHours")}</span><strong>{pay.workHours.toFixed(2)}h</strong></div>
                    <div><span>{t("payrollPreviewPaidLeaveHours")}</span><strong>{pay.summary.paidLeaveHours.toFixed(2)}h</strong></div>
                    <div><span>{t("payrollPreviewOtHours")}</span><strong>{pay.otHours.toFixed(2)}h</strong></div>
                    <div><span>{t("payrollPreviewLeaveDays")}</span><strong>{pay.summary.leaveDays}</strong></div>
                    <div><span>{t("payrollColAbsentDays")}</span><strong>{pay.summary.absentDays}</strong></div>
                    <div><span>{t("payrollPreviewDeductibleLeaveDays")}</span><strong>{pay.summary.deductibleLeaveDays}</strong></div>
                    <div><span>{t("payrollPreviewBase")}</span><strong>{fmt(pay.base)}</strong></div>
                    <div><span>{t("payrollPreviewOtPay")}</span><strong>{fmt(pay.otPay)}</strong></div>
                    <div><span>{t("payrollColShortHoursDeduct")}</span><strong>−{fmt(pay.shortHoursDeduct)}</strong></div>
                    <div><span>{t("payrollColTotalDeduct")}</span><strong>−{fmt(pay.totalDeduct)}</strong></div>
                    <div className="payroll-preview-gross"><span>{t("payrollPreviewGross")}</span><strong>{fmt(pay.gross)}</strong></div>
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
            <div className="employee-warning-summary">
              {[
                { label: t("metricMissingPunch"), value: employeeWarningCounts.missing, tone: "warn" },
                { label: t("metricAbsentDays"), value: employeeWarningCounts.absent, tone: "bad" },
                { label: t("metricShortHours"), value: employeeWarningCounts.shortHours, tone: "warn" },
                { label: t("metricLateEarly"), value: employeeWarningCounts.lateEarly, tone: "warn" },
                { label: t("metricLunchOver"), value: employeeWarningCounts.lunch, tone: "warn" },
                { label: t("payrollOtWarnings"), value: employeeWarningCounts.ot, tone: "good" },
                { label: t("payrollColUnpaidLeaveDays"), value: employeeWarningCounts.unpaidLeave, tone: "bad" },
              ].map((item) => (
                <div className={cx("employee-warning-tile", item.value > 0 && `employee-warning-tile-${item.tone}`)} key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
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
                  </tr>
                </thead>
                <tbody>
                  {employeeWarningRecords.slice(0, 12).map((record) => (
                    <tr key={`${record.employee.id}-${record.date}`}>
                      <td>{record.date}</td>
                      <td><span className={statusClass(record.status)}>{statusLabels[lang][record.status]}</span></td>
                      <td>{formatFlags(record.flags, lang)}</td>
                      <td>{recordPunchTime(record, "in", lang) || "-"}</td>
                      <td>{recordPunchTime(record, "out", lang) || "-"}</td>
                      <td>{formatHours(record.workMinutes)}</td>
                    </tr>
                  ))}
                  {employeeWarningRecords.length === 0 ? (
                    <tr><td colSpan={6} className="empty-cell">{monthlyReadiness.hasOperationalData ? t("employeeWarningsEmpty") : t("employeeWarningsNoData")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {employeeWarningRecords.length > 12 ? (
              <p className="panel-caption muted">{t("employeeWarningsMore", { count: employeeWarningRecords.length - 12 })}</p>
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
    const hasOperationalData = data.punches.some((punch) => punch.date.startsWith(selectedMonth)) || data.leaves.some((leave) => leave.date.startsWith(selectedMonth));
    const pendingRecords = hasOperationalData
      ? monthRecords
          .filter((record) => record.status === "absent" || record.status === "incomplete" || record.lateMinutes > 0 || record.earlyMinutes > 0 || record.flags.some((f) => f.kind === "lunchOver" || f.kind === "underWork"))
          .sort((a, b) => `${a.date} ${a.employee.enrollNo}`.localeCompare(`${b.date} ${b.employee.enrollNo}`))
      : [];
    const pendingStats = {
      all: pendingRecords.length,
      absent: pendingRecords.filter((record) => record.status === "absent").length,
      incomplete: pendingRecords.filter((record) => record.status === "incomplete").length,
      shortHours: pendingRecords.filter((record) => record.flags.some((flag) => flag.kind === "underWork")).length,
      lateEarly: pendingRecords.filter((record) => record.lateMinutes > 0 || record.earlyMinutes > 0).length,
    };
    const normalizedSearch = timecardSearch.trim().toLowerCase();
    const filteredPendingRecords = pendingRecords.filter((record) => {
      if (timecardStatusFilter === "absent" && record.status !== "absent") return false;
      if (timecardStatusFilter === "incomplete" && record.status !== "incomplete") return false;
      if (timecardStatusFilter === "shortHours" && !record.flags.some((flag) => flag.kind === "underWork")) return false;
      if (timecardStatusFilter === "lateEarly" && record.lateMinutes === 0 && record.earlyMinutes === 0) return false;
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
    const totalPages = Math.max(1, Math.ceil(filteredPendingRecords.length / timecardPageSize));
    const currentTimecardPage = Math.min(timecardPage, totalPages);
    const pageStart = (currentTimecardPage - 1) * timecardPageSize;
    const pageRecords = filteredPendingRecords.slice(pageStart, pageStart + timecardPageSize);
    const resultStart = filteredPendingRecords.length === 0 ? 0 : pageStart + 1;
    const resultEnd = Math.min(pageStart + timecardPageSize, filteredPendingRecords.length);
    const shiftOverride = selectedEmployee?.shiftOverrides?.[selectedDate] ?? "";
    const restOverride = selectedEmployee?.restOverrides?.[selectedDate];
    const currentRestValue = restOverride === undefined ? "" : restOverride ? "rest" : "work";
    const selectedTimecardAudits = (data.timecardCorrectionAudits ?? [])
      .filter((audit) => audit.employeeId === selectedEmployeeId && audit.date === selectedDate)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    const recentCorrections = (data.timecardCorrectionAudits ?? [])
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
      ];

      return (
        <div className="view-stack timecards-overview">
          <section className="overview-headline">
            <div>
              <p className="overview-headline-eyebrow">{selectedMonth}</p>
              <h2>{t("timecardsOverviewTitle")}</h2>
            </div>
            <Button icon={Plus} variant="secondary" onClick={() => setTimecardDetailOpen(true)}>
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
                            setSelectedEmployeeId(employee.id);
                            setSelectedDate(audit.date);
                            setTimecardDetailOpen(true);
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
              action={<span className="setting-list-count">{t("timecardsPendingDatesCount", { count: filteredPendingRecords.length })}</span>}
            />

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
                </select>
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
                      <td>{formatFlags(record.flags, lang)}</td>
                      <td className="timecard-action-cell">
                        <Button
                          icon={Wand2}
                          variant="secondary"
                          onClick={() => {
                            setSelectedEmployeeId(record.employee.id);
                            setSelectedDate(record.date);
                            setTimecardDetailOpen(true);
                          }}
                        >
                          {t("openDetail")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {pageRecords.length === 0 ? (
                    <tr><td colSpan={7} className="empty-cell">{t("timecardsNoFilteredResults")}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="pagination-bar">
              <span>{t("paginationSummary", { start: resultStart, end: resultEnd, total: filteredPendingRecords.length })}</span>
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

        <section className="panel timecards-simple">
          <SectionTitle title={t("timecardsTitle")} />
          <p className="panel-caption">{t("timecardsCaptionSimple")}</p>

          <div className="timecards-pick">
            <Field label={t("colEmployee")}>
              <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                {data.employees.filter((e) => e.active).map((employee) => (
                  <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>
                ))}
              </select>
            </Field>
            <Field label={t("colDate")}>
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
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
                <span className="muted">{t("workHoursPrefix")} {formatHours(selectedDateRecord.workMinutes)}h</span>
              ) : null}
            </div>
          ) : null}

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
        </section>
      </div>
    );
  }

  function renderLeave() {
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

    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle title={t("leaveInputTitle")} action={<Button icon={Plus} onClick={addLeave}>{t("add")}</Button>} />
          <div className="form-grid five">
            <Field label={t("colEmployee")}>
              <select value={leaveDraft.employeeId} onChange={(event) => setLeaveDraft({ ...leaveDraft, employeeId: event.target.value })}>
                {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.enrollNo} · {displayEmployeeName(employee)}</option>)}
              </select>
            </Field>
            <Field label={t("colDate")}><input type="date" value={leaveDraft.date} onChange={(event) => setLeaveDraft({ ...leaveDraft, date: event.target.value })} /></Field>
            <Field label={t("leaveTypeLabel")}>
              <select value={leaveDraft.type} onChange={(event) => setLeaveDraft({ ...leaveDraft, type: event.target.value })}>
                {data.settings.leaveTypes.map((type) => <option key={type} value={type}>{translateDataValue(type, lang)}</option>)}
              </select>
            </Field>
            <Field label={t("leaveHoursLabel")}><input type="number" min="0" step="0.5" value={leaveDraft.hours} onChange={(event) => setLeaveDraft({ ...leaveDraft, hours: Number(event.target.value) })} /></Field>
            <Field label={t("colNote")}><input value={leaveDraft.note} onChange={(event) => setLeaveDraft({ ...leaveDraft, note: event.target.value })} /></Field>
          </div>
        </section>

        <section className="panel">
          <SectionTitle title={t("leaveRecordsTitle")} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("colDate")}</th>
                  <th>{t("colEmployee")}</th>
                  <th>{t("rcLeaveType")}</th>
                  <th>{t("colLeaveHours")}</th>
                  <th>{t("colNote")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.leaves.map((leave) => {
                  const employee = data.employees.find((item) => item.id === leave.employeeId);
                  return (
                    <tr key={leave.id}>
                      <td>{leave.date}</td>
                      <td>{employee ? displayEmployeeName(employee) : "-"}</td>
                      <td>{translateDataValue(leave.type, lang)}</td>
                      <td>{leave.hours}</td>
                      <td>{leave.note ? translateDataValue(leave.note, lang) : "-"}</td>
                      <td><Button icon={Trash2} variant="ghost" onClick={() => removeLeave(leave.id)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <SectionTitle title={t("otCheckTitle")} />
          <p className="panel-caption">{t("otSimCaption")}</p>
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
                  <strong>{formatHours(otSimRecord.workMinutes)}h</strong>
                </div>
                <div>
                  <span>{t("colOT")}</span>
                  <strong>{formatDuration(otSimRecord.overtimeMinutes)}</strong>
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
                    <td>{formatDuration(record.overtimeMinutes)}</td>
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
    const reportCardPurpose = (id: ReportId) => {
      if (id === "summary") return t("reportPurposeCompany");
      if (id === "personal") return t("reportPurposeEmployeePrint");
      if (id === "raw") return t("reportPurposeRawAudit");
      return t("reportPurposeAudit");
    };
    const requiredReportCards: Array<{ id: ReportId; title: string; hint: string; purpose: string }> = reportOptions.map((option) => ({
      id: option.id,
      title: option.label[lang],
      hint: reportCardHint(option.id),
      purpose: reportCardPurpose(option.id),
    }));

    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle
            title={t("reportFiltersTitle")}
            action={
              <div className="inline-actions">
                <Button icon={Download} onClick={() => downloadText(`${report.title}-${selectedMonth}.csv`, dataUrlRows(report.columns, report.rows), "text/csv;charset=utf-8")}>{t("csvButton")}</Button>
                <Button icon={Printer} variant="secondary" onClick={() => window.print()}>{t("printButton")}</Button>
              </div>
            }
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
          <div className="report-format-strip">
            {requiredReportCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={cx("report-format-card", reportType === card.id && "report-format-card-active")}
                onClick={() => setReportType(card.id)}
              >
                <small>{card.purpose}</small>
                <strong>{card.title}</strong>
                <span>{card.hint}</span>
              </button>
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

        <section className="panel report-panel">
          <SectionTitle
            title={report.title}
            action={<span className="hint">{t("monthOnceConstraint", { month: selectedMonth })}</span>}
          />
          <div className="report-print-header">
            <div>
              <strong>{report.title}</strong>
              <span>{t("monthOnly", { month: selectedMonth })}</span>
            </div>
            <div>
              <span>{t("companyPrint", { value: companyFilter === "all" ? t("all") : translateDataValue(companyFilter, lang) })}</span>
              <span>{t("departmentPrint", { value: departmentFilter === "all" ? t("all") : translateDataValue(departmentFilter, lang) })}</span>
              {reportEmployee ? (
                <span>{t("employeePrint", { name: displayEmployeeName(reportEmployee), enrollNo: reportEmployee.enrollNo })}</span>
              ) : null}
            </div>
          </div>
          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  {report.columns.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {report.columns.map((column) => <td key={column}>{row[column]}</td>)}
                  </tr>
                ))}
                {report.rows.length === 0 ? <tr><td colSpan={report.columns.length} className="empty-cell">{t("noMatchingRecords")}</td></tr> : null}
              </tbody>
            </table>
          </div>
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
              otHours: pay.otHours,
              base: pay.base,
              otPay: pay.otPay,
              absentDays: pay.summary.absentDays,
              unpaidLeaveDays: pay.summary.deductibleLeaveDays,
              shortHoursDeduct: pay.shortHoursDeduct,
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

    function exportPayrollCsv() {
      const columns = [
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
        t("payrollColUnpaidLeaveDays"),
        t("payrollColOtWarning"),
        t("salaryCurrencyLabel"),
        t("payrollColBase"),
        t("payrollColOtPay"),
        t("payrollColShortHoursDeduct"),
        t("payrollColTotalDeduct"),
        t("payrollColGross"),
      ];
      const csvRows = rows.map((row) => ({
        [t("payrollReadinessStatus")]: readinessLabel,
        [t("payrollColEnrollNo")]: row.employee.enrollNo,
        [t("payrollColName")]: displayEmployeeName(row.employee),
        [t("payrollColDept")]: translateDataValue(row.employee.department, lang),
        [t("payrollColType")]: row.employee.salary.type === "monthly" ? t("salaryTypeMonthly") : t("salaryTypeHourly"),
        [t("payrollColWorkHours")]: row.workHours.toFixed(2),
        [t("payrollColPaidLeaveHours")]: row.paidLeaveHours.toFixed(2),
        [t("payrollColOtHours")]: row.otHours.toFixed(2),
        [t("payrollColLeaveDays")]: row.summary.leaveDays,
        [t("payrollColAbsentDays")]: row.absentDays,
        [t("payrollColUnpaidLeaveDays")]: row.unpaidLeaveDays,
        [t("payrollColOtWarning")]: payrollWarningsText(row),
        [t("salaryCurrencyLabel")]: row.employee.salary.currency,
        [t("payrollColBase")]: row.base.toFixed(2),
        [t("payrollColOtPay")]: row.otPay.toFixed(2),
        [t("payrollColShortHoursDeduct")]: row.shortHoursDeduct.toFixed(2),
        [t("payrollColTotalDeduct")]: row.totalDeduct.toFixed(2),
        [t("payrollColGross")]: row.gross.toFixed(2),
      }));
      downloadText(`payroll-${selectedMonth}.csv`, dataUrlRows(columns, csvRows), "text/csv;charset=utf-8");
    }

    return (
      <div className="view-stack">
        <section className="panel">
          <SectionTitle
            title={t("payrollTitle")}
            action={
              <div className="inline-actions">
                <Button icon={Download} onClick={exportPayrollCsv}>{t("csvButton")}</Button>
                <Button icon={Printer} variant="secondary" onClick={() => window.print()}>{t("printButton")}</Button>
              </div>
            }
          />
          <p className="panel-caption">{t("payrollSubtitle")}</p>
          <div className={cx("payroll-export-status", `payroll-export-status-${monthlyReadiness.status}`)}>
            <strong>{readinessLabel}</strong>
            <span>{readinessDetail}</span>
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
          <div className="table-wrap report-table">
            <p className="table-help">{t("payrollClickEmployeeHint")}</p>
            <table className="payroll-table">
              <colgroup>
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
                <col className="payroll-col-notes" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-money" />
                <col className="payroll-col-payable" />
              </colgroup>
              <thead>
                <tr>
                  <th className="payroll-sticky payroll-group-info">{t("payrollColEnrollNo")}</th>
                  <th className="payroll-sticky payroll-sticky-name payroll-group-info">{t("payrollColName")}</th>
                  <th className="payroll-group-info">{t("payrollColDept")}</th>
                  <th className="payroll-group-info">{t("payrollColType")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColWorkHours")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColPaidLeaveHours")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColOtHours")}</th>
                  <th className="num payroll-group-attendance">{t("payrollColLeaveDays")}</th>
                  <th className="num payroll-group-deduct">{t("payrollColAbsentDays")}</th>
                  <th className="num payroll-group-deduct">{t("payrollColUnpaidLeaveDays")}</th>
                  <th className="payroll-group-deduct">{t("payrollColOtWarning")}</th>
                  <th className="num payroll-group-money">{t("payrollColBase")}</th>
                  <th className="num payroll-group-money">{t("payrollColOtPay")}</th>
                  <th className="num payroll-group-money">{t("payrollColShortHoursDeduct")}</th>
                  <th className="num payroll-group-money">{t("payrollColTotalDeduct")}</th>
                  <th className="num payroll-group-payable">{t("payrollColGross")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employee.id}>
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
                    <td className="num" data-label={t("payrollColLeaveDays")}>{row.summary.leaveDays}</td>
                    <td className="num" data-label={t("payrollColAbsentDays")}>{row.absentDays}</td>
                    <td className="num" data-label={t("payrollColUnpaidLeaveDays")}>{row.unpaidLeaveDays}</td>
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
                    <td className="num payroll-money-cell" data-label={t("payrollColShortHoursDeduct")}>-<span>{row.employee.salary.currency}</span> {row.shortHoursDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell" data-label={t("payrollColTotalDeduct")}>-<span>{row.employee.salary.currency}</span> {row.totalDeduct.toFixed(2)}</td>
                    <td className="num payroll-money-cell payroll-payable-cell" data-label={t("payrollColGross")}><strong><span>{row.employee.salary.currency}</span> {row.gross.toFixed(2)}</strong></td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr><td colSpan={16} className="empty-cell">{t("noMatchingRecords")}</td></tr>
                ) : null}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={15} className="num"><strong>{t("payrollGrandTotal")}</strong></td>
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
                  onRemove={(value) => removeSettingItem("companies", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                />
                <SettingList
                  title={t("settingListDepartments")}
                  addPlaceholder={t("settingListAddDepartment")}
                  items={data.settings.departments}
                  value={newDepartment}
                  onValue={setNewDepartment}
                  onAdd={() => { addSettingItem("departments", newDepartment); setNewDepartment(""); }}
                  onRemove={(value) => removeSettingItem("departments", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                />
                <SettingList
                  title={t("settingListPositions")}
                  addPlaceholder={t("settingListAddPosition")}
                  items={data.settings.positions}
                  value={newPosition}
                  onValue={setNewPosition}
                  onAdd={() => { addSettingItem("positions", newPosition); setNewPosition(""); }}
                  onRemove={(value) => removeSettingItem("positions", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                />
                <SettingList
                  title={t("settingListNationalities")}
                  addPlaceholder={t("settingListAddNationality")}
                  items={data.settings.nationalities}
                  value={newNationality}
                  onValue={setNewNationality}
                  onAdd={() => { addSettingItem("nationalities", newNationality); setNewNationality(""); }}
                  onRemove={(value) => removeSettingItem("nationalities", value)}
                  renderItem={(item) => translateDataValue(item, lang)}
                  emptyHint={emptyHint}
                  deleteAria={deleteAria}
                />
              </div>
            </section>
            <section className="settings-list-group">
              <div className="settings-list-group-head">
                <h3>{t("settingAttendanceListsTitle")}</h3>
                <p>{t("settingAttendanceListsHint")}</p>
              </div>
              <div className="settings-grid">
            <SettingList
              title={t("settingListCorrectionReasons")}
              addPlaceholder={t("settingListAddCorrectionReason")}
              items={data.settings.correctionReasons}
              value={newCorrectionReason}
              onValue={setNewCorrectionReason}
              onAdd={() => { addSettingItem("correctionReasons", newCorrectionReason); setNewCorrectionReason(""); }}
              onRemove={(value) => removeSettingItem("correctionReasons", value)}
              renderItem={(item) => translateDataValue(item, lang)}
              emptyHint={emptyHint}
              deleteAria={deleteAria}
            />
            <div className="setting-list-block">
              <header className="setting-list-head">
                <strong>{t("settingListLeaveTypes")}</strong>
                <span className="setting-list-count">{data.settings.leaveTypes.length}</span>
              </header>
              <ul className="setting-list-rows">
                {data.settings.leaveTypes.length === 0 ? (
                  <li className="setting-list-empty">{emptyHint}</li>
                ) : (
                  data.settings.leaveTypes.map((type) => {
                    const paid = isPaidLeaveType(type, data);
                    return (
                      <li key={type} className="setting-list-row leave-type-row">
                        <span className="setting-list-row-label">{translateDataValue(type, lang)}</span>
                        <span className="pay-rule-toggle" aria-label={t("salaryLeaveDeduct")}>
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
  onRemove,
  renderItem,
  addPlaceholder,
  emptyHint,
  deleteAria,
}: {
  title: string;
  items: string[];
  value: string;
  onValue: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
  renderItem?: (item: string) => string;
  addPlaceholder: string;
  emptyHint: string;
  deleteAria: string;
}) {
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
          items.map((item) => (
            <li key={item} className="setting-list-row">
              <span className="setting-list-row-label">{renderItem ? renderItem(item) : item}</span>
              <button
                type="button"
                className="setting-list-row-delete"
                onClick={() => onRemove(item)}
                aria-label={deleteAria}
                title={deleteAria}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))
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
        [colLateMins]: formatDuration(lateMinutes),
        [colLateTimes]: summary.lateCount,
        [colEarlyMins]: formatDuration(earlyMinutes),
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
        const times = record
          ? (["in", "breakOut", "breakIn", "out"] as PunchKind[])
              .map((kind) => recordPunchTime(record, kind, lang))
              .filter(Boolean)
              .join(" / ")
          : "";
        const dayLabel = dayColumns[index];
        row[dayLabel] = times || (record ? statusLabels[lang][record.status] : "");
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
        [colLate]: formatDuration(record.lateMinutes),
        [colEarly]: formatDuration(record.earlyMinutes),
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
    const colNote = tr("rcNote");
    const columns = [colDate, colNo, colName, colDept, colLeaveType, colLeaveHours, colNote];
    const rows = data.leaves
      .filter((leave) => employees.some((employee) => employee.id === leave.employeeId) && leave.date.startsWith(month))
      .map((leave) => {
        const employee = data.employees.find((item) => item.id === leave.employeeId)!;
        return {
          [colDate]: leave.date,
          [colNo]: employee.enrollNo,
          [colName]: displayEmployeeName(employee),
          [colDept]: translateDataValue(employee.department, lang),
          [colLeaveType]: translateDataValue(leave.type, lang),
          [colLeaveHours]: leave.hours,
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
        [colOT]: formatDuration(record.overtimeMinutes),
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
