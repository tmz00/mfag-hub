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
  pixelScale?: number;
};

const isCombinedTableReport = (report: ReportTemplate): boolean =>
  report.layoutMode
    ? report.layoutMode === "combinedFsc"
    : report.singleTable === true;

const primaryRowHeaderLabel = (report: ReportTemplate): string =>
  String(report.primaryColumnHeader || "").trim() ||
  (report.layoutMode === "agencySummary" ? "Agency" : "Name");

const primaryColumnWidth = (report: ReportTemplate, fallback: number): number =>
  typeof report.primaryColumnWidth === "number" &&
  Number.isFinite(report.primaryColumnWidth)
    ? Math.max(40, report.primaryColumnWidth)
    : fallback;

const DEFAULT_CANVAS_SCALE = 2;
const MAX_CANVAS_SCALE = 6;
const MIN_PAGE_ASPECT_RATIO = 0.8;
const MAX_PAGE_ASPECT_RATIO = 1.8;
const FONT_SIZE_FACTOR = 0.73;

function reportFont(
  size: number,
  weight = 400,
  options?: { italic?: boolean },
) {
  return `${options?.italic ? "italic " : ""}${weight} ${size}px "Barlow", sans-serif`;
}

function italicizeFont(font: string) {
  return font.startsWith("italic ") ? font : `italic ${font}`;
}

function resolveCanvasScale(value?: number) {
  const next = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_CANVAS_SCALE;
  return Math.min(MAX_CANVAS_SCALE, Math.max(1, next));
}

function stabilizePageAspectRatio(
  width: number,
  height: number,
  pagePadding: number,
) {
  let safeWidth = Math.max(1, width);
  let safeHeight = Math.max(1, height);
  const minimumWidth = Math.max(pagePadding * 2 + 1, Math.ceil(safeHeight * MIN_PAGE_ASPECT_RATIO));
  if (safeWidth < minimumWidth) {
    safeWidth = minimumWidth;
  }
  const maximumWidth = Math.floor(safeHeight * MAX_PAGE_ASPECT_RATIO);
  if (maximumWidth > 0 && safeWidth > maximumWidth) {
    safeHeight = Math.ceil(safeWidth / MAX_PAGE_ASPECT_RATIO);
  }
  return [safeWidth, safeHeight] as const;
}

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

type RenderedTitleLine = {
  text: string;
  italic: boolean;
};

