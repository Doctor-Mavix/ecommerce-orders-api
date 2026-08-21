export type CellValue = string | number | boolean | Date | null;

export interface ExportColumn<TRow> {
  header: string;
  value: (row: TRow) => CellValue;
  /** Excel only; ignored by the CSV writer. */
  width?: number;
}

/**
 * Exports read an async iterable, never an array: the whole point is that a 200 000-row export
 * costs one page of memory instead of two hundred thousand rows of it.
 */
export type RowSource<TRow> = AsyncIterable<TRow>;
