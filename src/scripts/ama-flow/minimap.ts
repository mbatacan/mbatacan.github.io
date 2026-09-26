// A small top-down 2D minimap of the turn-buoy course and both boats, drawn on a plain <canvas>
// (not three.js) since it only needs simple shapes -- a second WebGL pass would be wasteful.
import { COURSE_WAYPOINTS } from './game';

export interface MinimapBoat {
  x: number;
  y: number;
  headingRad: number;
  color: string;
}

const PADDING_PX = 14;
const BOAT_DOT_RADIUS_PX = 4;
const BOAT_TICK_LENGTH_PX = 9;

/** Draws the course (start -> each waypoint) and both boats' positions/headings, scaled to fit
 * the canvas. Sim +y is drawn "up" (canvas -y), matching the 3D top-down camera's own convention
 * (see AmaFlowScene.viewUpAngleRad) so the minimap and that camera never disagree about "up."
 */
export function drawMinimap(canvas: HTMLCanvasElement, boats: MinimapBoat[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(4, 16, 28, 0.75)';
  ctx.fillRect(0, 0, width, height);

  const course: [number, number][] = [[0, 0], ...COURSE_WAYPOINTS];
  const points: [number, number][] = [...course, ...boats.map((b): [number, number] => [b.x, b.y])];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const innerW = width - PADDING_PX * 2;
  const innerH = height - PADDING_PX * 2;
  const scale = Math.min(innerW / rangeX, innerH / rangeY);
  const offsetX = PADDING_PX + (innerW - rangeX * scale) / 2;
  const offsetY = PADDING_PX + (innerH - rangeY * scale) / 2;
  const toCanvas = ([x, y]: [number, number]): [number, number] => [
    offsetX + (x - minX) * scale,
    offsetY + (maxY - y) * scale,
  ];

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  course.forEach((p, i) => {
    const [cx, cy] = toCanvas(p);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // Waypoint markers: turn buoys yellow, the finish green (matching the 3D scene's colors).
  COURSE_WAYPOINTS.forEach((wp, i) => {
    const [cx, cy] = toCanvas(wp);
    ctx.fillStyle = i === COURSE_WAYPOINTS.length - 1 ? '#4ade80' : '#ffb703';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  for (const boat of boats) {
    const [cx, cy] = toCanvas([boat.x, boat.y]);
    ctx.strokeStyle = boat.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(boat.headingRad) * BOAT_TICK_LENGTH_PX,
      cy - Math.sin(boat.headingRad) * BOAT_TICK_LENGTH_PX,
    );
    ctx.stroke();
    ctx.fillStyle = boat.color;
    ctx.beginPath();
    ctx.arc(cx, cy, BOAT_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}
