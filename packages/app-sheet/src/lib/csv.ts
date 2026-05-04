// RFC 4180 minimal CSV parser. Hand-rolled — pulling in `papaparse`
// would punch the bundle budget that `audit:bundle-strict` enforces,
// and the actual feature surface (CSV import in M4.2) only needs:
//
//   - Comma-separated fields.
//   - CRLF or LF line endings.
//   - Double-quoted fields with embedded commas, newlines and
//     escaped double quotes (`""`).
//   - Trailing newline (RFC says SHOULD; we accept either).
//
// Anything fancier (custom delimiters, BOM stripping, header maps)
// is intentionally out of scope. PR-M4.4 wires the engine; if that
// brings new requirements they live there.
//
// Returns a 2-D array of strings. An empty input → `[]`. A single
// blank trailing newline does NOT produce an empty trailing row.

export const parseCsv = (text: string): string[][] => {
  if (text.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text.charCodeAt(i);

    if (inQuotes) {
      if (ch === 34 /* " */) {
        // RFC 4180: a doubled quote inside a quoted field is one escaped
        // quote. Otherwise the quote closes the field.
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += text[i];
      i += 1;
      continue;
    }

    if (ch === 34 /* " */) {
      // Open a quoted field. Per RFC, quoted fields must START with the
      // quote (no whitespace). We're permissive: any quote at any point
      // in an unquoted field flips into quote mode for the rest.
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === 44 /* , */) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === 13 /* \r */) {
      // Treat CR as part of a CRLF line ending. A bare CR (Mac classic)
      // also terminates the row.
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (ch === 10 /* \n */) {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    field += text[i];
    i += 1;
  }

  // Final field/row. Don't emit a phantom empty row when the input
  // ended on a line terminator.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};
