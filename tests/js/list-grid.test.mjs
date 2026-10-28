import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../frontend/js/workspace/listGrid.js', import.meta.url), 'utf8');
const { adjacentLists, findGridTarget, moveListToSlot, masonrySlots } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const lists = [
  { id: 1, board_id: 10, is_pinned: true },
  { id: 2, board_id: 10, is_pinned: false },
  { id: 3, board_id: 10, is_pinned: false },
  { id: 4, board_id: 10, is_pinned: false },
];
const bounds = { left: 0, top: 0, right: 620, bottom: 520 };
const cells = [
  { ...lists[0], left: 0, top: 0, right: 300, bottom: 250 },
  { ...lists[1], left: 320, top: 0, right: 620, bottom: 250 },
  { ...lists[2], left: 0, top: 270, right: 300, bottom: 520 },
  { ...lists[3], left: 320, top: 270, right: 620, bottom: 520 },
];

test('focused list has only its actual neighbors, wrapping at the ends', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({ id: index + 1 }));
  assert.deepEqual([adjacentLists(items, 4).previous.id, adjacentLists(items, 4).next.id], [3, 5]);
  assert.deepEqual([adjacentLists(items, 1).previous.id, adjacentLists(items, 1).next.id], [7, 2]);
  assert.deepEqual([adjacentLists(items, 7).previous.id, adjacentLists(items, 7).next.id], [6, 1]);
  assert.deepEqual(adjacentLists(items, 99), { previous: null, next: null });
  assert.deepEqual(adjacentLists([{ id: 1 }], 1), { previous: null, next: null });
});

test('moving to a later slot shifts every intervening list one place left', () => {
  const result = moveListToSlot(lists, 2, 4);
  assert.deepEqual(result.map((list) => list.id), [1, 3, 4, 2]);
  assert.deepEqual(lists.map((list) => list.id), [1, 2, 3, 4]);
  assert.deepEqual(moveListToSlot(result, 2, 3).map((list) => list.id), [1, 2, 3, 4]);
});

test('moving to an earlier slot shifts every intervening list one place right', () => {
  assert.deepEqual(moveListToSlot(lists, 4, 2).map((list) => list.id), [1, 4, 2, 3]);
});

test('pinned, missing, same-slot and cross-board drops cannot change order', () => {
  for (const [from, to] of [[1, 4], [4, 1], [2, 99], [99, 2], [2, 2]]) {
    assert.equal(moveListToSlot(lists, from, to), lists);
  }
  const mixed = [...lists, { id: 5, board_id: 20 }];
  assert.equal(moveListToSlot(mixed, 2, 5), mixed);
});

test('targets follow grid columns and rows, not the top/bottom half of a card', () => {
  assert.equal(findGridTarget(cells, bounds, 400, 10), 2);
  assert.equal(findGridTarget(cells, bounds, 400, 240), 2);
  assert.equal(findGridTarget(cells, bounds, 10, 280), 3);
  assert.equal(findGridTarget(cells, bounds, 600, 500), 4);
});

test('gaps resolve to the nearest cell, and pinned cells/outside grid are rejected', () => {
  assert.equal(findGridTarget(cells, bounds, 315, 300), 4);
  assert.equal(findGridTarget(cells, bounds, 400, 255), 2);
  assert.equal(findGridTarget(cells, bounds, 400, 265), 4);
  assert.equal(findGridTarget(cells, bounds, 100, 100), null);
  for (const [x, y] of [[-1, 200], [621, 200], [200, -1], [200, 521]]) {
    assert.equal(findGridTarget(cells, bounds, x, y), null);
  }
  assert.equal(findGridTarget([], bounds, 100, 100), null);
});

test('moving across a filtered view leaves pinned lists untouched', () => {
  const fullBoard = moveListToSlot(lists, 2, 4);
  assert.equal(fullBoard[0], lists[0]);
  assert.deepEqual(fullBoard.map((item) => item.id), [1, 3, 4, 2]);
});

