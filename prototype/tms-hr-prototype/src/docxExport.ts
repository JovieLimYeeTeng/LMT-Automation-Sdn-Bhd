export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type DocxReportRow = Record<string, string | number>;
export type PunchGridDocxEmployee = {
  heading: string;
  employeeNoLabel: string;
  employeeNo: string | number;
  nameLabel: string;
  name: string | number;
  departmentLabel: string;
  department: string | number;
  shiftLabel: string;
  shift: string | number;
  weeks: Array<{
    label: string;
    days: Array<{ label: string; value: string }>;
  }>;
};

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(value: unknown, options: { bold?: boolean; size?: number; color?: string; spacingAfter?: number } = {}): string {
  const size = options.size ?? 20;
  return `
    <w:p>
      <w:pPr>
        <w:spacing w:after="${options.spacingAfter ?? 80}"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/>
          <w:sz w:val="${size}"/>
          <w:szCs w:val="${size}"/>
          ${options.bold ? "<w:b/>" : ""}
          ${options.color ? `<w:color w:val="${options.color}"/>` : ""}
        </w:rPr>
        <w:t xml:space="preserve">${xmlEscape(value)}</w:t>
      </w:r>
    </w:p>
  `;
}

function splitReportInfoLine(value: string): { label: string; text: string } {
  const separatorIndex = value.search(/[:\uFF1A]/);
  if (separatorIndex < 0) return { label: "", text: value };
  return {
    label: value.slice(0, separatorIndex).trim(),
    text: value.slice(separatorIndex + 1).trim(),
  };
}

function isNumericExportValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  return /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function cellAlignment(column: string, value: unknown): "left" | "center" | "right" {
  const columnKey = column.toLowerCase().replace(/[\s./()_-]+/g, "");
  const text = String(value ?? "").trim();
  if (text === "-") return "center";
  if (
    columnKey.includes("name") ||
    columnKey.includes("remark") ||
    columnKey.includes("reason") ||
    columnKey.includes("description") ||
    /\u59D3\u540D|\u5907\u6CE8|\u539F\u56E0|\u8BF4\u660E|\u63CF\u8FF0/.test(column)
  ) {
    return "left";
  }
  if (
    /^day\d+$/.test(columnKey) ||
    /^\d+\u53F7$/.test(column.trim()) ||
    /\u5458\u5DE5\u7F16\u53F7|\u7F16\u53F7|\u5DE5\u53F7|\u65E5\u671F|\u65F6\u95F4|\u90E8\u95E8|\u73ED\u6B21|\u72B6\u6001|\u7C7B\u578B|\u6B21\u6570|\u5929|\u5C0F\u65F6|\u5206\u949F|\u91D1\u989D|\u85AA|\u6263|\u5E94\u53D1|\u603B/.test(column) ||
    /\d+\s*(h|hour|mins?|minutes?|\u5C0F\u65F6|\u5206\u949F)/i.test(text)
  ) {
    return "center";
  }
  if (
    columnKey.includes("employee") ||
    columnKey.includes("no") ||
    columnKey.includes("id") ||
    columnKey.includes("department") ||
    columnKey.includes("shift") ||
    columnKey.includes("status") ||
    isNumericExportValue(value) ||
    /\d+\s*(h|hour|mins?|minutes?|小时|分钟)/i.test(text)
  ) {
    return "center";
  }
  return "left";
}

