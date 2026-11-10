/** Pure geometry of the drag-to-reorder list (rows of any height, measured at drag start). */

export interface RowBox {
  top: number;
  height: number;
}

/** Index the dragged row would drop at, from its vertical offset `dy` since the drag started. */
export function dropIndex(rows: readonly RowBox[], from: number, dy: number): number {
  const dragged = rows[from];
  if (!dragged) return from;
  const centre = dragged.top + dragged.height / 2 + dy;
  let target = from;
  for (let i = from + 1; i < rows.length; i += 1) {
    const r = rows[i] as RowBox;
    if (centre > r.top + r.height / 2) target = i;
  }
  for (let i = from - 1; i >= 0; i -= 1) {
    const r = rows[i] as RowBox;
    if (centre < r.top + r.height / 2) target = i;
  }
  return target;
}

/** Offset of row `i` while the row at `from` hovers over slot `target`: neighbours make room. */
export function rowShift(i: number, from: number, target: number, draggedHeight: number): number {
  if (i === from) return 0;
  if (from < target && i > from && i <= target) return -draggedHeight;
  if (target < from && i >= target && i < from) return draggedHeight;
  return 0;
}

/** Offset that places the dragged row exactly in slot `target`. */
export function slotOffset(rows: readonly RowBox[], from: number, target: number): number {
  const a = rows[from];
  const b = rows[target];
  if (!a || !b || from === target) return 0;
  return target > from ? b.top + b.height - (a.top + a.height) : b.top - a.top;
}
