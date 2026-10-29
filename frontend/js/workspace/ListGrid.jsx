import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { adjacentLists, cardBounds, findGridTarget, masonrySlots, moveListToSlot } from './listGrid.js';

const motionOptions = { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };

export function ListGrid({ lists, onSwap, children }) {
  const gridRef = useRef(null);
  const slots = useRef(new Map());
  const gesture = useRef(null);
  const stopGesture = useRef(null);
  const lastPositions = useRef(new Map());
  const releasePositions = useRef(null);
  const layoutWidth = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [focusedId, setFocusedId] = useState(null);
  const [slide, setSlide] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const closeButton = useRef(null);
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const [shortFocusedList, setShortFocusedList] = useState(false);
  const slideTimer = useRef(null);
  const focusReturn = useRef(null);
  const focusScrollTop = useRef(0);
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const orderKey = lists.map((list) => list.id).join(',');
  const focusedIndex = lists.findIndex((list) => list.id === focusedId);
  const focusedList = lists[focusedIndex];
  const { previous: previousList, next: nextList } = adjacentLists(lists, focusedId);
  const leavingList = slide && !slide.settled && lists.find((list) => list.id === slide.fromId);

  function cardFor(id) {
    return slots.current.get(id)?.querySelector(':scope > .task-list-card');
  }

  function capturePositions() {
    const positions = new Map();
    for (const id of slots.current.keys()) {
      const bounds = cardBounds(cardFor(id), window.scrollX, window.scrollY);
      if (bounds) positions.set(id, bounds);
    }
    return positions;
  }

  function stopAnimation(card) {
    card?.getAnimations().forEach((animation) => animation.cancel());
  }

  function fitMasonrySlots(orderedLists = lists) {
    const grid = gridRef.current;
    if (!grid) return;
    // Old explicit column positions can create implicit tracks after narrowing
    // the viewport. Remove them before reading the new CSS column count.
    for (const slot of slots.current.values()) {
      slot.style.removeProperty('grid-column-start');
      slot.style.removeProperty('grid-row-start');
    }
    const styles = window.getComputedStyle(grid);
    const rowHeight = Number.parseFloat(styles.gridAutoRows) || 8;
    const rowGap = Number.parseFloat(styles.rowGap) || 18;
    const cardGap = Number.parseFloat(styles.getPropertyValue('--list-card-gap')) || 18;
    const columns = styles.gridTemplateColumns.trim().split(/\s+/).length;
    layoutWidth.current = grid.clientWidth;
    // Transforms belong to the animation, not to the layout's actual card height.
    const positions = masonrySlots(orderedLists.map((item) => cardFor(item.id)?.offsetHeight || 0), columns, rowHeight, rowGap, cardGap);
    for (const [index, item] of orderedLists.entries()) {
      const slot = slots.current.get(item.id);
      if (!slot) continue;
      const { column, row, span } = positions[index];
      const columnValue = String(column);
      const rowValue = String(row);
      const spanValue = `span ${span}`;
      if (slot.style.gridColumnStart !== columnValue) slot.style.gridColumnStart = columnValue;
      if (slot.style.gridRowStart !== rowValue) slot.style.gridRowStart = rowValue;
      if (slot.style.gridRowEnd !== spanValue) slot.style.gridRowEnd = spanValue;
    }
  }

  function animateLayout(previous, draggedId = null) {
    const next = new Map();
    for (const id of slots.current.keys()) {
      if (id === draggedId) continue;
      const card = cardFor(id);
      if (!card) continue;
      stopAnimation(card);
      card.style.removeProperty('transform');
      const slot = slots.current.get(id);
      delete slot.dataset.previewMoving;
      const bounds = cardBounds(card, window.scrollX, window.scrollY);
      const before = previous.get(id);
      next.set(id, bounds);
      if (!before || !card.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) continue;
      const dx = before.left - bounds.left;
      const dy = before.top - bounds.top;
      // Only move cards: scaling live text and controls causes repaint artifacts in WebKit.
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        const frames = [{ transform: `translate(${dx}px, ${dy}px)` }];
        if (draggedId !== null) {
          slot.dataset.previewMoving = 'true';
        }
        frames.push({ transform: 'translate(0, 0)' });
        const animation = card.animate(frames, { ...motionOptions, duration: draggedId === null ? 300 : 380 });
        animation.onfinish = () => {
          delete slot.dataset.previewMoving;
          // Do not retain an identity transform/containing block after the animation.
          animation.cancel();
        };
      }
    }
    return next;
  }

  useLayoutEffect(() => {
    if (gesture.current?.active || focusedId !== null) return;
    fitMasonrySlots();
    lastPositions.current = animateLayout(releasePositions.current || lastPositions.current);
    releasePositions.current = null;
  }, [orderKey, dragId, focusedId]);

  useEffect(() => {
    if (focusedId !== null && !lists.some((list) => list.id === focusedId)) setFocusedId(null);
  }, [orderKey, focusedId]);

  useLayoutEffect(() => {
    if (focusedId === null) {
      setShortFocusedList(false);
      return undefined;
    }
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const measure = () => setShortFocusedList(dialog.scrollHeight <= window.innerHeight * 0.88);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(dialog);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  useEffect(() => {
    if (!shortFocusedList) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [shortFocusedList]);

  useEffect(() => () => window.clearTimeout(slideTimer.current), []);

  useEffect(() => {
    if (focusedId === null) return undefined;
    const shell = gridRef.current?.closest('.workspace-shell');
    const previouslyInert = shell?.inert;
    if (shell) shell.inert = true;
    (closeButton.current || dialogRef.current)?.focus({ preventScroll: true });

    function handleKeyDown(event) {
      if (event.defaultPrevented || event.target.closest?.('.list-delete-dialog')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setFocusedId(null);
        return;
      }
      const isTextEntry = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if (!isTextEntry && (event.metaKey || event.ctrlKey) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && lists.length > 1) {
        event.preventDefault();
        focusAdjacentList(event.key === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = overlayRef.current;
      const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || [])]
        .filter((item) => item.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        (closeButton.current || dialogRef.current)?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (shell) shell.inert = previouslyInert;
      // Keep the return target while switching between neighboring lists.
      if (focusedIdRef.current === null) {
        window.scrollTo({ top: focusScrollTop.current, behavior: 'instant' });
        if (focusReturn.current?.isConnected) focusReturn.current.focus({ preventScroll: true });
        focusReturn.current = null;
      }
    };
  }, [focusedId]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (focusedId !== null) return;
      if (gesture.current?.active) {
        if (Math.abs(gridRef.current.clientWidth - layoutWidth.current) > 1) stopGesture.current?.(false);
        return;
      }
      fitMasonrySlots();
      // Cell geometry stays independent of card animations and page scrolling.
      lastPositions.current = new Map([...slots.current].map(([id, slot]) => {
        const bounds = slot.getBoundingClientRect();
        const card = cardFor(id);
        return [id, { left: bounds.left + window.scrollX, top: bounds.top + window.scrollY,
          width: card?.offsetWidth || bounds.width, height: card?.offsetHeight || bounds.height }];
      }));
    });
    for (const id of slots.current.keys()) {
      const card = cardFor(id);
      if (card) observer.observe(card);
    }
    if (gridRef.current) observer.observe(gridRef.current);
    return () => observer.disconnect();
  }, [orderKey, focusedId]);

  useEffect(() => () => stopGesture.current?.(false, false), []);

  function startDrag(event, list) {
    if (event.button !== 0 || !event.isPrimary || list.is_pinned || savingRef.current || gesture.current || focusedId !== null) return;
    const grid = gridRef.current;
    const card = cardFor(list.id);
    if (!grid || !card) return;
    const handle = event.currentTarget;
    const initialBounds = card.getBoundingClientRect();
    const current = {
      id: list.id, pointerId: event.pointerId, active: false, target: list.id,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - initialBounds.left, offsetY: event.clientY - initialBounds.top,
      cells: [], frame: null, hitBounds: null, minHeight: grid.style.minHeight,
    };
    gesture.current = current;
    handle.setPointerCapture(event.pointerId);

    function updatePosition() {
      if (!current.active) return;
      const bounds = grid.getBoundingClientRect();
      const sourceSlot = slots.current.get(list.id);
      if (!sourceSlot) { void finish(false); return; }
      const cell = sourceSlot.getBoundingClientRect();
      const left = Math.max(bounds.left, Math.min(current.x - current.offsetX, bounds.right - initialBounds.width));
      const top = Math.max(bounds.top, Math.min(current.y - current.offsetY, Math.max(bounds.top, bounds.bottom - initialBounds.height)));
      card.style.transform = `translate(${left - cell.left}px, ${top - cell.top}px)`;

      // Never let the tall source placeholder capture a lower target. Hit-test
      // only the original cells, independently of the live preview geometry.
      const target = findGridTarget(current.cells, current.hitBounds, current.x + window.scrollX, current.y + window.scrollY);
      if (target === current.target) return;
      const reordered = target === null ? lists : moveListToSlot(lists, list.id, target);
      const previous = capturePositions();
      // Preview the actual final masonry layout, not scaled cards in old cells.
      fitMasonrySlots(reordered);
      animateLayout(previous, list.id);
      const destination = sourceSlot.getBoundingClientRect();
      card.style.transform = `translate(${left - destination.left}px, ${top - destination.top}px)`;
      current.target = target;
    }

    function tick() {
      if (!current.active) return;
      const gridBounds = grid.getBoundingClientRect();
      // Scroll only while the pointer remains over the grid horizontally.
      if (current.x >= gridBounds.left && current.x <= gridBounds.right) {
        const edge = 70;
        const speed = current.y < edge ? -Math.min(14, (edge - current.y) / 4)
          : current.y > window.innerHeight - edge ? Math.min(14, (current.y - window.innerHeight + edge) / 4) : 0;
        if (speed) window.scrollBy(0, speed);
      }
      updatePosition();
      if (gesture.current === current) current.frame = window.requestAnimationFrame(tick);
    }

    function move(pointer) {
      if (pointer.pointerId !== current.pointerId) return;
      current.x = pointer.clientX;
      current.y = pointer.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        const bounds = grid.getBoundingClientRect();
        current.hitBounds = { left: bounds.left + window.scrollX, right: bounds.right + window.scrollX,
          top: bounds.top + window.scrollY, bottom: bounds.bottom + window.scrollY };
        // Do not let a shorter preview collapse the page and move the pointer's target.
        grid.style.minHeight = `${bounds.height}px`;
        current.cells = lists.map((item) => {
          const rect = slots.current.get(item.id).getBoundingClientRect();
          return { id: item.id, is_pinned: item.is_pinned, left: rect.left + window.scrollX,
            right: rect.right + window.scrollX, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
        });
        lastPositions.current = capturePositions();
        for (const id of slots.current.keys()) stopAnimation(cardFor(id));
        current.active = true;
        setError('');
        setDragId(list.id);
        document.body.classList.add('is-list-dragging');
        setAnnouncement(`Перемещение списка «${list.name}». Escape — отменить.`);
        current.frame = window.requestAnimationFrame(tick);
      }
      if (current.active) pointer.preventDefault();
    }

    async function finish(commit, notify = true) {
      if (gesture.current !== current) return;
      if (current.frame !== null) window.cancelAnimationFrame(current.frame);
      if (current.active && notify) releasePositions.current = capturePositions();
      gesture.current = null;
      stopGesture.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      if (handle.hasPointerCapture(current.pointerId)) handle.releasePointerCapture(current.pointerId);
      document.body.classList.remove('is-list-dragging');
      grid.style.minHeight = current.minHeight;
      for (const id of slots.current.keys()) {
        stopAnimation(cardFor(id));
        cardFor(id)?.style.removeProperty('transform');
        const slot = slots.current.get(id);
        if (slot) delete slot.dataset.previewMoving;
      }
      if (!notify || !current.active) return;
      setDragId(null);
      if (!commit || current.target === null || current.target === current.id) {
        setAnnouncement('Перемещение отменено.');
        return;
      }
      savingRef.current = true;
      setSaving(true);
      try {
        await onSwap(current.id, current.target);
        setAnnouncement('Порядок списков сохранён.');
      } catch (err) {
        setError(err.message);
        setAnnouncement('Не удалось сохранить порядок. Изменения отменены.');
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }

    function up(pointer) {
      if (pointer.pointerId !== current.pointerId) return;
      current.x = pointer.clientX;
      current.y = pointer.clientY;
      updatePosition();
      void finish(true);
    }
    function cancel() { void finish(false); }
    function keydown(key) {
      if (key.key === 'Escape') { key.preventDefault(); void finish(false); }
    }
    stopGesture.current = finish;
    handle.addEventListener('lostpointercapture', cancel);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', keydown);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
  }

  function focusAdjacentList(direction) {
    if (lists.length < 2) return;
    const adjacent = adjacentLists(lists, focusedId);
    const nextId = (direction > 0 ? adjacent.next : adjacent.previous)?.id;
    if (nextId === undefined) return;
    window.clearTimeout(slideTimer.current);
    setSlide({ fromId: focusedId, direction });
    setFocusedId(nextId);
    window.scrollTo({ top: focusScrollTop.current, behavior: 'instant' });
    slideTimer.current = window.setTimeout(() => setSlide((current) => current && { ...current, settled: true }), 340);
  }

  function openList(id, target) {
    if (savingRef.current || gesture.current?.active) return;
    setSlide(null);
    focusReturn.current = target;
    focusScrollTop.current = window.scrollY;
    setFocusedId(id);
  }

  return <>
    <p className="list-grid-announcement" role="status" aria-live="polite">{announcement}</p>
    {error && <p className="task-list-card__error" role="alert">{error}</p>}
    <div ref={gridRef} className={`workspace-lists__items list-grid${dragId !== null ? ' is-dragging' : ''}`} aria-busy={saving}>
      {lists.map((list) => <div key={list.id} ref={(node) => { if (node) slots.current.set(list.id, node); else slots.current.delete(list.id); }} className={`list-grid__slot${list.id === dragId ? ' is-drag-source' : ''}`} tabIndex={-1} onClick={(event) => {
        if (focusedId !== null || event.target.closest('.task-list-card__meta-tags, .task-list-card__task-title, [role="dialog"], [role="alertdialog"], button, input, textarea, select, label, details, summary, a, [draggable="true"]')) return;
        openList(list.id, event.currentTarget);
      }}>
        {children(list, {
          onPointerDown: (event) => startDrag(event, list),
          disabled: saving || focusedId !== null,
          locked: saving || dragId !== null,
          onOpen: (event) => openList(list.id, event.currentTarget),
        })}
      </div>)}
    </div>
    {focusedList && createPortal(<div ref={overlayRef} className={`workspace-shell list-focus-overlay${shortFocusedList ? ' is-short-list' : ''}`} style={shortFocusedList ? undefined : { top: `${focusScrollTop.current}px` }} data-theme={gridRef.current?.closest('.workspace-shell')?.dataset.theme || 'light'} role="dialog" aria-modal="true" aria-label={`Список «${focusedList.name}»`}>
      <button className="list-focus-overlay__backdrop" type="button" aria-label="Закрыть подробный просмотр списка" onClick={() => setFocusedId(null)} />
      {previousList && <div key={`previous-${previousList.id}`} className="list-focus-overlay__peek is-previous" aria-hidden="true" inert>{children(previousList)}</div>}
      {nextList && <div key={`next-${nextList.id}`} className="list-focus-overlay__peek is-next" aria-hidden="true" inert>{children(nextList)}</div>}
      {leavingList && leavingList.id !== focusedId && <div className={`list-focus-overlay__dialog is-leaving-${slide.direction > 0 ? 'next' : 'previous'}`} aria-hidden="true" inert>{children(leavingList)}</div>}
      <div ref={dialogRef} key={focusedId} className={`list-focus-overlay__dialog ${slide ? slide.settled ? 'is-settled' : `is-entering-${slide.direction > 0 ? 'next' : 'previous'}` : 'is-opening'}`} tabIndex={-1}>
        {children(focusedList)}
        <button ref={closeButton} className="list-focus-overlay__close" type="button" aria-label="Закрыть список" onClick={() => setFocusedId(null)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
      </div>
      {lists.length > 1 && <nav className="list-focus-overlay__navigation" aria-label="Переключение между списками">
        <button type="button" aria-label={`Предыдущий список: ${previousList.name}`} title="Предыдущий список (⌘/Ctrl + ←)" onClick={() => focusAdjacentList(-1)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
        <button type="button" aria-label={`Следующий список: ${nextList.name}`} title="Следующий список (⌘/Ctrl + →)" onClick={() => focusAdjacentList(1)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
      </nav>}
    </div>, document.body)}
  </>;
}
