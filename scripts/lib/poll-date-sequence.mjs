// poll-date-sequence.mjs: repair year typos in the Wikipedia polling table.
//
// The table runs newest first, so a row's fieldwork date should never be far
// older than the rows printed below it. Editors sometimes carry the previous
// year into a January row: in October 2026 six More in Common and Lord
// Ashcroft rows written "Jan 2025" sat between the February 2026 and December
// 2025 rows, so the series dated 2026 polls a year early. A row is moved
// forward one year only when that puts it back in sequence: it is more than
// SEQUENCE_DAYS older than the row above it, the first row below it that is
// not part of the same run (within RUN_DAYS of it) is more than SEQUENCE_DAYS
// newer (or, at the foot of the table, the shifted date lands within RUN_DAYS
// of the row above), and the shifted date is no later than the row above.

const DAY = 86400 * 1000;
const SEQUENCE_DAYS = 180;
const RUN_DAYS = 60;

function plusOneYear(date) {
  return new Date(Date.UTC(date.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate()));
}

// dates: Date|null per table row, in table order (newest first). Returns a new
// array with out-of-sequence years repaired; nulls are passed through.
export function repairYearTypos(dates) {
  const out = dates.slice();
  let above = null;
  for (let i = 0; i < out.length; i++) {
    const d = out[i];
    if (!d) continue;
    if (above && above.getTime() - d.getTime() > SEQUENCE_DAYS * DAY) {
      let next = null;
      for (let j = i + 1; j < out.length; j++) {
        if (out[j] && Math.abs(out[j].getTime() - d.getTime()) > RUN_DAYS * DAY) { next = out[j]; break; }
      }
      const shifted = plusOneYear(d);
      // At the foot of the table there is no row below to check against, so
      // the shifted date must instead land close behind the row above.
      const inSequence = next
        ? next.getTime() - d.getTime() > SEQUENCE_DAYS * DAY
        : above.getTime() - shifted.getTime() <= RUN_DAYS * DAY;
      if (inSequence && shifted.getTime() <= above.getTime() + 7 * DAY) {
        out[i] = shifted;
      }
    }
    above = out[i];
  }
  return out;
}
