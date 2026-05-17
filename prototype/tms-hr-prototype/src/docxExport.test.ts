import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildDocxReportBuffer, buildPunchGridDocxReportBuffer } from "./docxExport";

describe("docx export", () => {
  it("builds a valid editable docx report with metadata and selected rows", async () => {
    const buffer = await buildDocxReportBuffer(
      "Monthly Attendance Summary Report",
      [
        "Month: 2026-04",
        "Company: All",
        "Department: Warehouse",
        "Position: Not set",
        "Employee: Night Nadia (1006)",
        "Export date: 2026/05/15 17:45",
      ],
      ["Employee No.", "Name", "Department", "Late mins"],
      [{
        "Employee No.": "1006",
        Name: "Night Nadia",
        Department: "Warehouse",
        "Late mins": "2h 54m",
      }],
    );

    expect(Buffer.from(buffer).subarray(0, 2).toString("utf8")).toBe("PK");
    const zip = await JSZip.loadAsync(buffer);
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("word/document.xml")).toBeTruthy();

    const documentXml = await zip.file("word/document.xml")?.async("string");
    expect(documentXml).toContain("Monthly Attendance Summary Report");
    expect(documentXml).toContain("Night Nadia");
    expect(documentXml).toContain('<w:pgSz w:w="11906" w:h="16838"');
    expect(documentXml).toContain("<w:tblHeader/>");
    expect(documentXml).toContain("<w:tbl");
  });

  it("uses A4 landscape for wide reports so long tables fit better", async () => {
    const columns = Array.from({ length: 12 }, (_, index) => `Col ${index + 1}`);
    const row = Object.fromEntries(columns.map((column) => [column, "x"]));
    const buffer = await buildDocxReportBuffer("Wide Report", ["Month: 2026-04"], columns, [row]);
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"');
  });

  it("keeps wrapped document-friendly detail cells editable with real line breaks", async () => {
    const buffer = await buildDocxReportBuffer(
      "Monthly Punch Grid",
      ["Month: 2026-04"],
      ["Employee No.", "Name", "Notes"],
      [{ "Employee No.": "1001", Name: "Tan Wei", Notes: "1: 09:00 / 18:00\n2: Rest day" }],
    );
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain("1: 09:00 / 18:00");
    expect(documentXml).toContain("<w:br/>");
    expect(documentXml).toContain("2: Rest day");
  });

  it("builds monthly punch grid docs as employee-based weekly sections", async () => {
    const buffer = await buildPunchGridDocxReportBuffer(
      "Monthly Punch Grid",
      ["Month: 2026-04", "Company: All"],
      [{
        heading: "Tan Wei (1001) | Catering | Morning",
        employeeNoLabel: "Employee No.",
        employeeNo: "1001",
        nameLabel: "Name",
        name: "Tan Wei",
        departmentLabel: "Department",
        department: "Catering",
        shiftLabel: "Shift",
        shift: "Morning",
        weeks: [{
          label: "Days 1-7",
          days: [
            { label: "Day 1", value: "09:00\n12:00\n13:00\n18:08" },
            { label: "Day 2", value: "Rest day" },
          ],
        }],
      }],
    );
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    expect(documentXml).toContain("Tan Wei (1001) | Catering | Morning");
    expect(documentXml).toContain("Days 1-7");
    expect(documentXml).not.toContain("Employee No.: 1001");
    expect(documentXml).not.toContain("In 09:00");
    expect(documentXml).toContain("09:00");
    expect(documentXml).toContain("<w:br/>");
    expect(documentXml).toContain('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"');
  });
});
