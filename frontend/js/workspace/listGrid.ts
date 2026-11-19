type CardBase = { id: number | string; board_id: number | string; is_pinned?: boolean; sort_order?: number };
type WorkspaceCard = CardBase & { cardType: 'list' | 'note'; cardKey: string };
type Point = { x: number; y: number };
type Cell = { id?: number | string; key?: number | string; is_pinned?: boolean; left: number; top: number; right: number; bottom: number };

// Insert into the target slot: intervening cards shift one position.
export function moveListToSlot<T extends CardBase>(lists: T[], sourceId: T['id'], targetId: T['id']): T[] {
  const source = lists.findIndex((list) => list.id === sourceId);
  const target = lists.findIndex((list) => list.id === targetId);
  if (source < 0 || target < 0 || source === target || lists[source].is_pinned
      || lists[target].is_pinned || lists[source].board_id !== lists[target].board_id) return lists;
  const result = [...lists];
  result.splice(target, 0, result.splice(source, 1)[0]);
  return result;
}

export function workspaceCards<L extends CardBase, N extends CardBase>(lists: L[], notes: N[]): Array<(L | N) & WorkspaceCard> {
  return [
    ...lists.map((item) => ({ ...item, cardType: 'list' as const, cardKey: `list:${item.id}` })),
    ...notes.map((item) => ({ ...item, cardType: 'note' as const, cardKey: `note:${item.id}` })),
  ].sort((left, right) => Number(right.is_pinned) - Number(left.is_pinned)
    || Number(left.sort_order) - Number(right.sort_order) || left.cardKey.localeCompare(right.cardKey));
}

export function moveWorkspaceCardToSlot<T extends WorkspaceCard>(cards: T[], sourceKey: string, targetKey: string): T[] {
  const source = cards.findIndex((item) => item.cardKey === sourceKey);
  const target = cards.findIndex((item) => item.cardKey === targetKey);
  if (source < 0 || target < 0 || source === target || cards[source].is_pinned
      || cards[target].is_pinned || cards[source].board_id !== cards[target].board_id) return cards;
  const result = [...cards];
  const [item] = result.splice(source, 1);
  const targetAfterRemoval = result.findIndex((candidate) => candidate.cardKey === targetKey);
  result.splice(targetAfterRemoval + (source > target ? 0 : 1), 0, item);
  return result;
}

export function adjacentLists<T extends { id: number | string }>(lists: T[], focusedId: T['id']): { previous: T | null; next: T | null } {
  const index = lists.findIndex((list) => list.id === focusedId);
  if (index < 0 || lists.length < 2) return { previous: null, next: null };
  return {
    previous: lists[(index - 1 + lists.length) % lists.length],
    next: lists[(index + 1) % lists.length],
  };
}

export function adjacentWorkspaceCards<T extends WorkspaceCard>(cards: T[], focusedKey: string): { previous: T | null; next: T | null } {
  const index = cards.findIndex((card) => card.cardKey === focusedKey);
  if (index < 0 || cards.length < 2) return { previous: null, next: null };
  return {
    previous: cards[(index - 1 + cards.length) % cards.length],
    next: cards[(index + 1) % cards.length],
  };
}

// Upwards advances, downwards goes back; horizontal gestures and scrolling stay native.
export function verticalSwipe(start: Point | null, end: Point | null, scrollDistance = 0, threshold = 96): number {
  if (!start || !end || Math.abs(scrollDistance) > 12) return 0;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dy) < threshold || Math.abs(dy) < Math.abs(dx) * 1.4) return 0;
  return dy < 0 ? 1 : -1;
}

// Group once per workspace response instead of scanning all tasks for every card render.
export function groupTasksByList<T extends { list_id: number | string }>(tasks: T[]): Map<T['list_id'], T[]> {
  const grouped = new Map<T['list_id'], T[]>();
  for (const task of tasks) {
    const listId = task.list_id;
    if (!grouped.has(listId)) grouped.set(listId, []);
    grouped.get(listId)!.push(task);
  }
  return grouped;
}

// Visual position may be animated, but layout dimensions must never include its scale.
export function cardBounds(card: Pick<HTMLElement, 'getBoundingClientRect' | 'offsetWidth' | 'offsetHeight'> | null, scrollX = 0, scrollY = 0) {
  if (!card) return null;
  const bounds = card.getBoundingClientRect();
  return { left: bounds.left + scrollX, top: bounds.top + scrollY,
    width: card.offsetWidth, height: card.offsetHeight };
}

// Use stable cell rectangles, not the moving/animated cards, including the gaps.
export function findGridTarget(cells: Cell[], bounds: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, x: number, y: number): number | string | null {
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
  let nearest: Cell | null = null;
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
  return nearest && !nearest.is_pinned ? (nearest.key ?? nearest.id ?? null) : null;
}

// Keep the visual gap nearly constant by using a fine grid track step.
// Heights affect vertical packing; insertion order determines the column.
export function masonrySlots(heights: number[], columns: number, rowHeight: number, trackGap: number, cardGap = 18) {
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