function textWithBreaks(value: unknown): string {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line, index) => `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("");
}

function cell(
  value: unknown,
  options: { bold?: boolean; shading?: string; color?: string; align?: "left" | "center" | "right"; width?: number } = {},
): string {
  const width = options.width ? `<w:tcW w:w="${options.width}" w:type="dxa"/>` : "";
  const shading = options.shading ? `<w:shd w:fill="${options.shading}"/>` : "";
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : "";
  const color = options.color ? `<w:color w:val="${options.color}"/>` : "";
  return `
    <w:tc>
      <w:tcPr>
        ${width}
        ${shading}
        <w:tcMar>
          <w:top w:w="80" w:type="dxa"/>
          <w:left w:w="90" w:type="dxa"/>
          <w:bottom w:w="80" w:type="dxa"/>
          <w:right w:w="90" w:type="dxa"/>
        </w:tcMar>
      </w:tcPr>
      <w:p>
        <w:pPr>${align}</w:pPr>
        <w:r>
          <w:rPr>
            <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/>
            <w:sz w:val="18"/>
            <w:szCs w:val="18"/>
            ${options.bold ? "<w:b/>" : ""}
            ${color}
          </w:rPr>
          ${textWithBreaks(value)}
        </w:r>
      </w:p>
    </w:tc>
  `;
}

function reportInfoTable(summaryLines: string[], usableWidth: number): string {
  const labelWidth = 1900;
  const valueWidth = Math.max(2200, usableWidth - labelWidth);
  const rows = summaryLines.map((line) => {
    const info = splitReportInfoLine(line);
    return `
      <w:tr>
        ${cell(info.label || line, { bold: true, shading: "F4F7F5", color: "24443F", width: labelWidth })}
        ${cell(info.label ? info.text : "", { width: valueWidth })}
      </w:tr>
    `;
  }).join("");
  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:color="E2E8E5"/>
          <w:left w:val="single" w:sz="4" w:color="E2E8E5"/>
          <w:bottom w:val="single" w:sz="4" w:color="E2E8E5"/>
          <w:right w:val="single" w:sz="4" w:color="E2E8E5"/>
          <w:insideH w:val="single" w:sz="4" w:color="E2E8E5"/>
          <w:insideV w:val="single" w:sz="4" w:color="E2E8E5"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="${labelWidth}"/><w:gridCol w:w="${valueWidth}"/></w:tblGrid>
      ${rows}
    </w:tbl>
    ${paragraph("", { spacingAfter: 80 })}
  `;
}

