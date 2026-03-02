import type { ReportTemplate, ReportTableLayout, ReportValueFormat } from "../../../services/reportsService";

export type ReportRow = {
  key?: string;
  name: string;
  value: number;
};

export type RenderTable = Omit<ReportTableLayout, "id"> & {
  id: ReportTableLayout["id"] | "index-only";
  rows: ReportRow[];
  indexOnly?: boolean;
};

type BuildReportCanvasOptions = {
  report: ReportTemplate;
  reportDate: Date;
  tables: RenderTable[];
  maxRows: number;
  reportRangeLabel: string;
  logo: HTMLImageElement | null;
};

function getThemeColor(varName: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || fallback;
}

function getPrimaryColor() {
  return getThemeColor("--color-primary-500", "#178e9e");
}

function getSecondaryColor() {
  return getThemeColor("--color-secondary-500", "#32b3a3");
}

function getPrimaryTint() {
  return getThemeColor("--color-primary-50", "#eef7f9");
}

function formatForMetric(type: string): ReportValueFormat {
  if (["fyc", "afyc", "fyp", "afyp"].includes(type)) return "currency";
  return "count";
}

const currencyFormatter = new Intl.NumberFormat("en-SG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const countFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatValue(value: number, format: ReportValueFormat) {
  if (format === "currency") return `${currencyFormatter.format(value)}`;
  if (format === "number") return value.toFixed(2);
  return countFormatter.format(value);
}