test('masonry keeps logical columns and a consistent gap between uneven card heights', () => {
  const heights = [450, 120, 130, 140, 120, 200];
  const slots = masonrySlots(heights, 3, 1, 1, 24);
  assert.deepEqual(slots.slice(0, 3).map(({ column, row }) => [column, row]), [[1, 1], [2, 1], [3, 1]]);
  assert.deepEqual(slots.slice(3).map(({ column }) => column), [1, 2, 3]);
  for (let index = 3; index < slots.length; index++) {
    assert.equal(slots[index].row, slots[index - 3].row + slots[index - 3].span);
    const actualGap = (slots[index].row - slots[index - 3].row) * 2 - heights[index - 3];
    assert(Math.abs(actualGap - 24) <= 1);
  }
  assert(slots[4].row < slots[3].row);
  assert.deepEqual(masonrySlots([80, 100], 1, 1, 1, 24).map(({ column }) => column), [1, 1]);
});

test('first-to-fifth insertion keeps the fifth column even when tall cards change the column heights', () => {
  for (const heights of [[450, 120, 600, 140, 120, 200], [80, 900, 80, 120, 500, 70]]) {
    const original = heights.map((height, index) => ({ id: index + 1, board_id: 10, height }));
    const reordered = moveListToSlot(original, 1, 5);
    assert.deepEqual(reordered.map((list) => list.id), [2, 3, 4, 5, 1, 6]);
    for (const columns of [1, 2, 3, 4]) {
      const positions = masonrySlots(reordered.map((list) => list.height), columns, 1, 1, 24);
      assert.equal(positions[4].column, 4 % columns + 1);
      assert.equal(positions[4].row, positions[4 - columns].row + positions[4 - columns].span);
    }
  }
});

test('a tall source passing through slot two can still target slot five', () => {
  const heights = [650, 100, 120, 80, 100, 110];
  const positions = masonrySlots(heights, 3, 8, 18);
  const cells = positions.map((slot, index) => ({
    id: index + 1, left: (slot.column - 1) * 320, right: (slot.column - 1) * 320 + 300,
    top: (slot.row - 1) * 26, bottom: (slot.row - 1) * 26 + heights[index],
  }));
  const bounds = { left: 0, top: 0, right: 940, bottom: Math.max(...cells.map((cell) => cell.bottom)) };
  const x = 470;
  assert.equal(findGridTarget(cells, bounds, x, 40), 2);
  const fifthY = cells[4].top + 30;
  assert(fifthY < heights[0]); // The source preview can cover both slot two and slot five.
  assert.equal(findGridTarget(cells, bounds, x, fifthY), 5);
  const original = heights.map((height, index) => ({ id: index + 1, board_id: 10, height }));
  const inserted = moveListToSlot(original, 1, 5);
  assert.deepEqual(inserted.map((item) => item.id), [2, 3, 4, 5, 1, 6]);
});

test('responsive masonry supports 1–4 columns, long boards and reflow in both directions', () => {
  const items = Array.from({ length: 1200 }, (_, index) => ({ id: index + 1, board_id: 10, height: 80 + (index * 37 % 600) }));
  const moved = moveListToSlot(items, 1, 205);
  assert.equal(moved[204].id, 1);
  for (const columns of [4, 3, 2, 1, 2, 4]) {
    for (const gap of [18, 24]) {
      const positions = masonrySlots(moved.map((item) => item.height), columns, 1, 1, gap);
      assert.equal(positions.length, items.length);
      for (const [index, position] of positions.entries()) {
        assert.equal(position.column, index % columns + 1);
        assert.equal(position.row, index < columns ? 1 : positions[index - columns].row + positions[index - columns].span);
        const columnIndex = index - columns;
        if (columnIndex >= 0) {
          const actualGap = (position.row - positions[columnIndex].row) * 2 - moved[columnIndex].height;
          assert(actualGap >= gap - 1 && actualGap <= gap + 1);
        }
      }
      assert(positions.at(-1).row > 1000);
    }
  }
});
