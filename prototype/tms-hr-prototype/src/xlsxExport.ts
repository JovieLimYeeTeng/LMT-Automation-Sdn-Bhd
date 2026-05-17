export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type XlsxReportRow = Record<string, string | number>;

const REPORT_FONT_NAME = "Microsoft YaHei";
const REPORT_COLORS = {
  title: "FF111111",
  titleRule: "FF1F4F49",
  infoLabelText: "FF24443F",
  infoValueText: "FF222222",
  infoLabelFill: "FFF4F7F5",
  infoValueFill: "FFFBFDFC",
  headerFill: "FF245D56",
  headerText: "FFFFFFFF",
  headerBorder: "FF6F8580",
  cellBorder: "FF9AA9A4",
  infoBorder: "FFE2E8E5",
};

function splitReportInfoLine(value: string): { label: string; text: string } {
  const separatorIndex = value.search(/[:\uFF1A]/);
  if (separatorIndex < 0) return { label: "", text: value };
  return {
    label: value.slice(0, separatorIndex).trim(),
    text: value.slice(separatorIndex + 1).trim(),
  };
}

function excelWorksheetName(value: string): string {
  return value.trim().replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").slice(0, 31) || "Report";
}

function displayLength(value: unknown): number {
  return Math.max(
    0,
    ...String(value ?? "").split(/\r?\n/).map((line) => line.split("").reduce((total, char) => {
      return total + (char.charCodeAt(0) > 255 ? 1.7 : 1);
    }, 0)),
  );
}

function lineCount(value: unknown): number {
  return Math.max(1, String(value ?? "").split(/\r?\n/).length);
}

function hasLineBreak(value: unknown): boolean {
  return /\r?\n/.test(String(value ?? ""));
}

function normalizedColumnName(column: string): string {
  return column.toLowerCase().replace(/[._/()-]+/g, " ").replace(/\s+/g, " ").trim();
}

function isDateTimeExportColumn(column: string): boolean {
  const normalized = normalizedColumnName(column);
  return (
    /\u65E5\u671F|\u661F\u671F|\u65F6\u95F4/.test(column) ||
    /\b(date|datetime|date time|weekday|time|in|out|clock in|clock out)\b/i.test(normalized) ||
    /\bsection\s*\d+\s*(in|out)\b/i.test(normalized)
  );
}

function isQuantityExportColumn(column: string): boolean {
  const normalized = normalizedColumnName(column);
  return (
    /\u5DE5\u4F5C\u5929|\u51FA\u52E4\u5929|\u65F7\u5DE5|\u8FDF\u5230|\u65E9\u9000|\u52A0\u73ED|\u8BF7\u5047\u5929|\u8BF7\u5047\u5C0F\u65F6|\u5DE5\u65F6|\u5929\u6570|\u6B21\u6570|\u5206\u949F|\u5C0F\u65F6|\u91D1\u989D|\u85AA\u8D44|\u6263\u6B3E|\u5E94\u53D1|\u5B9E\u53D1/.test(column) ||
    /\b(work days?|attend days?|attendance days?|absent|late mins?|late minutes?|late times|late count|early mins?|early minutes?|early times|early count|ot hours?|overtime hours?|overtime|hours?|hrs?|minutes?|mins?|days?|counts?|times|amount|salary|deductions?|deducted|deduct|payable|payment|wages?|rate|total|gross|base)\b/i.test(normalized)
  );
}

function excelColumnCharacterWidth(column: string, rows: XlsxReportRow[]): number {
  const contentLength = Math.max(
    displayLength(column),
    ...rows.map((row) => displayLength(row[column])),
  );
  const baseWidth = Math.ceil(contentLength * 1.15 + 3);

  if (/\u5458\u5DE5\u7F16\u53F7|employee\s*no|enroll/i.test(column)) return Math.max(15, baseWidth);
  if (/\u59D3\u540D|name/i.test(column)) return Math.min(26, Math.max(18, baseWidth));
  if (/\u90E8\u95E8|department/i.test(column)) return Math.min(22, Math.max(14, baseWidth));
  if (/\u73ED\u6B21|shift/i.test(column)) return Math.min(18, Math.max(13, baseWidth));
  if (isDateTimeExportColumn(column)) return Math.min(24, Math.max(16, baseWidth));
  if (isQuantityExportColumn(column)) {
    return Math.min(28, Math.max(18, baseWidth));
  }
  if (/\u5907\u6CE8|\u539F\u56E0|remark|reason|note|notes|warning|status/i.test(column)) return Math.min(36, Math.max(22, baseWidth));

  return Math.min(34, Math.max(11, baseWidth));
}

