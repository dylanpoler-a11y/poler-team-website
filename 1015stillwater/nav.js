/* Plan-space navigation for the 1015 Stillwater tour.
 *
 * Pure geometry, no three.js: everything here is in PLAN feet, [X, Z], the same
 * coordinates the architectural trace uses. Kept in its own module so the walk
 * rules can be exercised in Node against nav.json without a browser.
 */
export const BODY_FT = 0.9;      // clearance kept from floor edges and open voids
export const SHOULDER_FT = 0.45; // clearance kept from wall faces; doorways are tight
export const GRID_FT = 0.5;      // routing grid

/** Drop waypoints that lie on the straight line between their neighbours, so the
 *  walk reads as a person crossing a room rather than a piece on a chessboard. */
function simplify(path) {
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i], c = path[i + 1];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function segmentsCross(p0, p1, a, b) {
  const d = (b[0] - a[0]) * (p1[1] - p0[1]) - (b[1] - a[1]) * (p1[0] - p0[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p0[0] - a[0]) * (p1[1] - p0[1]) - (p0[1] - a[1]) * (p1[0] - p0[0])) / d;
  const u = ((p0[0] - a[0]) * (b[1] - a[1]) - (p0[1] - a[1]) * (b[0] - a[0])) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t; // fraction along the WALL, which is what the door gaps are measured in
}

/** Distance in feet from a point to a segment, plus the fraction along it. */
export function pointToSegment(px, pz, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1];
  const len2 = vx * vx + vz * vz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / len2)) : 0;
  const cx = a[0] + vx * t, cz = a[1] + vz * t;
  return [Math.hypot(px - cx, pz - cz), t];
}

export class Level {
  constructor(raw) {
    Object.assign(this, raw);
    this.wallLen = this.walls.map((w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]));
  }

  inside(x, z) {
    if (this.holes.some((h) => pointInPolygon(x, z, h))) return false;
    return this.walkable.some((p) => pointInPolygon(x, z, p));
  }

  /** Standing here is legal only if a body-width around you is also inside, so
   *  you never end up with your head inside an exterior wall or a stair void. */
  standable(x, z) {
    if (!this.inside(x, z)) return false;
    const r = BODY_FT;
    return this.inside(x + r, z) && this.inside(x - r, z)
        && this.inside(x, z + r) && this.inside(x, z - r);
  }

  /** Would this step pass through a wall rather than a doorway? */
  blocked(from, to) {
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const t = segmentsCross(from, to, w.a, w.b);
      if (t === null) continue;
      const at = t * this.wallLen[i];
      const through = w.gaps.some(([s, e]) => at > s + 0.25 && at < e - 0.25);
      if (!through) return true;
    }
    return false;
  }

  /** Nudge away from any wall we are hugging, so we never clip into one. */
  clearOfWalls(x, z) {
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const [dist, t] = pointToSegment(x, z, w.a, w.b);
      const need = w.t / 2 + SHOULDER_FT;
      if (dist >= need) continue;
      const at = t * this.wallLen[i];
      if (w.gaps.some(([s, e]) => at > s && at < e)) continue; // standing in a doorway
      return false;
    }
    return true;
  }

  /** One step, sliding along a wall rather than stopping dead when blocked.
   *  Returns the new position, or null when every attempt is illegal. */
  step(from, dx, dz) {
    for (const [ax, az] of [[dx, dz], [dx, 0], [0, dz]]) {
      if (!ax && !az) continue;
      const to = { x: from.x + ax, z: from.z + az };
      if (!this.standable(to.x, to.z)) continue;
      if (!this.clearOfWalls(to.x, to.z)) continue;
      if (this.blocked([from.x, from.z], [to.x, to.z])) continue;
      return to;
    }
    return null;
  }

  /** Nearest legal standing cell to a point, on the routing grid. */
  nearestCell(c) {
    for (let r = 0; r < 30; r++)
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          const x = c[0] + di * GRID_FT, z = c[1] + dj * GRID_FT;
          if (this.standable(x, z)) return [Math.round(x / GRID_FT), Math.round(z / GRID_FT)];
        }
    return null;
  }

  /** Waypoints from one plan point to another, going around walls rather than
   *  into them. Breadth-first on a half-foot grid: a couple of milliseconds on a
   *  floor this size, and it means tapping a room across the house actually
   *  walks you there. Returns null when there is no way through. */
  route(from, to) {
    const start = this.nearestCell(from), goal = this.nearestCell(to);
    if (!start || !goal) return null;
    const key = (i, j) => i + ',' + j;
    const prev = new Map([[key(start[0], start[1]), null]]);
    const q = [start];
    const goalKey = key(goal[0], goal[1]);
    for (let head = 0; head < q.length && !prev.has(goalKey); head++) {
      const [i, j] = q[head];
      const a = { x: i * GRID_FT, z: j * GRID_FT };
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(i + di, j + dj);
        if (prev.has(k)) continue;
        const b = { x: (i + di) * GRID_FT, z: (j + dj) * GRID_FT };
        if (!this.standable(b.x, b.z) || !this.clearOfWalls(b.x, b.z)) continue;
        if (this.blocked([a.x, a.z], [b.x, b.z])) continue;
        prev.set(k, [i, j]);
        q.push([i + di, j + dj]);
      }
    }
    if (!prev.has(goalKey)) return null;
    const path = [];
    for (let c = goal; c; c = prev.get(key(c[0], c[1]))) path.push({ x: c[0] * GRID_FT, z: c[1] * GRID_FT });
    path.reverse();
    return simplify(path);
  }

  onStair(x, z) {
    return this.stairs.some((s) => pointInPolygon(x, z, s));
  }

  nearestRoom(x, z) {
    let best = null, bestD = Infinity;
    for (const r of this.rooms) {
      const d = Math.hypot(r.c[0] - x, r.c[1] - z);
      if (d < bestD) { bestD = d; best = r; }
    }
    return bestD < 26 ? best : null;
  }
}

