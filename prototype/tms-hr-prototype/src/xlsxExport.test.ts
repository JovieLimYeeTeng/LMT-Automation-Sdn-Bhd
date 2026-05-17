import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildXlsxReportBuffer } from "./xlsxExport";

async function worksheetFromBuffer(buffer: ArrayBuffer, sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  const loadWorkbook = workbook.xlsx.load as (data: unknown) => Promise<ExcelJS.Workbook>;
  await loadWorkbook.call(workbook.xlsx, Buffer.from(buffer));
  return workbook.getWorksheet(sheetName);
}

describe("xlsx export", () => {
  it("builds a valid editable xlsx workbook with report metadata and selected rows", async () => {
    const buffer = await buildXlsxReportBuffer(
      "Monthly Attendance Summary Report",
      [
        "Month 2026-04",
        "Company: All",
        "Department: Warehouse",
        "Position: Not set",
        "Employee: Night Nadia (1006)",
        "Export date: 2026/05/15 17:45",
      ],
      [
        "Employee No.",
        "Name",
        "Department",
        "Shift",
        "Work days",
        "Attend days",
        "Absent",
        "Late mins",
        "Late times",
        "Early mins",
        "Early times",
        "OT hours",
        "Status",
        "Remarks",
      ],
      [
        {
          "Employee No.": "1006",
          Name: "Night Nadia",
          Department: "Warehouse",
          Shift: "Morning",
          "Work days": 20,
          "Attend days": 20,
          Absent: 0,
          "Late mins": "2 hours 54 mins",
          "Late times": 16,
          "Early mins": "-",
          "Early times": 0,
          "OT hours": "22.5",
          Status: "Reviewed",
          Remarks: "Editable remark",
        },
      ],
    );

    expect(Buffer.from(buffer).subarray(0, 2).toString("utf8")).toBe("PK");
    const zip = await JSZip.loadAsync(buffer);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");

    expect(sheetXml).toContain('<ignoredError sqref="A9:A9" numberStoredAsText="1"/>');
    expect(sheetXml).not.toContain('state="frozen"');
    expect(sheetXml).not.toContain("<pane");

    const worksheet = await worksheetFromBuffer(buffer, "Monthly Attendance Summary Repo");

    expect(worksheet).toBeDefined();
    expect((worksheet?.views ?? []).some((view) => view.state === "frozen")).toBe(false);
    expect(worksheet?.getCell("A1").value).toBe("Monthly Attendance Summary Report");
    expect(worksheet?.getCell("A1").font).toMatchObject({ name: "Microsoft YaHei", bold: true, size: 14 });
    expect(worksheet?.getCell("A2").value).toBe("Month:");
    expect(worksheet?.getCell("B2").value).toBe("2026-04");
    expect(worksheet?.getCell("B2").alignment?.wrapText).not.toBe(true);
    expect(worksheet?.getCell("A7").value).toBe("Export date:");
    expect(worksheet?.getCell("B7").alignment?.wrapText).not.toBe(true);
    expect(worksheet?.getColumn(1).width).toBeGreaterThanOrEqual(14);
    expect(worksheet?.getColumn(3).width).toBeGreaterThanOrEqual(14);
    expect(worksheet?.getColumn(8).width).toBeGreaterThanOrEqual(18);
    expect(worksheet?.getCell("A8").value).toBe("Employee No.");
    expect(worksheet?.getCell("A8").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("A8").font).toMatchObject({ name: "Microsoft YaHei", bold: true, size: 10 });
    expect(worksheet?.getCell("A2").font?.bold).toBe(true);
    expect(worksheet?.getCell("A2").alignment?.horizontal).toBe("left");
    expect(worksheet?.getCell("B2").alignment?.horizontal).toBe("left");
    expect(worksheet?.getCell("A9").value).toBe("1006");
    expect(worksheet?.getCell("A9").numFmt).toBe("@");
    expect(worksheet?.getCell("A9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("B9").value).toBe("Night Nadia");
    expect(worksheet?.getCell("B9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("C9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("D9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("E9").value).toBe(20);
    expect(worksheet?.getCell("E9").numFmt).toBe("0");
    expect(worksheet?.getCell("E9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("F9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("G9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("H9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("I9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("J9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("K9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("L9").value).toBe(22.5);
    expect(worksheet?.getCell("L9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("M9").alignment?.horizontal).toBe("center");
    expect(worksheet?.getCell("N9").alignment?.horizontal).toBe("left");
  });

  it("uses the same report template for Chinese and English exports", async () => {
    const englishBuffer = await buildXlsxReportBuffer(
      "Monthly Attendance Summary Report",
      ["Month 2026-04", "Company: All", "Department: Warehouse", "Position: Not set", "Employee: Night Nadia (1006)", "Export date: 2026/05/15 17:45"],
      ["Employee No.", "Name", "Department", "Shift", "Work days", "Attend days", "Absent", "Late mins", "Late times", "Early mins", "Early times", "OT hours", "Status", "Remarks"],
      [{
        "Employee No.": "1006",
        Name: "Night Nadia",
        Department: "Warehouse",
        Shift: "Morning",
        "Work days": 20,
        "Attend days": 20,
        Absent: 0,
        "Late mins": "2 hours 54 mins",
        "Late times": 16,
        "Early mins": "-",
        "Early times": 0,
        "OT hours": "22.5",
        Status: "Reviewed",
        Remarks: "Editable remark",
      }],
    );
    const chineseBuffer = await buildXlsxReportBuffer(
      "\u6708\u5EA6\u8003\u52E4\u6C47\u603B\u62A5\u8868",
      [
        "\u6708\u4EFD 2026-04",
        "\u516C\u53F8\uFF1A\u5168\u90E8",
        "\u90E8\u95E8\uFF1A\u4ED3\u5E93",
        "\u804C\u4F4D\uFF1A\u672A\u8BBE\u7F6E",
        "\u5458\u5DE5\uFF1ANight Nadia\uFF081006\uFF09",
        "\u5BFC\u51FA\u65F6\u95F4\uFF1A2026/05/15 17:45",
      ],
      [
        "\u5458\u5DE5\u7F16\u53F7",
        "\u59D3\u540D",
        "\u90E8\u95E8",
        "\u73ED\u6B21",
        "\u5DE5\u4F5C\u5929",
        "\u51FA\u52E4\u5929",
        "\u65F7\u5DE5",
        "\u8FDF\u5230\u5206\u949F",
        "\u8FDF\u5230\u6B21\u6570",
        "\u65E9\u9000\u5206\u949F",
        "\u65E9\u9000\u6B21\u6570",
        "\u52A0\u73ED\u5C0F\u65F6",
        "\u72B6\u6001",
        "\u5907\u6CE8",
      ],
      [{
        "\u5458\u5DE5\u7F16\u53F7": "1006",
        "\u59D3\u540D": "Night Nadia",
        "\u90E8\u95E8": "\u4ED3\u5E93",
        "\u73ED\u6B21": "\u65E9\u73ED",
        "\u5DE5\u4F5C\u5929": 20,
        "\u51FA\u52E4\u5929": 20,
        "\u65F7\u5DE5": 0,
        "\u8FDF\u5230\u5206\u949F": "2\u5C0F\u65F654\u5206\u949F",
        "\u8FDF\u5230\u6B21\u6570": 16,
        "\u65E9\u9000\u5206\u949F": "-",
        "\u65E9\u9000\u6B21\u6570": 0,
        "\u52A0\u73ED\u5C0F\u65F6": "22.5",
        "\u72B6\u6001": "\u5DF2\u590D\u6838",
        "\u5907\u6CE8": "\u53EF\u7F16\u8F91\u5907\u6CE8",
      }],
    );

    const englishSheet = await worksheetFromBuffer(englishBuffer, "Monthly Attendance Summary Repo");
    const chineseSheet = await worksheetFromBuffer(chineseBuffer, "\u6708\u5EA6\u8003\u52E4\u6C47\u603B\u62A5\u8868");

    expect(englishSheet?.getRow(1).height).toBe(chineseSheet?.getRow(1).height);
    expect(englishSheet?.getRow(8).height).toBe(chineseSheet?.getRow(8).height);
    expect(englishSheet?.getCell("A1").font).toMatchObject(chineseSheet?.getCell("A1").font ?? {});
    expect(englishSheet?.getCell("A2").font).toMatchObject(chineseSheet?.getCell("A2").font ?? {});
    expect(englishSheet?.getCell("B2").font).toMatchObject(chineseSheet?.getCell("B2").font ?? {});
    expect(englishSheet?.getCell("A8").font).toMatchObject(chineseSheet?.getCell("A8").font ?? {});
    expect(englishSheet?.getCell("A8").fill).toEqual(chineseSheet?.getCell("A8").fill);
    expect(englishSheet?.getCell("A8").alignment).toEqual(chineseSheet?.getCell("A8").alignment);

    ["A9", "B9", "C9", "D9", "E9", "H9", "I9", "J9", "K9", "L9", "M9", "N9"].forEach((cell) => {
      expect(englishSheet?.getCell(cell).font).toMatchObject(chineseSheet?.getCell(cell).font ?? {});
      expect(englishSheet?.getCell(cell).alignment?.horizontal).toBe(chineseSheet?.getCell(cell).alignment?.horizontal);
      expect(englishSheet?.getCell(cell).alignment?.vertical).toBe(chineseSheet?.getCell(cell).alignment?.vertical);
    });
  });
});