function isIdentifierExportColumn(column: string): boolean {
  return /(^|\s)(id|no\.?|number)(\s|$)|\u7F16\u53F7|\u5458\u5DE5\u7F16\u53F7/i.test(column);
}

function isNumericExportValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function excelExportCellValue(column: string, value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return String(value ?? "");
  const trimmed = value.trim();
  if (
    !isIdentifierExportColumn(column)
    && /^-?\d+(?:\.\d+)?$/.test(trimmed)
    && !/^0\d/.test(trimmed)
  ) {
    return Number(trimmed);
  }
  return value;
}

function reportInfoParts(line: string): { label: string; text: string } {
  const info = splitReportInfoLine(line);
  if (!info.label) {
    const monthMatch = line.match(/^(Month|\u6708\u4EFD)\s+(.+)$/i);
    if (monthMatch) {
      return { label: `${monthMatch[1]}${reportLabelSuffix(monthMatch[1])}`, text: monthMatch[2].trim() };
    }
    return { label: line, text: "" };
  }
  return { label: `${info.label}${reportLabelSuffix(info.label)}`, text: info.text };
}

function reportLabelSuffix(label: string): string {
  return /[^\x00-\x7F]/.test(label) ? "\uFF1A" : ":";
}

function isCenterAlignedColumn(column: string): boolean {
  const normalized = normalizedColumnName(column);
  return (
    /\u90E8\u95E8|\u73ED\u6B21|\u804C\u4F4D|\u72B6\u6001|\u7C7B\u578B|\u516C\u53F8|\u6765\u6E90|\u5E01\u79CD/.test(column) ||
    /\b(department|shift|position|company|status|type|mode|kind|source|currency|inout|in out|verify|device)\b/i.test(normalized) ||
    isDateTimeExportColumn(column)
  );
}

function isLeftAlignedColumn(column: string): boolean {
  return /\u5907\u6CE8|\u539F\u56E0|\u8BF4\u660E|\u63CF\u8FF0|remark|reason|description|note|notes|warning/i.test(column);
}

function cellHorizontalAlignment(column: string, value: unknown): "left" | "center" | "right" {
  if (String(value ?? "").trim() === "-") return "center";
  if (isLeftAlignedColumn(column)) return "left";
  return "center";
}

function numericCellFormat(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value) ? "0" : "0.##";
}

function excelColumnLetter(index: number): string {
  let column = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    current = Math.floor((current - 1) / 26);
  }
  return column;
}

async function addIgnoredNumberStoredAsTextErrors(buffer: ArrayBuffer, ranges: string[]): Promise<ArrayBuffer> {
  if (ranges.length === 0) return buffer;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const sheet = zip.file("xl/worksheets/sheet1.xml");
  if (!sheet) return buffer;

  const ignoredErrorsXml = `<ignoredErrors>${ranges
    .map((range) => `<ignoredError sqref="${range}" numberStoredAsText="1"/>`)
    .join("")}</ignoredErrors>`;
  const xml = await sheet.async("string");
  const withoutExistingIgnoredErrors = xml.replace(/<ignoredErrors>[\s\S]*?<\/ignoredErrors>/, "");
  const patchedXml = withoutExistingIgnoredErrors.replace("</worksheet>", `${ignoredErrorsXml}</worksheet>`);

  zip.file("xl/worksheets/sheet1.xml", patchedXml);
  return zip.generateAsync({ type: "arraybuffer" });
}