function stripBrackets(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const testLine = current ? `${current} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = testLine;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function applyTemplate(template: string, date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return template
    .replaceAll("{YYYY}", year)
    .replaceAll("{MM}", month)
    .replaceAll("{DD}", day)
    .replaceAll("{YYYYMM}", `${year}${month}`)
    .replaceAll("{YYYYMMDD}", `${year}${month}${day}`);
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function resolveRenderedFootnote(
  table: RenderTable,
  reportDate: Date,
) {
  if (!table.footnote) return "";
  const rookieYears = table.rookieYears ?? 2;
  const rookieStartYear = reportDate.getFullYear() - rookieYears + 1;
  return table.rookieFilter === "rookies"
    ? table.footnote.replace("{YYYY}", String(rookieStartYear))
    : applyTemplate(table.footnote, reportDate);
}

function getSingleTableColumnLabel(table: RenderTable) {
  const title = (table.titleLines || [])
    .map((line) => stripBrackets(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  return title || table.valueLabel || "Value";
}

export function buildReportCanvas(options: BuildReportCanvasOptions) {
  const {
    report,
    reportDate,
    tables,
    maxRows,
    reportRangeLabel,
    logo,
  } = options;

  const pagePadding = 40;
  const pageBottomPadding = 24;
  const headerHeight = 150;
  const tableWidth = report.tableWidth;
  const tableGap = report.tableGap;
  const titlePadding = 8;
  const titleLineHeight = 14;
  const headerRowHeight = 28;
  const rowHeight = 24;
  const primaryColor = getPrimaryColor();
  const secondaryColor = getSecondaryColor();
  const hitRowColor = getPrimaryTint();

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  const footnoteLineHeight = 12;
  // Canvas text uses an alphabetic baseline, so this offset needs to be larger
  // than the visible gap we want above the first footnote line.
  const tableFootnoteTopPadding = 18;
  const footnoteBottomPadding = 2;
  const bottomFootnoteTopPaddingWithoutSiblingFooters = 24;
  // When a bottom footnote follows an actual table footnote block, most of the
  // baseline padding is already accounted for in that block, so a tight gap is
  // enough. A footer total row ends exactly at the border, so it needs the same
  // baseline-safe padding as a regular footnote block.
  const bottomFootnoteTopPaddingAfterTableFootnotes = 24;
  const bottomFootnoteTopPaddingAfterFooterRows = tableFootnoteTopPadding + 4;
  const bottomFootnotePadding = 2;
  const bottomFootnote = report.bottomFootnote
    ? applyTemplate(report.bottomFootnote, reportDate)
    : "";
  let bottomFootnoteLineCount = 0;
  let bottomFootnoteHeight = 0;
  const footnotesById = new Map<RenderTable["id"], { text: string; height: number }>();
  if (measureCtx) {
    measureCtx.font = "italic 12px \"Aptos Narrow\", sans-serif";
    tables.forEach((table) => {
      if (!table.footnote) return;
      const rookieYears = table.rookieYears ?? 2;
      const rookieStartYear = reportDate.getFullYear() - rookieYears + 1;
      const text = table.rookieFilter === "rookies"
        ? table.footnote.replace("{YYYY}", String(rookieStartYear))
        : applyTemplate(table.footnote, reportDate);
      const width = (table.indexOnly ? report.indexTableWidth : tableWidth) - 12;
      const lines = wrapText(measureCtx, text, width);
      const height =
        tableFootnoteTopPadding + footnoteBottomPadding + lines.length * footnoteLineHeight;
      footnotesById.set(table.id, { text, height });
    });
  }

  const maxTitleLines = 3;
  const maxTitleBlockHeight = titlePadding * 2 + maxTitleLines * titleLineHeight + 2;
  const singleTableNameColumnWidth = 120;
  const footerTotalFont = "800 12px \"Aptos Narrow\", sans-serif";

  const tableWidthFor = (table: RenderTable) =>
    table.indexOnly ? report.indexTableWidth : tableWidth;

  const totalGaps = tables.reduce((sum, table, idx) => {
    if (idx === 0) return sum;
    const prev = tables[idx - 1];
    if (prev.id === "index-only") return sum;
    return sum + tableGap;
  }, 0);
  const width = report.singleTable
    ? pagePadding * 2 +
      (report.includeIndexTable ? report.indexTableWidth : 0) +
      singleTableNameColumnWidth +
      tables.filter((table) => !table.indexOnly).length * tableWidth
    : pagePadding * 2 +
      tables.reduce((sum, table) => sum + tableWidthFor(table), 0) +
      totalGaps;
  if (measureCtx && bottomFootnote) {
    const bottomLines = wrapText(measureCtx, bottomFootnote, width - pagePadding * 2);
    bottomFootnoteLineCount = bottomLines.length;
  }
  const baseTableBlockHeight =
    maxTitleBlockHeight +
    headerRowHeight +
    rowHeight * maxRows;
  let extraTableBlockHeight = 0;
  let bottomAdjacentContent: "none" | "footer-row" | "footnote" = "none";
  const adjacentContentPriority = {
    none: 0,
    footnote: 1,
    "footer-row": 2,
  } as const;
  tables.forEach((table) => {
    const collapseRows =
      table.rookieFilter === "rookies" && table.includeAllAdvisors === false;
    const rowCount = collapseRows ? Math.max(1, table.rows.length) : maxRows;
    const rowsBottom =
      maxTitleBlockHeight +
      headerRowHeight +
      rowHeight * rowCount;
    let tableBottom = rowsBottom;
    let tableBottomType: "none" | "footer-row" | "footnote" = "none";

    if (table.includeFooterTotalRow) {
      const footerBottom = rowsBottom + rowHeight;
      if (footerBottom > tableBottom) {
        tableBottom = footerBottom;
        tableBottomType = "footer-row";
      }
    }

    const footnote = footnotesById.get(table.id);
    if (footnote) {
      const footnoteBottom =
        rowsBottom +
        (table.includeFooterTotalRow ? rowHeight : 0) +
        footnote.height;
      if (footnoteBottom > tableBottom) {
        tableBottom = footnoteBottom;
        tableBottomType = "footnote";
      }
    }

    const overflow = Math.max(0, tableBottom - baseTableBlockHeight);
    if (overflow > extraTableBlockHeight) {
      extraTableBlockHeight = overflow;
      bottomAdjacentContent = overflow > 0 ? tableBottomType : "none";
      return;
    }
    if (
      overflow === extraTableBlockHeight &&
      overflow > 0 &&
      adjacentContentPriority[tableBottomType] >
        adjacentContentPriority[bottomAdjacentContent]
    ) {
      bottomAdjacentContent = tableBottomType;
    }
  });
  const effectiveBottomFootnoteTopPadding = bottomAdjacentContent === "footnote"
    ? bottomFootnoteTopPaddingAfterTableFootnotes
    : bottomAdjacentContent === "footer-row"
      ? bottomFootnoteTopPaddingAfterFooterRows
      : bottomFootnoteTopPaddingWithoutSiblingFooters;
  if (bottomFootnote) {
    bottomFootnoteHeight =
      effectiveBottomFootnoteTopPadding +
      bottomFootnotePadding +
      bottomFootnoteLineCount * footnoteLineHeight;
  }
  const tableBlockHeight = baseTableBlockHeight + extraTableBlockHeight;

  let preLogoBottom = pagePadding;
  if (logo) {
    const maxWidth = width - pagePadding * 2;
    const ratio = logo.width / logo.height || 1;
    const logoHeight = 120;
    let logoWidth = logoHeight * ratio;
    let drawHeight = logoHeight;
    if (logoWidth > maxWidth) {
      logoWidth = maxWidth;
      drawHeight = logoWidth / ratio;
    }
    preLogoBottom = pagePadding + drawHeight + 14;
  }
  const tableTopY = Math.max(pagePadding + headerHeight, preLogoBottom + 70);
  const height =
    tableTopY +
    tableBlockHeight +
    bottomFootnoteHeight +
    pageBottomPadding;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  let logoBottom = pagePadding;
  if (logo) {
    const logoHeight = 120;
    const maxWidth = width - pagePadding * 2;
    const ratio = logo.width / logo.height || 1;
    let logoWidth = logoHeight * ratio;
    let drawHeight = logoHeight;
    if (logoWidth > maxWidth) {
      logoWidth = maxWidth;
      drawHeight = logoWidth / ratio;
    }
    const logoX = pagePadding + (maxWidth - logoWidth) / 2;
    const logoY = pagePadding;
    ctx.drawImage(logo, logoX, logoY, logoWidth, drawHeight);
    logoBottom = logoY + drawHeight + 14;
  }

  ctx.font = "600 26px \"Aptos Narrow\", sans-serif";
  ctx.fillStyle = "#0f172a";
  const titleText = report.title;
  const titleWidth = ctx.measureText(titleText).width;
  const titleX = pagePadding + (width - pagePadding * 2 - titleWidth) / 2;
  ctx.fillText(titleText, titleX, logoBottom + 24);

  ctx.font = "16px \"Aptos Narrow\", sans-serif";
  ctx.fillStyle = "#475569";
  const rangeWidth = ctx.measureText(reportRangeLabel).width;
  const rangeX = pagePadding + (width - pagePadding * 2 - rangeWidth) / 2;
  ctx.fillText(reportRangeLabel, rangeX, logoBottom + 48);

  if (report.singleTable) {
    const columnTitleFont = "600 12px \"Aptos Narrow\", sans-serif";
    const bodyFont = "700 12px \"Aptos Narrow\", sans-serif";
    const singleTableColumns = tables.filter((table) => !table.indexOnly);
    const singleHeaderLabels = singleTableColumns.map(getSingleTableColumnLabel);
    const rowMap = new Map<string, string>();
    const valueMaps = new Map<RenderTable["id"], Map<string, number>>();
    const columnTotals = new Map<RenderTable["id"], number>();

    singleTableColumns.forEach((table) => {
      const values = new Map<string, number>();
      let total = 0;
      table.rows.forEach((row) => {
        const key = row.key || row.name;
        if (!key) return;
        rowMap.set(key, row.name || key);
        values.set(key, row.value);
        total += row.value;
      });
      valueMaps.set(table.id, values);
      columnTotals.set(table.id, total);
    });

    const orderedRows = Array.from(rowMap.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    const rowCount = Math.max(1, orderedRows.length);
    const hasFooterTotals = singleTableColumns.some(
      (table) => table.includeFooterTotalRow === true,
    );
    const headerLabels = [
      ...(report.includeIndexTable ? ["No"] : []),
      "FSC",
      ...singleHeaderLabels,
    ];
    const columnWidths = [
      ...(report.includeIndexTable ? [report.indexTableWidth] : []),
      singleTableNameColumnWidth,
      ...singleTableColumns.map(() => tableWidth),
    ];

    ctx.font = columnTitleFont;
    const headerLineCounts = headerLabels.map((label, index) =>
      Math.max(
        1,
        wrapText(ctx, label, Math.max(20, columnWidths[index]! - 8)).length,
      ),
    );
    const singleHeaderRowHeight =
      8 + Math.max(...headerLineCounts) * titleLineHeight;

    const singleFootnoteBlocks = singleTableColumns
      .map((table, index) => {
        const text = resolveRenderedFootnote(table, reportDate);
        if (!text) return null;
        const label = `${singleHeaderLabels[index] || "Column"}: ${text}`;
        const lines = wrapText(
          ctx,
          label,
          width - pagePadding * 2 - 12,
        );
        return { label, lines };
      })
      .filter(
        (
          block,
        ): block is {
          label: string;
          lines: string[];
        } => block !== null,
      );
    const singleFootnoteHeight =
      singleFootnoteBlocks.length > 0
        ? tableFootnoteTopPadding +
          footnoteBottomPadding +
          singleFootnoteBlocks.reduce((sum, block) => sum + block.lines.length, 0) *
            footnoteLineHeight
        : 0;
    const singleBottomFootnoteTopPadding =
      singleFootnoteBlocks.length > 0
        ? bottomFootnoteTopPaddingAfterTableFootnotes
        : hasFooterTotals
          ? bottomFootnoteTopPaddingAfterFooterRows
          : bottomFootnoteTopPaddingWithoutSiblingFooters;
    const singleTableWidth = columnWidths.reduce((sum, value) => sum + value, 0);
    const singleTableHeight =
      singleHeaderRowHeight +
      rowHeight * rowCount +
      (hasFooterTotals ? rowHeight : 0);
    const singleCanvasHeight =
      tableTopY +
      singleTableHeight +
      singleFootnoteHeight +
      (bottomFootnote
        ? singleBottomFootnoteTopPadding +
          bottomFootnotePadding +
          bottomFootnoteLineCount * footnoteLineHeight
        : 0) +
      pageBottomPadding;

    canvas.height = singleCanvasHeight * scale;
    canvas.style.height = `${singleCanvasHeight}px`;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, singleCanvasHeight);

    if (logo) {
      const logoHeight = 120;
      const maxWidth = width - pagePadding * 2;
      const ratio = logo.width / logo.height || 1;
      let logoWidth = logoHeight * ratio;
      let drawHeight = logoHeight;
      if (logoWidth > maxWidth) {
        logoWidth = maxWidth;
        drawHeight = logoWidth / ratio;
      }
      const logoX = pagePadding + (maxWidth - logoWidth) / 2;
      const logoY = pagePadding;
      ctx.drawImage(logo, logoX, logoY, logoWidth, drawHeight);
    }

    ctx.font = "600 26px \"Aptos Narrow\", sans-serif";
    ctx.fillStyle = "#0f172a";
    ctx.fillText(titleText, titleX, logoBottom + 24);

    ctx.font = "16px \"Aptos Narrow\", sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText(reportRangeLabel, rangeX, logoBottom + 48);

    const x = pagePadding;
    const y = tableTopY;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, singleTableWidth, singleTableHeight);
    ctx.strokeRect(x, y, singleTableWidth, singleTableHeight);

    const headerTop = y;
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(x, headerTop, singleTableWidth, singleHeaderRowHeight);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x, headerTop, singleTableWidth, singleHeaderRowHeight);

    let currentColumnX = x;
    columnWidths.forEach((columnWidth, index) => {
      if (index > 0) {
        ctx.beginPath();
        ctx.moveTo(currentColumnX, headerTop);
        ctx.lineTo(currentColumnX, headerTop + singleTableHeight);
        ctx.stroke();
      }

      const lines = wrapText(
        ctx,
        headerLabels[index]!,
        Math.max(20, columnWidth - 8),
      );
      const contentHeight = lines.length * titleLineHeight;
      let headerY =
        headerTop + (singleHeaderRowHeight - contentHeight) / 2 + 10;
      ctx.fillStyle = "#ffffff";
      ctx.font = columnTitleFont;
      lines.forEach((line) => {
        const lineWidth = ctx.measureText(line).width;
        const lineX = currentColumnX + (columnWidth - lineWidth) / 2;
        ctx.fillText(line, lineX, headerY);
        headerY += titleLineHeight;
      });
      currentColumnX += columnWidth;
    });

    ctx.font = bodyFont;
    orderedRows.forEach((row, rowIndex) => {
      const rowTop = headerTop + singleHeaderRowHeight + rowIndex * rowHeight;
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(x, rowTop, singleTableWidth, rowHeight);
      let cellX = x;

      if (report.includeIndexTable) {
        const indexWidth = columnWidths[0]!;
        ctx.textAlign = "center";
        ctx.fillStyle = "#0f172a";
        ctx.fillText(String(rowIndex + 1), cellX + indexWidth / 2, rowTop + 16);
        cellX += indexWidth;
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";
      ctx.fillText(row.name, cellX + 4, rowTop + 16);
      cellX += singleTableNameColumnWidth;

      singleTableColumns.forEach((table) => {
        const columnWidth = tableWidth;
        const value = valueMaps.get(table.id)?.get(row.key) ?? 0;
        if (
          table.highlightMin &&
          value >= (table.minValue ?? 0)
        ) {
          ctx.fillStyle = hitRowColor;
          ctx.fillRect(cellX, rowTop, columnWidth, rowHeight);
        }
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(cellX, rowTop, columnWidth, rowHeight);
        ctx.fillStyle = "#0f172a";
        ctx.textAlign = "right";
        ctx.fillText(
          formatValue(value, formatForMetric(table.metric?.type || "countClosings")),
          cellX + columnWidth - 4,
          rowTop + 16,
        );
        cellX += columnWidth;
      });

      ctx.textAlign = "left";
    });

    if (hasFooterTotals) {
      const footerTop = headerTop + singleHeaderRowHeight + rowCount * rowHeight;
      ctx.fillStyle = secondaryColor;
      ctx.fillRect(x, footerTop, singleTableWidth, rowHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(x, footerTop, singleTableWidth, rowHeight);
      let cellX = x;
      if (report.includeIndexTable) {
        cellX += columnWidths[0]!;
      }
      ctx.fillStyle = "#ffffff";
      ctx.font = footerTotalFont;
      ctx.textAlign = "left";
      ctx.fillText("Total", cellX + 4, footerTop + 16);
      cellX += singleTableNameColumnWidth;
      singleTableColumns.forEach((table) => {
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(cellX, footerTop, tableWidth, rowHeight);
        if (table.includeFooterTotalRow) {
          ctx.fillStyle = "#ffffff";
          ctx.textAlign = "right";
          ctx.fillText(
            formatValue(
              columnTotals.get(table.id) ?? 0,
              formatForMetric(table.metric?.type || "countClosings"),
            ),
            cellX + tableWidth - 4,
            footerTop + 16,
          );
        }
        cellX += tableWidth;
      });
      ctx.textAlign = "left";
    }

    if (singleFootnoteBlocks.length > 0) {
      ctx.font = "italic 12px \"Aptos Narrow\", sans-serif";
      ctx.fillStyle = "#475569";
      let footnoteY = y + singleTableHeight + tableFootnoteTopPadding;
      singleFootnoteBlocks.forEach((block) => {
        block.lines.forEach((line) => {
          ctx.fillText(line, x + 6, footnoteY);
          footnoteY += footnoteLineHeight;
        });
      });
    }

    if (bottomFootnote) {
      ctx.font = "italic 12px \"Aptos Narrow\", sans-serif";
      ctx.fillStyle = "#475569";
      ctx.textAlign = "center";
      const bottomLines = wrapText(ctx, bottomFootnote, width - pagePadding * 2);
      let bottomY =
        tableTopY +
        singleTableHeight +
        singleFootnoteHeight +
        singleBottomFootnoteTopPadding;
      bottomLines.forEach((line) => {
        ctx.fillText(line, width / 2, bottomY);
        bottomY += footnoteLineHeight;
      });
      ctx.textAlign = "left";
    }

    return { canvas, width, height: singleCanvasHeight };
  }

  let currentX = pagePadding;
  tables.forEach((table, index) => {
    if (index > 0) {
      const prev = tables[index - 1];
      currentX += tableWidthFor(prev);
      currentX += prev.id === "index-only" ? 0 : tableGap;
    }
    const x = currentX;
    const y = tableTopY;
    const activeTableWidth = tableWidthFor(table);
    const collapseRows = table.rookieFilter === "rookies" && table.includeAllAdvisors === false;
    const rowCount = collapseRows ? Math.max(1, table.rows.length) : maxRows;
    const titleLines = table.titleLines ?? [];
    const tableTitleBlockHeight = maxTitleBlockHeight;
    const tableHeight =
      tableTitleBlockHeight +
      headerRowHeight +
      rowHeight * rowCount +
      (table.includeFooterTotalRow ? rowHeight : 0);

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, activeTableWidth, tableHeight);
    ctx.strokeRect(x, y, activeTableWidth, tableHeight);

    ctx.fillStyle = primaryColor;
    ctx.font = "600 12px \"Aptos Narrow\", sans-serif";
    const titleBlockHeight = tableTitleBlockHeight;
    const titleOffset = ((maxTitleLines - titleLines.length) * titleLineHeight) / 2;
    let titleY = y + titlePadding + 10 + titleOffset;
    ctx.fillStyle = primaryColor;
    ctx.fillRect(x, y, activeTableWidth, titleBlockHeight);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x, y, activeTableWidth, titleBlockHeight);
    ctx.fillStyle = "#ffffff";
    titleLines.forEach((rawLine, lineIndex) => {
      const isLastLine = lineIndex === titleLines.length - 1;
      const line = isLastLine ? stripBrackets(rawLine) : rawLine;
      ctx.font = `${isLastLine ? "italic " : ""}600 12px \"Aptos Narrow\", sans-serif`;
      const lineWidth = ctx.measureText(line).width;
      const lineX = x + (activeTableWidth - lineWidth) / 2;
      ctx.fillText(line, lineX, titleY);
      titleY += titleLineHeight;
    });

    const headerTop = y + titleBlockHeight;
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(x, headerTop, activeTableWidth, headerRowHeight);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x, headerTop, activeTableWidth, headerRowHeight);

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 12px \"Aptos Narrow\", sans-serif";

    const indexWidth = table.indexOnly ? activeTableWidth - 16 : table.showIndex ? 32 : 0;
    const namePadding = 2;
    const nameWidth = table.indexOnly ? 0 : 100;
    const valueWidth = table.indexOnly ? 0 : activeTableWidth - indexWidth - nameWidth - 16;
    const colStart = x + 8;
    const col1X = colStart + indexWidth;
    const col2X = colStart + indexWidth + nameWidth;

    if (table.showIndex) {
      ctx.textAlign = "center";
      ctx.fillText("No", colStart + indexWidth / 2, headerTop + 18);
    }
    if (!table.indexOnly) {
      ctx.textAlign = "left";
      ctx.fillText("Name", colStart + indexWidth + namePadding, headerTop + 18);
      ctx.textAlign = "right";
      ctx.fillText(table.valueLabel, colStart + indexWidth + nameWidth + valueWidth, headerTop + 18);
    }
    ctx.textAlign = "left";
    ctx.strokeStyle = "#000000";
    ctx.beginPath();
    if (table.showIndex && !table.indexOnly) {
      ctx.moveTo(col1X, headerTop);
      ctx.lineTo(col1X, headerTop + headerRowHeight);
    }
    if (!table.indexOnly) {
      ctx.moveTo(col2X, headerTop);
      ctx.lineTo(col2X, headerTop + headerRowHeight);
    }
    ctx.stroke();

    ctx.font = "700 12px \"Aptos Narrow\", sans-serif";
    ctx.fillStyle = "#0f172a";

    for (let i = 0; i < rowCount; i++) {
      const rowTop = headerTop + headerRowHeight + i * rowHeight;
      const row = table.rows[i];
      if (!table.indexOnly && row && table.highlightMin && row.value >= (table.minValue ?? 0)) {
        ctx.fillStyle = hitRowColor;
        ctx.fillRect(x, rowTop, activeTableWidth, rowHeight);
      }
      const shouldDrawRow = row || !collapseRows;
      if (shouldDrawRow) {
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(x, rowTop, activeTableWidth, rowHeight);
        ctx.beginPath();
        if (table.showIndex && !table.indexOnly) {
          ctx.moveTo(col1X, rowTop);
          ctx.lineTo(col1X, rowTop + rowHeight);
        }
        if (!table.indexOnly) {
          ctx.moveTo(col2X, rowTop);
          ctx.lineTo(col2X, rowTop + rowHeight);
        }
        ctx.stroke();
      }
      if (!row) continue;

      ctx.fillStyle = "#0f172a";
      const metricType = table.metric?.type || "countClosings";
      const value = formatValue(row.value, formatForMetric(metricType));
      if (table.showIndex) {
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), colStart + indexWidth / 2, rowTop + 16);
      }
      if (!table.indexOnly) {
        ctx.textAlign = "left";
        ctx.fillText(row.name, colStart + indexWidth + namePadding, rowTop + 16);
        ctx.textAlign = "right";
        ctx.fillText(value, colStart + indexWidth + nameWidth + valueWidth, rowTop + 16);
      }
      ctx.textAlign = "left";
    }

    const footerRowTop = headerTop + headerRowHeight + rowHeight * rowCount;
    if (table.includeFooterTotalRow) {
      ctx.fillStyle = secondaryColor;
      ctx.fillRect(x, footerRowTop, activeTableWidth, rowHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(x, footerRowTop, activeTableWidth, rowHeight);
      ctx.beginPath();
      if (table.showIndex && !table.indexOnly) {
        ctx.moveTo(col1X, footerRowTop);
        ctx.lineTo(col1X, footerRowTop + rowHeight);
      }
      if (!table.indexOnly) {
        ctx.moveTo(col2X, footerRowTop);
        ctx.lineTo(col2X, footerRowTop + rowHeight);
      }
      ctx.stroke();

      if (!table.indexOnly) {
        const metricType = table.metric?.type || "countClosings";
        const totalValue = table.rows.reduce((sum, row) => sum + row.value, 0);
        ctx.fillStyle = "#ffffff";
        ctx.font = footerTotalFont;
        ctx.textAlign = "left";
        ctx.fillText("Total", colStart + indexWidth + namePadding, footerRowTop + 16);
        ctx.textAlign = "right";
        ctx.fillText(
          formatValue(totalValue, formatForMetric(metricType)),
          colStart + indexWidth + nameWidth + valueWidth,
          footerRowTop + 16,
        );
        ctx.textAlign = "left";
      }
    }

    const footnote = footnotesById.get(table.id);
    if (footnote) {
      ctx.font = "italic 12px \"Aptos Narrow\", sans-serif";
      ctx.fillStyle = "#475569";
      ctx.textAlign = "left";
      const footerLines = wrapText(ctx, footnote.text, activeTableWidth - 12);
      let footerY =
        footerRowTop +
        (table.includeFooterTotalRow ? rowHeight : 0) +
        tableFootnoteTopPadding;
      footerLines.forEach((line) => {
        ctx.fillText(line, x + 6, footerY);
        footerY += footnoteLineHeight;
      });
      ctx.textAlign = "left";
    }
  });

  if (bottomFootnote) {
    ctx.font = "italic 12px \"Aptos Narrow\", sans-serif";
    ctx.fillStyle = "#475569";
    ctx.textAlign = "center";
    const bottomLines = wrapText(ctx, bottomFootnote, width - pagePadding * 2);
    let bottomY =
      tableTopY +
      tableBlockHeight +
      effectiveBottomFootnoteTopPadding;
    bottomLines.forEach((line) => {
      ctx.fillText(line, width / 2, bottomY);
      bottomY += footnoteLineHeight;
    });
    ctx.textAlign = "left";
  }

  return { canvas, width, height };
}
