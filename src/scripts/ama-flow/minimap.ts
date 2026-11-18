// A small top-down 2D minimap of the course, both boats and the paths they have paddled, drawn on a plain <canvas>
// (not three.js) since it only needs simple shapes -- a second WebGL pass would be wasteful.
import { COURSE_WAYPOINTS, FINISH_GATE_HALF_WIDTH_M } from './game';

export interface MinimapBoat {
  x: number;
  y: number;
  headingRad: number;
  color: string;
  /** Positions at each completed stroke so far, drawn as the boat's path. */
  track: [number, number][];
}

const PADDING_PX = 14;
const BOAT_DOT_RADIUS_PX = 4;
const BOAT_TICK_LENGTH_PX = 9;

/** Draws the course (start -> each waypoint), each boat's path so far and its position/heading,
 * scaled to fit the canvas. The course runs up the map: sim +x (down the course) is canvas up and
 * sim +y (port) is canvas left, the way the chase camera looks at it. A fixed orientation, not
 * heading-up: rotating the map with the player's heading was tried and reverted -- even smoothed,
 * the constant small steering corrections made the whole map visibly swim.
 */
export function drawMinimap(canvas: HTMLCanvasElement, boats: MinimapBoat[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const course: [number, number][] = [[0, 0], ...COURSE_WAYPOINTS];
  const points: [number, number][] = [...course, ...boats.map((b): [number, number] => [b.x, b.y])];
  const xs = points.map((p) => p[0]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  // Symmetric about the course line and at least the finish gate wide, so the map stays put as
  // the boats drift instead of re-centring every frame.
  const halfY = Math.max(FINISH_GATE_HALF_WIDTH_M, ...points.map((p) => Math.abs(p[1])));
  const innerW = width - PADDING_PX * 2;
  const innerH = height - PADDING_PX * 2;
  const scale = Math.min(innerW / (halfY * 2), innerH / (maxX - minX));
  const offsetY = PADDING_PX + (innerH - (maxX - minX) * scale) / 2;
  const toCanvas = ([x, y]: [number, number]): [number, number] => [
    width / 2 - y * scale,
    offsetY + (maxX - x) * scale,
  ];
  const trace = (path: [number, number][]) => {
    ctx.beginPath();
    path.forEach((p, i) => {
      const [cx, cy] = toCanvas(p);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  };

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  trace(course);
  ctx.setLineDash([]);

  // Waypoint markers: turn buoys yellow, the finish coral (matching the 3D scene's buoys).
  COURSE_WAYPOINTS.forEach((wp, i) => {
    const [cx, cy] = toCanvas(wp);
    ctx.fillStyle = i === COURSE_WAYPOINTS.length - 1 ? '#ff5a4d' : '#ffc533';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  for (const boat of boats) {
    const [cx, cy] = toCanvas([boat.x, boat.y]);
    ctx.strokeStyle = boat.color;
    ctx.lineWidth = 1.5;
    trace([...boat.track, [boat.x, boat.y]]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx - Math.sin(boat.headingRad) * BOAT_TICK_LENGTH_PX,
      cy - Math.cos(boat.headingRad) * BOAT_TICK_LENGTH_PX,
    );
    ctx.stroke();
    ctx.fillStyle = boat.color;
    ctx.beginPath();
    ctx.arc(cx, cy, BOAT_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}