export async function buildXlsxReportBuffer(
  title: string,
  summaryLines: string[],
  columns: string[],
  rows: XlsxReportRow[],
): Promise<ArrayBuffer> {
  const safeColumns = columns.length > 0 ? columns : [" "];
  const columnCount = safeColumns.length;
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TMS HR Prototype";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet(excelWorksheetName(title), {
    pageSetup: {
      paperSize: 9,
      orientation: columnCount > 9 ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });

  worksheet.properties.defaultRowHeight = 18;
  worksheet.columns = safeColumns.map((column) => ({
    key: column,
    width: excelColumnCharacterWidth(column, rows),
    style: isIdentifierExportColumn(column) ? { numFmt: "@" } : undefined,
  }));

  const titleRow = worksheet.addRow([title]);
  titleRow.height = 25;
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
  titleRow.getCell(1).font = { name: REPORT_FONT_NAME, bold: true, size: 14, color: { argb: REPORT_COLORS.title } };
  titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  titleRow.getCell(1).border = { bottom: { style: "thin", color: { argb: REPORT_COLORS.titleRule } } };

  summaryLines.forEach((line) => {
    const info = reportInfoParts(line);
    const row = worksheet.addRow([info.label, info.text]);
    row.height = 19;
    const labelCell = row.getCell(1);
    labelCell.font = { name: REPORT_FONT_NAME, bold: true, size: 10, color: { argb: REPORT_COLORS.infoLabelText } };
    labelCell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REPORT_COLORS.infoLabelFill } };

    if (columnCount > 1) {
      worksheet.mergeCells(row.number, 2, row.number, columnCount);
    }
    const valueCell = row.getCell(2);
    valueCell.font = { name: REPORT_FONT_NAME, size: 10, color: { argb: REPORT_COLORS.infoValueText } };
    valueCell.alignment = { vertical: "middle", horizontal: "left", wrapText: false, shrinkToFit: false };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REPORT_COLORS.infoValueFill } };

    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: "hair", color: { argb: REPORT_COLORS.infoBorder } } };
    });
  });

  const headerRow = worksheet.addRow(safeColumns);
  headerRow.height = 23;
  headerRow.eachCell((cell) => {
    cell.font = { name: REPORT_FONT_NAME, bold: true, size: 10, color: { argb: REPORT_COLORS.headerText } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: REPORT_COLORS.headerFill } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: REPORT_COLORS.headerBorder } },
      bottom: { style: "thin", color: { argb: REPORT_COLORS.headerBorder } },
      left: { style: "thin", color: { argb: REPORT_COLORS.headerBorder } },
      right: { style: "thin", color: { argb: REPORT_COLORS.headerBorder } },
    };
  });

  const identifierColumnRanges: string[] = [];
  rows.forEach((rowData) => {
    const row = worksheet.addRow(safeColumns.map((column) => excelExportCellValue(column, rowData[column])));
    const maxLineCount = Math.max(...safeColumns.map((column) => lineCount(rowData[column])));
    row.height = maxLineCount > 1 ? Math.min(92, 18 + maxLineCount * 13) : 21;
    safeColumns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      const wrapText = hasLineBreak(rowData[column]) || (isLeftAlignedColumn(column) && displayLength(rowData[column]) > 26);
      cell.font = { name: REPORT_FONT_NAME, size: 10, color: { argb: REPORT_COLORS.infoValueText } };
      if (isIdentifierExportColumn(column)) {
        cell.numFmt = "@";
      } else if (typeof cell.value === "number") {
        cell.numFmt = numericCellFormat(cell.value);
      }
      cell.alignment = {
        vertical: "middle",
        horizontal: cellHorizontalAlignment(column, rowData[column]),
        wrapText,
        shrinkToFit: !wrapText,
      };
      cell.border = {
        top: { style: "thin", color: { argb: REPORT_COLORS.cellBorder } },
        bottom: { style: "thin", color: { argb: REPORT_COLORS.cellBorder } },
        left: { style: "thin", color: { argb: REPORT_COLORS.cellBorder } },
        right: { style: "thin", color: { argb: REPORT_COLORS.cellBorder } },
      };
    });
  });

  safeColumns.forEach((column, index) => {
    if (!isIdentifierExportColumn(column) || rows.length === 0) return;
    const columnLetter = excelColumnLetter(index + 1);
    identifierColumnRanges.push(`${columnLetter}${headerRow.number + 1}:${columnLetter}${headerRow.number + rows.length}`);
  });

  worksheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number, column: columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return addIgnoredNumberStoredAsTextErrors(buffer, identifierColumnRanges);
}
