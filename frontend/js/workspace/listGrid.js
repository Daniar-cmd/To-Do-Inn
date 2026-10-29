// Insert into the target slot: intervening cards shift one position.
export function moveListToSlot(lists, sourceId, targetId) {
  const source = lists.findIndex((list) => list.id === sourceId);
  const target = lists.findIndex((list) => list.id === targetId);
  if (source < 0 || target < 0 || source === target || lists[source].is_pinned
      || lists[target].is_pinned || lists[source].board_id !== lists[target].board_id) return lists;
  const result = [...lists];
  result.splice(target, 0, result.splice(source, 1)[0]);
  return result;
}

export function adjacentLists(lists, focusedId) {
  const index = lists.findIndex((list) => list.id === focusedId);
  if (index < 0 || lists.length < 2) return { previous: null, next: null };
  return {
    previous: lists[(index - 1 + lists.length) % lists.length],
    next: lists[(index + 1) % lists.length],
  };
}

// Group once per workspace response instead of scanning all tasks for every card render.
export function groupTasksByList(tasks) {
  const grouped = new Map();
  for (const task of tasks) {
    const listId = task.list_id;
    if (!grouped.has(listId)) grouped.set(listId, []);
    grouped.get(listId).push(task);
  }
  return grouped;
}

// Visual position may be animated, but layout dimensions must never include its scale.
export function cardBounds(card, scrollX = 0, scrollY = 0) {
  if (!card) return null;
  const bounds = card.getBoundingClientRect();
  return { left: bounds.left + scrollX, top: bounds.top + scrollY,
    width: card.offsetWidth, height: card.offsetHeight };
}

// Use stable cell rectangles, not the moving/animated cards, including the gaps.
export function findGridTarget(cells, bounds, x, y) {
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  let nearest = null;
  let distance = Infinity;
  for (const cell of cells) {
    const dx = Math.max(cell.left - x, 0, x - cell.right);
    const dy = Math.max(cell.top - y, 0, y - cell.bottom);
    const nextDistance = dx * dx + dy * dy;
    if (nextDistance < distance) {
      nearest = cell;
      distance = nextDistance;
    }
  }
  return nearest && !nearest.is_pinned ? nearest.id : null;
}

// Keep the visual gap nearly constant by using a fine grid track step.
// Heights affect vertical packing; insertion order determines the column.
export function masonrySlots(heights, columns, rowHeight, trackGap, cardGap = 18) {
  const bottoms = Array(columns).fill(1);
  return heights.map((height, index) => {
    const column = index % columns;
    const rowStep = rowHeight + trackGap;
    const minSpan = Math.ceil(height / rowStep);
    const span = Math.max(1, minSpan, Math.round((height + cardGap) / rowStep));
    const slot = { column: column + 1, row: bottoms[column], span };
    bottoms[column] += span;
    return slot;
  });
}
