/* ============================================================
 * Drag & drop for mouse and touch on Pointer Events, shared by the
 * block drag (frontmatter-blocks.js), the manual TYP-List order
 * (typ-pane.js) and the global property order
 * (frontmatter-order-editor.js). HTML5 draggable doesn't work on
 * touch, and the mouse-only handlers before didn't either.
 *
 * How a drag starts depends on the pointer:
 *
 *  - Mouse: left button, after a few pixels of movement - as before.
 *  - Touch (and pen): a long press of LONG_PRESS_MS without moving,
 *    then moving. Moving earlier is a swipe; the gesture is dropped
 *    and the browser scrolls as usual. Same timing as Obsidian's own
 *    sortable lists.
 *  - Touch with immediateTouch: right away, no long press - for grips,
 *    where canStart lets a touch through only on the grip itself. The
 *    grip needs `touch-action: none` in CSS, or the browser scrolls.
 *
 * A long press released without moving is no drag. With
 * longPressMenu it fires a synthetic "contextmenu" on the pressed
 * element, so the existing right-click handlers open their menu - the
 * way Obsidian's sortable lists do it on mobile. Every other
 * "contextmenu" during a touch gesture is swallowed: Android fires its
 * native one while the finger is still down, Obsidian's iOS app a
 * synthetic one after 800 ms - both would open the menu in the middle
 * of a drag.
 *
 * During a touch drag a non-passive touchmove listener keeps the
 * browser from scrolling; otherwise it takes over the gesture and
 * sends pointercancel. The non-passive touchstart listener on the
 * element itself makes the element a blocking touch region, so the
 * browser waits for those touchmove listeners instead of scrolling
 * straight away.
 *
 * After a drag (and after a long press) the click the browser sends
 * next is swallowed: otherwise dropping a TYP row would open its
 * detail view.
 * ============================================================ */

const LONG_PRESS_MS = 250;
// Movement in px before a mouse drag starts (as the old mouse drag did).
const MOUSE_THRESHOLD = 4;
// Movement in px that turns a touch into a swipe before the long press, or
// into a drag after it.
const TOUCH_SLOP = 5;
// Auto-scroll near the top or bottom edge of the scroll container while
// dragging - on touch there is no other way to reach rows out of view.
const SCROLL_ZONE = 40;
const SCROLL_MAX_STEP = 12;

// Options:
//   canStart(event)    false = this pointerdown is no drag (inputs, buttons…;
//                      event.pointerType tells mouse from touch)
//   immediateTouch     true = a touch drags at once (grip, see above)
//   longPressMenu      true = long press without moving -> "contextmenu"
//   scrollEl           container to auto-scroll; default: nearest scrolling
//                      ancestor at drag start
//   onStart(event)     the drag begins
//   onMove(event)      pointer moved (also after an auto-scroll step)
//   onEnd(commit)      drop (true) or cancel (false: Escape, pointercancel)
function attachPointerDrag(el, options) {
  el.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary) return;
    const isMouse = event.pointerType === "mouse";
    if (isMouse && event.button !== 0) return;
    if (options.canStart && !options.canStart(event)) return;
    runGesture(el, event, options);
  });
  // Empty on purpose, see the header comment.
  el.addEventListener("touchstart", () => {}, { passive: false });
}

