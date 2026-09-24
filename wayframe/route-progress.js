(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CampusRouteProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPSILON = 1e-9;
  const X_METRES = 132.6;
  const Y_METRES = 101.2;

  function validateNodes(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) throw new TypeError('Route must contain nodes');
    for (const node of nodes) {
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || node.floor == null) {
        throw new TypeError('Route nodes need finite coordinates and a floor');
      }
    }
  }

  function validateCursor(nodes, cursor) {
    if (!cursor || !Number.isInteger(cursor.index) || cursor.index < 0 || cursor.index >= nodes.length ||
        !Number.isFinite(cursor.t) || cursor.t < 0 || cursor.t > 1 ||
        (cursor.index === nodes.length - 1 && cursor.t !== 0)) {
      throw new RangeError('Invalid route cursor');
    }
    if (cursor.t > 0 && cursor.t < 1 && nodes[cursor.index].floor !== nodes[cursor.index + 1].floor) {
      throw new RangeError('Cursor cannot be between floors');
    }
  }

  function rawSegment(nodes, index) {
    const a = nodes[index], b = nodes[index + 1];
    if (!a || !b || a.floor !== b.floor) return null;
    const dx = (b.x - a.x) * X_METRES;
    const dy = (b.y - a.y) * Y_METRES;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length)) throw new RangeError('Route segment is too large');
    if (length <= EPSILON) return null;
    return { length, bearing: (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360 };
  }

  function segment(nodes, index) {
    validateNodes(nodes);
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new RangeError('Invalid segment index');
    return rawSegment(nodes, index);
  }

  function canonicalCursor(cursor) {
    return cursor.t === 1 ? { index: cursor.index + 1, t: 0 } : { index: cursor.index, t: cursor.t };
  }

  // Travel is signed. A floor edge is a barrier requiring separate confirmation.
  function move(nodes, cursor, signedMeters) {
    validateNodes(nodes);
    validateCursor(nodes, cursor);
    if (!Number.isFinite(signedMeters)) throw new TypeError('Travel distance must be finite');
    if (signedMeters === 0) return { index: cursor.index, t: cursor.t, moved: 0, blocked: null, transition: null };
    let { index, t } = canonicalCursor(cursor);
    const direction = Math.sign(signedMeters);
    let remaining = Math.abs(signedMeters), travelled = 0;
    function result(blocked = null, transition = null) {
      return { index, t, moved: travelled === 0 ? 0 : direction * travelled, blocked, transition };
    }

    // Each iteration either finishes travel or passes one node, including duplicates.
    for (let guard = 0; guard <= nodes.length; guard++) {
      if (direction > 0) {
        if (index === nodes.length - 1) return result('end');
        if (nodes[index].floor !== nodes[index + 1].floor) {
          return result('floor', { from: nodes[index], to: nodes[index + 1], direction });
        }
        const part = rawSegment(nodes, index);
        if (!part) { index++; t = 0; continue; }
        if (remaining <= EPSILON) return result();
        const available = (1 - t) * part.length;
        if (remaining < available - EPSILON) {
          t += remaining / part.length;
          travelled += remaining;
          return result();
        }
        travelled += available;
        remaining = Math.max(0, remaining - available);
        index++;
        t = 0;
      } else {
        if (t > 0) {
          const part = rawSegment(nodes, index);
          const available = part ? t * part.length : 0;
          if (remaining < available - EPSILON) {
            t -= remaining / part.length;
            travelled += remaining;
            return result();
          }
          travelled += available;
          remaining = Math.max(0, remaining - available);
          t = 0;
        }
        if (index === 0) return result('start');
        if (nodes[index].floor !== nodes[index - 1].floor) {
          return result('floor', { from: nodes[index], to: nodes[index - 1], direction });
        }
        const previous = rawSegment(nodes, index - 1);
        if (!previous) { index--; continue; }
        if (remaining <= EPSILON) return result();
        index--;
        t = 1;
      }
    }
    throw new Error('Route traversal did not terminate');
  }

  function candidates(nodes, cursor, tolerance = 0.75) {
    validateNodes(nodes);
    validateCursor(nodes, cursor);
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('Tolerance must be nonnegative and finite');
    const { index, t } = canonicalCursor(cursor);
    const current = rawSegment(nodes, index);
    const bearings = current ? [current.bearing] : [];

    // Find one adjacent tangent in either direction, skipping coincident nodes only.
    function adjacent(start, direction) {
      for (let i = start; i >= 0 && i < nodes.length - 1; i += direction) {
        if (nodes[i].floor !== nodes[i + 1].floor) return;
        const part = rawSegment(nodes, i);
        if (part) { bearings.push(part.bearing); return; }
      }
    }
    if (!current || t * current.length <= tolerance + EPSILON) adjacent(index - 1, -1);
    if (current) {
      if ((1 - t) * current.length <= tolerance + EPSILON) adjacent(index + 1, 1);
    } else if (index < nodes.length - 1 && nodes[index].floor === nodes[index + 1].floor) {
      adjacent(index, 1);
    }

    // A floor edge is a possible confirmed transition, but never supplies a bearing.
    function hasTravel(direction) {
      if (current && (direction > 0 ? t < 1 : t > 0)) return true;
      for (let i = direction > 0 ? index : index - 1;
           i >= 0 && i < nodes.length - 1; i += direction) {
        if (nodes[i].floor !== nodes[i + 1].floor || rawSegment(nodes, i)) return true;
      }
      return false;
    }
    const result = [];
    for (const direction of [1, -1]) {
      if (!hasTravel(direction)) continue;
      for (const tangent of bearings) {
        const bearing = (tangent + (direction < 0 ? 180 : 0)) % 360;
        if (!result.some(item => item.direction === direction && Math.abs(item.bearing - bearing) < EPSILON)) {
          result.push({ direction, bearing });
        }
      }
    }
    return result;
  }

  return Object.freeze({ segment, move, candidates });
});