function reportDataTable(columns: string[], rows: DocxReportRow[], usableWidth: number): string {
  const safeColumns = columns.length > 0 ? columns : [" "];
  const weights = safeColumns.map((column) => {
    const normalized = column.toLowerCase();
    if (/remark|reason|description|note|notes|warning|detail|\u5907\u6CE8|\u539F\u56E0|\u8BF4\u660E|\u63CF\u8FF0/i.test(column)) return 2.2;
    if (/^days?\s+\d|^\d+\s*-\s*\d+\u53F7/i.test(column)) return 2.05;
    if (/name|\u59D3\u540D/i.test(column)) return 1.55;
    if (/department|\u90E8\u95E8/i.test(column)) return 1.2;
    if (/employee\s*no|enroll|raw\s*no|\u5458\u5DE5\u7F16\u53F7|\u7F16\u53F7/i.test(column)) return 1.15;
    if (/date|time|duration|mins?|hours?|amount|deduct|pay|salary|gross|total|\u65E5\u671F|\u65F6\u95F4|\u5206\u949F|\u5C0F\u65F6|\u91D1\u989D|\u6263|\u85AA|\u5E94\u53D1|\u603B/i.test(normalized)) return 1.15;
    return 1;
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const colWidths = weights.map((weight) => Math.max(560, Math.floor((usableWidth * weight) / totalWeight)));
  const header = `<w:tr>${safeColumns.map((column, index) =>
    cell(column, { bold: true, shading: "245D56", color: "FFFFFF", align: "center", width: colWidths[index] }),
  ).join("")}</w:tr>`;
  const body = rows.map((row) => `<w:tr>${safeColumns.map((column, index) => {
    const value = row[column] ?? "";
    return cell(value, { align: cellAlignment(column, value), width: colWidths[index] });
  }).join("")}</w:tr>`).join("");

  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="5000" w:type="pct"/>
        <w:tblLayout w:type="fixed"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:color="9AA9A4"/>
          <w:left w:val="single" w:sz="4" w:color="9AA9A4"/>
          <w:bottom w:val="single" w:sz="4" w:color="9AA9A4"/>
          <w:right w:val="single" w:sz="4" w:color="9AA9A4"/>
          <w:insideH w:val="single" w:sz="4" w:color="9AA9A4"/>
          <w:insideV w:val="single" w:sz="4" w:color="9AA9A4"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>${colWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>
      ${header.replace("<w:tr>", "<w:tr><w:trPr><w:tblHeader/></w:trPr>")}
      ${body}
    </w:tbl>
  `;
}

function documentXml(title: string, summaryLines: string[], columns: string[], rows: DocxReportRow[]): string {
  const landscape = columns.length > 9;
  const pageWidth = landscape ? 16838 : 11906;
  const pageHeight = landscape ? 11906 : 16838;
  const margin = 720;
  const usableWidth = pageWidth - margin * 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        ${paragraph(title, { bold: true, size: 28, color: "111111", spacingAfter: 120 })}
        ${reportInfoTable(summaryLines, usableWidth)}
        ${reportDataTable(columns, rows, usableWidth)}
        <w:sectPr>
          <w:pgSz w:w="${pageWidth}" w:h="${pageHeight}"${landscape ? ' w:orient="landscape"' : ""}/>
          <w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360" w:gutter="0"/>
        </w:sectPr>
      </w:body>
    </w:document>`;
}

function punchGridEmployeeBlock(employee: PunchGridDocxEmployee, usableWidth: number): string {
  const weekTables = employee.weeks.map((week) => `
    ${paragraph(week.label, { bold: true, size: 18, color: "24443F", spacingAfter: 30 })}
    ${reportDataTable(
      week.days.map((day) => day.label),
      [Object.fromEntries(week.days.map((day) => [day.label, day.value || "-"]))],
      usableWidth,
    )}
    ${paragraph("", { spacingAfter: 35 })}
  `).join("");

  return `
    ${paragraph(employee.heading, { bold: true, size: 21, color: "111111", spacingAfter: 35 })}
    ${weekTables}
  `;
}

function punchGridDocumentXml(title: string, summaryLines: string[], employees: PunchGridDocxEmployee[]): string {
  const pageWidth = 16838;
  const pageHeight = 11906;
  const margin = 720;
  const usableWidth = pageWidth - margin * 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        ${paragraph(title, { bold: true, size: 28, color: "111111", spacingAfter: 120 })}
        ${reportInfoTable(summaryLines, usableWidth)}
        ${employees.map((employee) => punchGridEmployeeBlock(employee, usableWidth)).join("")}
        <w:sectPr>
          <w:pgSz w:w="${pageWidth}" w:h="${pageHeight}" w:orient="landscape"/>
          <w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="360" w:footer="360" w:gutter="0"/>
        </w:sectPr>
      </w:body>
    </w:document>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
        <w:name w:val="Normal"/>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/>
          <w:sz w:val="20"/>
          <w:szCs w:val="20"/>
        </w:rPr>
      </w:style>
    </w:styles>`;
}

export async function buildDocxReportBuffer(
  title: string,
  summaryLines: string[],
  columns: string[],
  rows: DocxReportRow[],
): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    </Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  const word = zip.folder("word");
  word?.file("document.xml", documentXml(title, summaryLines, columns, rows));
  word?.file("styles.xml", stylesXml());
  word?.folder("_rels")?.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildPunchGridDocxReportBuffer(
  title: string,
  summaryLines: string[],
  employees: PunchGridDocxEmployee[],
): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    </Types>`);
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`);
  const word = zip.folder("word");
  word?.file("document.xml", punchGridDocumentXml(title, summaryLines, employees));
  word?.file("styles.xml", stylesXml());
  word?.folder("_rels")?.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