function runGesture(el, down, options) {
  const win = el.win ?? window;
  const isMouse = down.pointerType === "mouse";
  const immediate = !isMouse && options.immediateTouch === true;
  const threshold = isMouse ? MOUSE_THRESHOLD : TOUCH_SLOP;
  const startX = down.clientX;
  const startY = down.clientY;

  // armed: moving now drags. Right away for the mouse and grips, after the
  // long press for touch.
  let armed = isMouse || immediate;
  let dragging = false;
  let lastEvent = down;
  let scrollEl = null;
  let scrollStep = 0;
  let frame = 0;
  let ownMenuEvent = null;

  const pressTimer = armed
    ? 0
    : win.setTimeout(() => {
        armed = true;
        try {
          navigator.vibrate?.(50);
        } catch {
          // Not every platform allows it.
        }
      }, LONG_PRESS_MS);

  const autoScroll = () => {
    frame = 0;
    if (!dragging || scrollStep === 0 || !scrollEl) return;
    const before = scrollEl.scrollTop;
    scrollEl.scrollTop += scrollStep;
    if (scrollEl.scrollTop !== before) options.onMove?.(lastEvent);
    frame = win.requestAnimationFrame(autoScroll);
  };

  const updateScroll = (event) => {
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    const zone = Math.min(SCROLL_ZONE, rect.height / 4);
    let depth = 0;
    if (event.clientY < rect.top + zone) depth = (event.clientY - rect.top - zone) / zone;
    else if (event.clientY > rect.bottom - zone) depth = (event.clientY - rect.bottom + zone) / zone;
    scrollStep = Math.round(SCROLL_MAX_STEP * Math.max(-1, Math.min(1, depth)));
    if (scrollStep !== 0 && !frame) frame = win.requestAnimationFrame(autoScroll);
  };

  const onMove = (event) => {
    if (event.pointerId !== down.pointerId) return;
    lastEvent = event;
    if (!dragging) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const moved = dx * dx + dy * dy >= threshold * threshold;
      if (!armed) {
        // A swipe before the long press: leave it to the browser.
        if (moved) finish();
        return;
      }
      if (!moved) return;
      dragging = true;
      win.getSelection()?.removeAllRanges();
      scrollEl = options.scrollEl ?? scrollParent(el);
      options.onStart?.(down);
    }
    event.preventDefault();
    options.onMove?.(event);
    updateScroll(event);
  };

  const onUp = (event) => {
    if (event.pointerId !== down.pointerId) return;
    if (dragging) {
      finish();
      options.onEnd?.(true);
      swallowNextClick(win);
    } else if (armed && !isMouse && !immediate) {
      // A long press without moving: no tap, so no click either.
      finish();
      swallowNextClick(win);
      if (options.longPressMenu) {
        // The element's own window: the settings live in a window of their
        // own on desktop.
        ownMenuEvent = new win.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: startX,
          clientY: startY,
          screenX: down.screenX,
          screenY: down.screenY,
        });
        down.target.dispatchEvent(ownMenuEvent);
      }
    } else {
      finish();
    }
  };

  const onCancel = (event) => {
    if (event.pointerId !== down.pointerId) return;
    const wasDragging = dragging;
    finish();
    if (wasDragging) options.onEnd?.(false);
  };

  const onKey = (event) => {
    if (event.key !== "Escape" || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    finish();
    options.onEnd?.(false);
  };

  const onTouchMove = (event) => {
    if (armed && event.cancelable) event.preventDefault();
  };

  const onContextMenu = (event) => {
    if (event === ownMenuEvent) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  function finish() {
    dragging = false;
    win.clearTimeout(pressTimer);
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    win.removeEventListener("pointermove", onMove, true);
    win.removeEventListener("pointerup", onUp, true);
    win.removeEventListener("pointercancel", onCancel, true);
    win.removeEventListener("keydown", onKey, true);
    win.removeEventListener("touchmove", onTouchMove);
    // A tick later: the native "contextmenu" of a long press may arrive just
    // after the finger lifts.
    if (!isMouse) win.setTimeout(() => win.removeEventListener("contextmenu", onContextMenu, true), 0);
  }

  win.addEventListener("pointermove", onMove, true);
  win.addEventListener("pointerup", onUp, true);
  win.addEventListener("pointercancel", onCancel, true);
  win.addEventListener("keydown", onKey, true);
  if (!isMouse) {
    win.addEventListener("touchmove", onTouchMove, { passive: false });
    win.addEventListener("contextmenu", onContextMenu, true);
  }
}

// One-shot: the click that follows a drop or a long press. The timeout covers
// the case that no click comes at all (pointer released over another element).
function swallowNextClick(win) {
  const swallow = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    off();
  };
  const off = () => {
    win.removeEventListener("click", swallow, true);
    win.clearTimeout(timer);
  };
  const timer = win.setTimeout(off, 400);
  win.addEventListener("click", swallow, true);
}

// Nearest ancestor that actually scrolls vertically.
function scrollParent(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight) continue;
    if (/(auto|scroll)/.test(node.win.getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

// Index of the gap a pointer at clientY points to among rows (elements in
// display order): before the first row whose middle is below the pointer.
// Measured live, so it stays right while the container auto-scrolls.
function gapIndexAt(rows, clientY) {
  const index = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return index === -1 ? rows.length : index;
}

// Marks the gap at `gap` on the rows (is-drop-before on the row after it,
// is-drop-after on the last row) - the look the HTML5 drag had. null clears.
function showDropGap(rows, gap) {
  for (const row of rows) row.removeClass("is-drop-before", "is-drop-after");
  if (gap === null || rows.length === 0) return;
  if (gap < rows.length) rows[gap].addClass("is-drop-before");
  else rows[rows.length - 1].addClass("is-drop-after");
}

module.exports = { attachPointerDrag, gapIndexAt, showDropGap };