function getRenderedTitleLines(titleLines?: string[]): RenderedTitleLine[] {
  return (titleLines || [])
    .slice(0, 3)
    .map((line, index) => {
      if (index > 0 && line.trim().length === 0) {
        return null;
      }

      if (index === 2) {
        return {
          text: stripBrackets(line),
          italic: true,
        };
      }

      return {
        text: line,
        italic: false,
      };
    })
    .filter((line): line is RenderedTitleLine => line !== null);
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const testLine = current ? `${current} ${word}` : word;
    if (ctx.measureText(testLine).width * FONT_SIZE_FACTOR > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = testLine;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function wrapTextPreservingEmpty(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (text.length === 0) {
    return [text];
  }

  const lines = wrapText(ctx, text, maxWidth);
  return lines.length > 0 ? lines : [text];
}

function wrapRenderedTitleLines(
  ctx: CanvasRenderingContext2D,
  lines: RenderedTitleLine[],
  maxWidth: number,
): RenderedTitleLine[] {
  return lines.flatMap((line) =>
    wrapTextPreservingEmpty(ctx, line.text, maxWidth).map((text) => ({
      text,
      italic: line.italic,
    })),
  );
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

function getSingleTableHeaderLines(table: RenderTable) {
  return getRenderedTitleLines(table.titleLines);
}

function getSingleTableFootnoteLabel(table: RenderTable) {
  const title = getSingleTableHeaderLines(table)
    .map((line) => line.text)
    .filter((line) => line.trim().length > 0)
    .join(" ");
  return title || (table.valueLabel || "").trim();
}

function getSingleTableGroupLabel(table: RenderTable) {
  return (table.valueLabel || "").trim();
}

function getSingleTableMetricColumnGapBefore(
  labels: string[],
  tableGap: number,
) {
  return labels.map((label, index) =>
    index === 0 || label !== labels[index - 1] ? tableGap : 0,
  );
}

function getAgencyGroupLabel(table: RenderTable) {
  return String(table.agencyGroupLabel || "").trim();
}

function groupTablesByAgencySection(tables: RenderTable[]) {
  const sections: Array<{ label: string; tables: RenderTable[] }> = [];
  tables.forEach((table) => {
    const label = getAgencyGroupLabel(table);
    if (!label) return;
    const previous = sections[sections.length - 1];
    if (previous && previous.label === label) {
      previous.tables.push(table);
      return;
    }
    sections.push({ label, tables: [table] });
  });
  return sections.length > 0 ? sections : [];
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
  const titleTextBaselineInset = 20;
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
    measureCtx.font = reportFont(12, 400, { italic: true });
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
  const singleTitleRowMinHeight = titlePadding * 2 + titleLineHeight + 2;
  const agencyHeaderHeight = singleTitleRowMinHeight;
  const firstColumnHeader = primaryRowHeaderLabel(report);
  const singleTableNameColumnWidth = primaryColumnWidth(report, 120);
  const footerTotalFont = reportFont(12, 800);
  const singleTableColumns = tables.filter((table) => !table.indexOnly);
  const singleTableGroupLabels = singleTableColumns.map(getSingleTableGroupLabel);
  const singleTableAgencySections = groupTablesByAgencySection(
    singleTableColumns,
  ).map((section) => ({ label: section.label, columns: section.tables }));
  const hasAgencySingleTableSections = singleTableAgencySections.length > 0;
  const singleTableMetricColumnGaps = getSingleTableMetricColumnGapBefore(
    singleTableGroupLabels,
    tableGap,
  );
  const singleTableGroupGapWidth = singleTableMetricColumnGaps.reduce(
    (sum, gap) => sum + gap,
    0,
  );

  const standardTableWidthFor = (table: RenderTable) =>
    table.indexOnly
      ? report.indexTableWidth
      : (table.showIndex ? 32 : 0) + primaryColumnWidth(report, 100) + tableWidth + 16;
  const tableWidthFor = standardTableWidthFor;

  const totalGaps = tables.reduce((sum, table, idx) => {
    if (idx === 0) return sum;
    const prev = tables[idx - 1];
    if (prev.id === "index-only") return sum;
    return sum + tableGap;
  }, 0);
  const tableBlockWidth = tables.reduce((sum, table) => sum + tableWidthFor(table), 0) + totalGaps;
  const combinedTableReport = isCombinedTableReport(report);
  const standardAgencySections =
    !combinedTableReport ? groupTablesByAgencySection(tables) : [];
  const hasStandardAgencySections = standardAgencySections.length > 0;
  const tableBlockWidthForTables = (items: RenderTable[]) =>
    items.reduce((sum, table, index) => {
      const gap =
        index > 0 && items[index - 1]?.id !== "index-only" ? tableGap : 0;
      return sum + gap + tableWidthFor(table);
    }, 0);
  const agencySectionGap =
    typeof report.agencyTableGap === "number" && Number.isFinite(report.agencyTableGap)
      ? Math.max(0, report.agencyTableGap)
      : Math.max(24, tableGap * 2);
  const standardAgencyBlockWidth = hasStandardAgencySections
    ? Math.max(
        0,
        ...standardAgencySections.map((section) =>
          tableBlockWidthForTables(section.tables),
        ),
      )
    : 0;
  const standardSectionsForHeight = hasStandardAgencySections
    ? standardAgencySections
    : [{ label: "", tables }];
  const rowCapacityForStandardSection = (sectionTables: RenderTable[]) =>
    hasStandardAgencySections
      ? Math.max(1, ...sectionTables.map((table) => table.rows.length))
      : maxRows;
  const singleAgencySectionWidth =
    hasAgencySingleTableSections
      ? Math.max(
          0,
          ...singleTableAgencySections.map(
            (section) =>
              (report.includeIndexTable ? report.indexTableWidth : 0) +
              singleTableNameColumnWidth +
              section.columns.length * tableWidth,
          ),
        )
      : 0;
  let width = combinedTableReport
    ? pagePadding * 2 +
      (hasAgencySingleTableSections
        ? singleAgencySectionWidth
        : (report.includeIndexTable ? report.indexTableWidth : 0) +
          singleTableNameColumnWidth +
          singleTableColumns.length * tableWidth +
          singleTableGroupGapWidth)
    : pagePadding * 2 +
      (hasStandardAgencySections ? standardAgencyBlockWidth : tableBlockWidth);
  if (measureCtx && bottomFootnote) {
    const bottomLines = wrapText(measureCtx, bottomFootnote, width - pagePadding * 2);
    bottomFootnoteLineCount = bottomLines.length;
  }
  let maxTableBlockHeight = 0;
  let bottomAdjacentContent: "none" | "footer-row" | "footnote" = "none";
  const adjacentContentPriority = {
    none: 0,
    footnote: 1,
    "footer-row": 2,
  } as const;
  const tableBlockHeightForStandardSection = (sectionTables: RenderTable[]) => {
    const sectionRowCapacity = rowCapacityForStandardSection(sectionTables);
    const baseHeight =
      maxTitleBlockHeight +
      headerRowHeight +
      rowHeight * sectionRowCapacity;
    let sectionHeight = baseHeight;
    let sectionBottomType: "none" | "footer-row" | "footnote" = "none";

    sectionTables.forEach((table) => {
      const collapseRows =
        table.rookieFilter === "rookies" && table.includeAllAdvisors === false;
      const rowCount = collapseRows
        ? Math.max(1, table.rows.length)
        : sectionRowCapacity;
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

      if (tableBottom > sectionHeight) {
        sectionHeight = tableBottom;
        sectionBottomType = tableBottomType;
      } else if (
        tableBottom === sectionHeight &&
        adjacentContentPriority[tableBottomType] >
          adjacentContentPriority[sectionBottomType]
      ) {
        sectionBottomType = tableBottomType;
      }
    });

    if (
      sectionHeight > maxTableBlockHeight ||
      (sectionHeight === maxTableBlockHeight &&
        adjacentContentPriority[sectionBottomType] >
          adjacentContentPriority[bottomAdjacentContent])
    ) {
      maxTableBlockHeight = sectionHeight;
      bottomAdjacentContent = sectionBottomType;
    }

    return sectionHeight;
  };
  const standardSectionHeights = standardSectionsForHeight.map((section) =>
    tableBlockHeightForStandardSection(section.tables),
  );
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
  const tableBlockHeight = maxTableBlockHeight;
  const renderedTableBlockHeight = hasStandardAgencySections
    ? standardSectionHeights.reduce((sum, height) => sum + height, 0) +
      standardAgencySections.length * agencyHeaderHeight +
      Math.max(0, standardAgencySections.length - 1) * agencySectionGap
    : tableBlockHeight;

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
  let height =
    tableTopY +
    renderedTableBlockHeight +
    bottomFootnoteHeight +
    pageBottomPadding;
  [width, height] = stabilizePageAspectRatio(width, height, pagePadding);

  const scale = resolveCanvasScale(options.pixelScale);
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

  ctx.font = reportFont(26, 600);
  ctx.fillStyle = "#0f172a";
  const titleText = report.title;
  const titleWidth = ctx.measureText(titleText).width;
  const titleX = pagePadding + (width - pagePadding * 2 - titleWidth) / 2;
  ctx.fillText(titleText, titleX, logoBottom + 24);

  ctx.font = reportFont(16, 400);
  ctx.fillStyle = "#475569";
  const rangeWidth = ctx.measureText(reportRangeLabel).width;
  const rangeX = pagePadding + (width - pagePadding * 2 - rangeWidth) / 2;
  ctx.fillText(reportRangeLabel, rangeX, logoBottom + 48);

  if (combinedTableReport) {
    const columnTitleFont = reportFont(12, 900);
    const bodyFont = reportFont(12, 700);
    if (hasAgencySingleTableSections) {
      const sectionGap = agencySectionGap;
      const indexColumnWidth = report.includeIndexTable ? report.indexTableWidth : 0;
      const leadingWidth = indexColumnWidth + singleTableNameColumnWidth;
      const sectionLayouts = singleTableAgencySections.map((section) => {
        const rowMap = new Map<string, string>();
        const valueMaps = new Map<RenderTable["id"], Map<string, number>>();
        const columnTotals = new Map<RenderTable["id"], number>();
        section.columns.forEach((table) => {
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
        const headerLineSets = section.columns.map((table) =>
          wrapRenderedTitleLines(
            ctx,
            getSingleTableHeaderLines(table),
            Math.max(20, tableWidth - 8),
          ),
        );
        const headerLineCounts = [
          ...(report.includeIndexTable ? [1] : []),
          1,
          ...headerLineSets.map((lines) => Math.max(1, lines.length)),
        ];
        const headerRowHeight = 8 + Math.max(...headerLineCounts) * titleLineHeight;
        const hasFooterTotals = section.columns.some(
          (table) => table.includeFooterTotalRow === true,
        );
        const sectionWidth =
          leadingWidth + section.columns.length * tableWidth;
        const sectionHeight =
          agencyHeaderHeight +
          singleTitleRowMinHeight +
          headerRowHeight +
          rowHeight * rowCount +
          (hasFooterTotals ? rowHeight : 0);

        return {
          ...section,
          sectionWidth,
          sectionHeight,
          rowCount,
          headerRowHeight,
          headerLineSets,
          hasFooterTotals,
          orderedRows,
          valueMaps,
          columnTotals,
        };
      });
      const agencyTablesHeight =
        sectionLayouts.reduce((sum, section) => sum + section.sectionHeight, 0) +
        Math.max(0, sectionLayouts.length - 1) * sectionGap;
      const agencyCanvasHeight =
        tableTopY +
        agencyTablesHeight +
        (bottomFootnote
          ? bottomFootnoteTopPaddingWithoutSiblingFooters +
            bottomFootnotePadding +
            bottomFootnoteLineCount * footnoteLineHeight
          : 0) +
        pageBottomPadding;

      canvas.height = agencyCanvasHeight * scale;
      canvas.style.height = `${agencyCanvasHeight}px`;
      ctx.scale(scale, scale);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, agencyCanvasHeight);

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
        ctx.drawImage(logo, logoX, pagePadding, logoWidth, drawHeight);
      }

      ctx.font = reportFont(26, 600);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(titleText, titleX, logoBottom + 24);

      ctx.font = reportFont(16, 400);
      ctx.fillStyle = "#475569";
      ctx.fillText(reportRangeLabel, rangeX, logoBottom + 48);

      let sectionY = tableTopY;
      sectionLayouts.forEach((section) => {
        const x = Math.max(pagePadding, (width - section.sectionWidth) / 2);
        const agencyTop = sectionY;
        const titleTop = agencyTop + agencyHeaderHeight;
        const headerTop = titleTop + singleTitleRowMinHeight;
        const nameColumnX = x + indexColumnWidth;

        ctx.fillStyle = primaryColor;
        ctx.fillRect(x, agencyTop, section.sectionWidth, agencyHeaderHeight);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(x, agencyTop, section.sectionWidth, agencyHeaderHeight);
        ctx.fillStyle = "#ffffff";
        ctx.font = columnTitleFont;
        const agencyWidth = ctx.measureText(section.label).width;
        ctx.fillText(
          section.label,
          x + (section.sectionWidth - agencyWidth) / 2,
          agencyTop + titleTextBaselineInset,
        );

        const drawHeaderCell = (
          cellX: number,
          cellWidth: number,
          lines: Array<{ text: string; italic?: boolean }> | string[],
        ) => {
          const normalizedLines = lines.map((line) =>
            typeof line === "string" ? { text: line, italic: false } : line,
          );
          const contentHeight = normalizedLines.length * titleLineHeight;
          let headerY = headerTop + (section.headerRowHeight - contentHeight) / 2 + 10;
          ctx.fillStyle = secondaryColor;
          ctx.fillRect(cellX, headerTop, cellWidth, section.headerRowHeight);
          ctx.strokeStyle = "#000000";
          ctx.strokeRect(cellX, headerTop, cellWidth, section.headerRowHeight);
          ctx.fillStyle = "#ffffff";
          normalizedLines.forEach((line) => {
            ctx.font = line.italic ? italicizeFont(columnTitleFont) : columnTitleFont;
            const lineWidth = ctx.measureText(line.text).width;
            ctx.fillText(line.text, cellX + (cellWidth - lineWidth) / 2, headerY);
            headerY += titleLineHeight;
          });
        };

        if (report.includeIndexTable) {
          drawHeaderCell(x, indexColumnWidth, ["No"]);
        }
        drawHeaderCell(nameColumnX, singleTableNameColumnWidth, [firstColumnHeader]);
        section.headerLineSets.forEach((lines, columnIndex) => {
          drawHeaderCell(
            x + leadingWidth + columnIndex * tableWidth,
            tableWidth,
            lines,
          );
        });

        ctx.font = bodyFont;
        section.orderedRows.forEach((row, rowIndex) => {
          const rowTop =
            headerTop + section.headerRowHeight + rowIndex * rowHeight;
          if (report.includeIndexTable) {
            ctx.strokeStyle = "#000000";
            ctx.strokeRect(x, rowTop, indexColumnWidth, rowHeight);
            ctx.textAlign = "center";
            ctx.fillStyle = "#0f172a";
            ctx.fillText(String(rowIndex + 1), x + indexColumnWidth / 2, rowTop + 16);
          }

          ctx.strokeStyle = "#000000";
          ctx.strokeRect(nameColumnX, rowTop, singleTableNameColumnWidth, rowHeight);
          ctx.textAlign = "left";
          ctx.fillStyle = "#0f172a";
          ctx.fillText(row.name, nameColumnX + 4, rowTop + 16);

          section.columns.forEach((table, columnIndex) => {
            const cellX = x + leadingWidth + columnIndex * tableWidth;
            const value = section.valueMaps.get(table.id)?.get(row.key) ?? 0;
            if (table.highlightMin && value >= (table.minValue ?? 0)) {
              ctx.fillStyle = hitRowColor;
              ctx.fillRect(cellX, rowTop, tableWidth, rowHeight);
            }
            ctx.strokeStyle = "#000000";
            ctx.strokeRect(cellX, rowTop, tableWidth, rowHeight);
            ctx.fillStyle = "#0f172a";
            ctx.textAlign = "right";
            ctx.fillText(
              formatValue(value, formatForMetric(table.metric?.type || "countClosings")),
              cellX + tableWidth - 4,
              rowTop + 16,
            );
          });
          ctx.textAlign = "left";
        });

        if (section.hasFooterTotals) {
          const footerTop =
            headerTop + section.headerRowHeight + section.rowCount * rowHeight;
          if (report.includeIndexTable) {
            ctx.fillStyle = secondaryColor;
            ctx.fillRect(x, footerTop, indexColumnWidth, rowHeight);
            ctx.strokeStyle = "#000000";
            ctx.strokeRect(x, footerTop, indexColumnWidth, rowHeight);
          }
          ctx.fillStyle = secondaryColor;
          ctx.fillRect(nameColumnX, footerTop, singleTableNameColumnWidth, rowHeight);
          ctx.strokeStyle = "#000000";
          ctx.strokeRect(nameColumnX, footerTop, singleTableNameColumnWidth, rowHeight);
          ctx.fillStyle = "#ffffff";
          ctx.font = footerTotalFont;
          ctx.textAlign = "left";
          ctx.fillText("Total", nameColumnX + 4, footerTop + 16);
          section.columns.forEach((table, columnIndex) => {
            const cellX = x + leadingWidth + columnIndex * tableWidth;
            ctx.fillStyle = secondaryColor;
            ctx.fillRect(cellX, footerTop, tableWidth, rowHeight);
            ctx.strokeStyle = "#000000";
            ctx.strokeRect(cellX, footerTop, tableWidth, rowHeight);
            if (table.includeFooterTotalRow) {
              ctx.fillStyle = "#ffffff";
              ctx.textAlign = "right";
              ctx.fillText(
                formatValue(
                  section.columnTotals.get(table.id) ?? 0,
                  formatForMetric(table.metric?.type || "countClosings"),
                ),
                cellX + tableWidth - 4,
                footerTop + 16,
              );
            }
          });
          ctx.textAlign = "left";
        }

        sectionY += section.sectionHeight + sectionGap;
      });

      if (bottomFootnote) {
        ctx.font = reportFont(12, 400, { italic: true });
        ctx.fillStyle = "#475569";
        ctx.textAlign = "center";
        const bottomLines = wrapText(ctx, bottomFootnote, width - pagePadding * 2);
        let bottomY =
          tableTopY +
          agencyTablesHeight +
          bottomFootnoteTopPaddingWithoutSiblingFooters;
        bottomLines.forEach((line) => {
          ctx.fillText(line, width / 2, bottomY);
          bottomY += footnoteLineHeight;
        });
        ctx.textAlign = "left";
      }

      return { canvas, width, height: agencyCanvasHeight };
    }
    const singleGroupLabels = singleTableGroupLabels;
    const singleHeaderLineSets = singleTableColumns.map((table) =>
      wrapRenderedTitleLines(
        ctx,
        getSingleTableHeaderLines(table),
        Math.max(20, tableWidth - 8),
      ),
    );
    const singleFootnoteLabels = singleTableColumns.map(getSingleTableFootnoteLabel);
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
      firstColumnHeader,
    ];
    const columnWidths = [
      ...(report.includeIndexTable ? [report.indexTableWidth] : []),
      singleTableNameColumnWidth,
    ];

    ctx.font = columnTitleFont;
    const leadingHeaderLineCounts = headerLabels.map((label, index) =>
      Math.max(1, wrapText(ctx, label, Math.max(20, columnWidths[index]! - 8)).length),
    );
    const headerLineCounts = [
      ...leadingHeaderLineCounts,
      ...singleHeaderLineSets.map((lines) => Math.max(1, lines.length)),
    ];
    const singleHeaderRowHeight =
      8 + Math.max(...headerLineCounts) * titleLineHeight;

    const singleFootnoteBlocks = singleTableColumns
      .map((table, index) => {
        const text = resolveRenderedFootnote(table, reportDate);
        if (!text) return null;
        const labelPrefix = singleFootnoteLabels[index];
        const label = labelPrefix ? `${labelPrefix}: ${text}` : text;
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
    const leadingTitleWidth =
      (report.includeIndexTable ? report.indexTableWidth : 0) +
      singleTableNameColumnWidth;
    const metricColumnGapBefore = singleTableMetricColumnGaps;
    const totalMetricGapWidth = metricColumnGapBefore.reduce(
      (sum, gap) => sum + gap,
      0,
    );
    const metricAreaWidth = singleTableColumns.length * tableWidth + totalMetricGapWidth;
    const metricColumnXs: number[] = [];
    let nextMetricX = leadingTitleWidth;
    singleTableColumns.forEach((_, index) => {
      nextMetricX += metricColumnGapBefore[index] || 0;
      metricColumnXs.push(nextMetricX);
      nextMetricX += tableWidth;
    });
    const singleTitleRowSegments: Array<{
      text: string;
      x: number;
      width: number;
      lines: string[];
    }> = [];
    let currentLabelIndex = 0;

    const hasSingleTitleRow = singleGroupLabels.some((label) => label.trim() !== "");
    while (hasSingleTitleRow && currentLabelIndex < singleGroupLabels.length) {
      const label = singleGroupLabels[currentLabelIndex]!;
      let runLength = 1;
      while (
        currentLabelIndex + runLength < singleGroupLabels.length &&
        singleGroupLabels[currentLabelIndex + runLength] === label
      ) {
        runLength += 1;
      }

      const segmentX = metricColumnXs[currentLabelIndex] || leadingTitleWidth;
      const lastColumnIndex = currentLabelIndex + runLength - 1;
      const segmentEnd =
        (metricColumnXs[lastColumnIndex] || segmentX) + tableWidth;
      const segmentWidth = Math.max(0, segmentEnd - segmentX);

      singleTitleRowSegments.push({
        text: label,
        x: segmentX,
        width: segmentWidth,
        lines: wrapTextPreservingEmpty(
          ctx,
          label,
          Math.max(20, segmentWidth - 8),
        ),
      });

      currentLabelIndex += runLength;
    }

    const maxSingleTitleRowLineCount =
      singleTitleRowSegments.length > 0
        ? Math.max(
            1,
            ...singleTitleRowSegments.map((segment) =>
              Math.max(1, segment.lines.length),
            ),
          )
        : 0;
    const singleTitleRowHeight =
      singleTitleRowSegments.length > 0
        ? Math.max(
            singleTitleRowMinHeight,
            titlePadding * 2 + maxSingleTitleRowLineCount * titleLineHeight + 2,
          )
        : 0;
    const singleTableWidth =
      columnWidths.reduce((sum, value) => sum + value, 0) + metricAreaWidth;
    const singleTableHeight =
      singleTitleRowHeight +
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

    ctx.font = reportFont(26, 600);
    ctx.fillStyle = "#0f172a";
    ctx.fillText(titleText, titleX, logoBottom + 24);

    ctx.font = reportFont(16, 400);
    ctx.fillStyle = "#475569";
    ctx.fillText(reportRangeLabel, rangeX, logoBottom + 48);

    const x = Math.max(pagePadding, (width - singleTableWidth) / 2);
    const y = tableTopY;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, singleTableWidth, singleTableHeight);

    const titleRowTop = y;
    const metricColumnXsAbsolute = metricColumnXs.map((value) => x + value);
    const indexColumnWidth = report.includeIndexTable ? report.indexTableWidth : 0;
    const indexColumnX = x;
    const nameColumnX = x + indexColumnWidth;

    if (singleTitleRowHeight > 0) {
      ctx.fillStyle = primaryColor;
      ctx.fillRect(x, titleRowTop, leadingTitleWidth, singleTitleRowHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(x, titleRowTop, leadingTitleWidth, singleTitleRowHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = reportFont(12, 900);

      const drawTitleSegment = (segment: (typeof singleTitleRowSegments)[number]) => {
        const titleOffset =
          ((maxSingleTitleRowLineCount - segment.lines.length) * titleLineHeight) / 2;
        let titleY = titleRowTop + titleTextBaselineInset + titleOffset;
        ctx.fillStyle = primaryColor;
        ctx.fillRect(x + segment.x, titleRowTop, segment.width, singleTitleRowHeight);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(x + segment.x, titleRowTop, segment.width, singleTitleRowHeight);
        ctx.fillStyle = "#ffffff";
        segment.lines.forEach((line) => {
          if (line.length === 0) {
            titleY += titleLineHeight;
            return;
          }
          const lineWidth = ctx.measureText(line).width;
          const lineX = x + segment.x + (segment.width - lineWidth) / 2;
          ctx.fillText(line, lineX, titleY);
          titleY += titleLineHeight;
        });
      };

      singleTitleRowSegments.forEach((segment) => {
        drawTitleSegment(segment);
      });
    }

    const headerTop = y + singleTitleRowHeight;
    const drawHeaderCell = (
      cellX: number,
      cellWidth: number,
      lines: string[],
      options?: { italic?: boolean },
    ) => {
      const contentHeight = lines.length * titleLineHeight;
      let headerY = headerTop + (singleHeaderRowHeight - contentHeight) / 2 + 10;
      ctx.fillStyle = secondaryColor;
      ctx.fillRect(cellX, headerTop, cellWidth, singleHeaderRowHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(cellX, headerTop, cellWidth, singleHeaderRowHeight);
      ctx.fillStyle = "#ffffff";
      lines.forEach((line) => {
        ctx.font = options?.italic ? italicizeFont(columnTitleFont) : columnTitleFont;
        const lineWidth = ctx.measureText(line).width;
        const lineX = cellX + (cellWidth - lineWidth) / 2;
        ctx.fillText(line, lineX, headerY);
        headerY += titleLineHeight;
      });
    };

    if (report.includeIndexTable) {
      drawHeaderCell(indexColumnX, indexColumnWidth, wrapText(
        ctx,
        headerLabels[0]!,
        Math.max(20, indexColumnWidth - 8),
      ));
    }

    drawHeaderCell(
      nameColumnX,
      singleTableNameColumnWidth,
      wrapText(
        ctx,
        firstColumnHeader,
        Math.max(20, singleTableNameColumnWidth - 8),
      ),
    );

    singleHeaderLineSets.forEach((lines, index) => {
      const cellX = metricColumnXsAbsolute[index]!;
      const contentHeight = lines.length * titleLineHeight;
      let headerY = headerTop + (singleHeaderRowHeight - contentHeight) / 2 + 10;
      ctx.fillStyle = secondaryColor;
      ctx.fillRect(cellX, headerTop, tableWidth, singleHeaderRowHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(cellX, headerTop, tableWidth, singleHeaderRowHeight);
      ctx.fillStyle = "#ffffff";
      lines.forEach((line) => {
        ctx.font = line.italic ? italicizeFont(columnTitleFont) : columnTitleFont;
        const lineWidth = ctx.measureText(line.text).width;
        const lineX = cellX + (tableWidth - lineWidth) / 2;
        ctx.fillText(line.text, lineX, headerY);
        headerY += titleLineHeight;
      });
    });

    ctx.font = bodyFont;
    orderedRows.forEach((row, rowIndex) => {
      const rowTop = headerTop + singleHeaderRowHeight + rowIndex * rowHeight;

      if (report.includeIndexTable) {
        const indexWidth = indexColumnWidth;
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(indexColumnX, rowTop, indexWidth, rowHeight);
        ctx.textAlign = "center";
        ctx.fillStyle = "#0f172a";
        ctx.fillText(String(rowIndex + 1), indexColumnX + indexWidth / 2, rowTop + 16);
      }

      ctx.strokeStyle = "#000000";
      ctx.strokeRect(nameColumnX, rowTop, singleTableNameColumnWidth, rowHeight);
      ctx.textAlign = "left";
      ctx.fillStyle = "#0f172a";
      ctx.fillText(row.name, nameColumnX + 4, rowTop + 16);

      singleTableColumns.forEach((table, index) => {
        const cellX = metricColumnXsAbsolute[index]!;
        const value = valueMaps.get(table.id)?.get(row.key) ?? 0;
        if (
          table.highlightMin &&
          value >= (table.minValue ?? 0)
        ) {
          ctx.fillStyle = hitRowColor;
          ctx.fillRect(cellX, rowTop, tableWidth, rowHeight);
        }
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(cellX, rowTop, tableWidth, rowHeight);
        ctx.fillStyle = "#0f172a";
        ctx.textAlign = "right";
        ctx.fillText(
          formatValue(value, formatForMetric(table.metric?.type || "countClosings")),
          cellX + tableWidth - 4,
          rowTop + 16,
        );
      });

      ctx.textAlign = "left";
    });

    if (hasFooterTotals) {
      const footerTop = headerTop + singleHeaderRowHeight + rowCount * rowHeight;
      if (report.includeIndexTable) {
        ctx.fillStyle = secondaryColor;
        ctx.fillRect(indexColumnX, footerTop, indexColumnWidth, rowHeight);
        ctx.strokeStyle = "#000000";
        ctx.strokeRect(indexColumnX, footerTop, indexColumnWidth, rowHeight);
      }
      ctx.fillStyle = secondaryColor;
      ctx.fillRect(nameColumnX, footerTop, singleTableNameColumnWidth, rowHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(nameColumnX, footerTop, singleTableNameColumnWidth, rowHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = footerTotalFont;
      ctx.textAlign = "left";
      ctx.fillText("Total", nameColumnX + 4, footerTop + 16);
      singleTableColumns.forEach((table, index) => {
        const cellX = metricColumnXsAbsolute[index]!;
        ctx.fillStyle = secondaryColor;
        ctx.fillRect(cellX, footerTop, tableWidth, rowHeight);
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
      });
      ctx.textAlign = "left";
    }

    if (singleFootnoteBlocks.length > 0) {
      ctx.font = reportFont(12, 400, { italic: true });
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
      ctx.font = reportFont(12, 400, { italic: true });
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

  const standardSectionsToRender = hasStandardAgencySections
    ? standardAgencySections
    : [{ label: "", tables }];
  let currentSectionY = tableTopY;
  standardSectionsToRender.forEach((section, sectionIndex) => {
    const sectionWidth = tableBlockWidthForTables(section.tables);
    const sectionRowCapacity = rowCapacityForStandardSection(section.tables);
    const sectionBlockHeight =
      standardSectionHeights[sectionIndex] ?? tableBlockHeight;
    const sectionTop = currentSectionY;
    const tablesTop = hasStandardAgencySections
      ? sectionTop + agencyHeaderHeight
      : sectionTop;
    let currentX = Math.max(
      pagePadding,
      (width - sectionWidth) / 2,
    );
    if (hasStandardAgencySections) {
      ctx.fillStyle = primaryColor;
      ctx.fillRect(currentX, sectionTop, sectionWidth, agencyHeaderHeight);
      ctx.strokeStyle = "#000000";
      ctx.strokeRect(currentX, sectionTop, sectionWidth, agencyHeaderHeight);
      ctx.fillStyle = "#ffffff";
      ctx.font = reportFont(12, 900);
      const agencyWidth = ctx.measureText(section.label).width;
      ctx.fillText(
        section.label,
        currentX + (sectionWidth - agencyWidth) / 2,
        sectionTop + titleTextBaselineInset,
      );
    }
    section.tables.forEach((table, index) => {
      if (index > 0) {
        const prev = section.tables[index - 1];
        currentX += tableWidthFor(prev);
        currentX += prev.id === "index-only" ? 0 : tableGap;
      }
      const x = currentX;
      const y = tablesTop;
      const activeTableWidth = tableWidthFor(table);
      const collapseRows =
        table.rookieFilter === "rookies" && table.includeAllAdvisors === false;
      const rowCount = collapseRows
        ? Math.max(1, table.rows.length)
        : sectionRowCapacity;
    const titleLines = getRenderedTitleLines(table.titleLines);
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
    ctx.font = reportFont(12, 900);
    const titleBlockHeight = tableTitleBlockHeight;
    const titleOffset = ((maxTitleLines - titleLines.length) * titleLineHeight) / 2;
    let titleY = y + titleTextBaselineInset + titleOffset;
    ctx.fillStyle = primaryColor;
    ctx.fillRect(x, y, activeTableWidth, titleBlockHeight);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x, y, activeTableWidth, titleBlockHeight);
    ctx.fillStyle = "#ffffff";
    titleLines.forEach((line) => {
      ctx.font = reportFont(12, 900, { italic: line.italic });
      const lineWidth = ctx.measureText(line.text).width;
      const lineX = x + (activeTableWidth - lineWidth) / 2;
      ctx.fillText(line.text, lineX, titleY);
      titleY += titleLineHeight;
    });

    const headerTop = y + titleBlockHeight;
    ctx.fillStyle = secondaryColor;
    ctx.fillRect(x, headerTop, activeTableWidth, headerRowHeight);
    ctx.strokeStyle = "#000000";
    ctx.strokeRect(x, headerTop, activeTableWidth, headerRowHeight);

    ctx.fillStyle = "#ffffff";
    ctx.font = reportFont(12, 900);

    const indexWidth = table.indexOnly ? activeTableWidth - 16 : table.showIndex ? 32 : 0;
    const namePadding = 2;
    const nameWidth = table.indexOnly ? 0 : primaryColumnWidth(report, 100);
    const valueWidth = table.indexOnly ? 0 : tableWidth;
    const colStart = x + 8;
    const col1X = colStart + indexWidth;
    const col2X = colStart + indexWidth + nameWidth;

    if (table.showIndex) {
      ctx.textAlign = "center";
      ctx.fillText("No", colStart + indexWidth / 2, headerTop + 18);
    }
    if (!table.indexOnly) {
      ctx.textAlign = "left";
      ctx.fillText(firstColumnHeader, colStart + indexWidth + namePadding, headerTop + 18);
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

    ctx.font = reportFont(12, 700);
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
      ctx.font = reportFont(12, 400, { italic: true });
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
    currentSectionY +=
      (hasStandardAgencySections ? agencyHeaderHeight : 0) +
      sectionBlockHeight +
      (sectionIndex < standardSectionsToRender.length - 1
        ? agencySectionGap
        : 0);
  });

  if (bottomFootnote) {
    ctx.font = reportFont(12, 400, { italic: true });
    ctx.fillStyle = "#475569";
    ctx.textAlign = "center";
    const bottomLines = wrapText(ctx, bottomFootnote, width - pagePadding * 2);
    let bottomY =
      tableTopY +
      renderedTableBlockHeight +
      effectiveBottomFootnoteTopPadding;
    bottomLines.forEach((line) => {
      ctx.fillText(line, width / 2, bottomY);
      bottomY += footnoteLineHeight;
    });
    ctx.textAlign = "left";
  }

  return { canvas, width, height };
}
