// Controller for the /lab/rl-paddler page: owns the race state (Watch/Play, the Duel, clock and timer),
// wires the page's controls (tabs, model picker, restart, speed, camera, keyboard), and runs the
// render loop that feeds the three.js scene, compass, minimap and HUD. Imported by the page's
// <script>; it assumes the page's markup (every element id below) is present.
import {
  COURSE_LENGTH_M,
  COURSE_WAYPOINTS,
  Duel,
  EPISODE_STROKES,
  policies,
  randomConditions,
  setSelectedPolicy,
  type SideId,
} from './game';
import { decodeAction, lerpState, type State } from '../../lib/ama-flow/physics';
import { compassRotationDeg } from '../../lib/ama-flow/compass';
import { drawMinimap } from './minimap';
import type { AmaFlowScene } from './scene';

const SIDE_NAMES = ['port', 'starboard'];
const STROKE_TYPE_NAMES = ['forward', 'draw', 'poke', 'rudder'];
const MPS_TO_KT = 1.94384;

type Mode = 'watch' | 'play';

const canvas = document.getElementById('af-canvas') as HTMLCanvasElement;
const statusEl = document.getElementById('af-status')!;
const hudBlueEl = document.getElementById('af-hud-blue')!;
const hudRedEl = document.getElementById('af-hud-red')!;
const hudStrokeEl = document.getElementById('af-hud-stroke')!;
const hudTimeEl = document.getElementById('af-hud-time')!;
const tabWatch = document.getElementById('af-tab-watch')!;
const tabPlay = document.getElementById('af-tab-play')!;
const playDirectionsEl = document.getElementById('af-play-directions')!;
const legendWatchEl = document.getElementById('af-legend-watch')!;
const legendPlayEl = document.getElementById('af-legend-play')!;
const restartBtn = document.getElementById('af-restart')!;
const resultsEl = document.getElementById('af-results')!;
const resultsTitleEl = document.getElementById('af-results-title')!;
const resultsMarginEl = document.getElementById('af-results-margin')!;
const resultsTimeEl = document.getElementById('af-results-time')!;
const resultsRowBlueEl = document.getElementById('af-results-row-blue')!;
const resultsRowRedEl = document.getElementById('af-results-row-red')!;
const resultsBlueLabelEl = document.getElementById('af-results-blue-label')!;
const resultsBlueRmsEl = document.getElementById('af-results-blue-rms')!;
const resultsBlueDistanceEl = document.getElementById('af-results-blue-distance')!;
const resultsBlueSpeedEl = document.getElementById('af-results-blue-speed')!;
const resultsRedLabelEl = document.getElementById('af-results-red-label')!;
const resultsRedRmsEl = document.getElementById('af-results-red-rms')!;
const resultsRedDistanceEl = document.getElementById('af-results-red-distance')!;
const resultsRedSpeedEl = document.getElementById('af-results-red-speed')!;
const resultsCloseBtn = document.getElementById('af-results-close')!;
document.getElementById('af-results-distance-header')!.textContent = `distance (of ${COURSE_LENGTH_M} m)`;
const cameraToggleBtn = document.getElementById('af-camera-toggle')!;
const speedToggleBtn = document.getElementById('af-speed-toggle')!;
const compassTargetEl = document.getElementById('af-compass-target')!;
const compassWindEl = document.getElementById('af-compass-wind')!;
const compassWindLabelEl = document.getElementById('af-compass-wind-label')!;
const compassCurrentEl = document.getElementById('af-compass-current')!;
const compassCurrentLabelEl = document.getElementById('af-compass-current-label')!;
const progressBlueEl = document.getElementById('af-progress-blue')!;
const progressRedEl = document.getElementById('af-progress-red')!;
const minimapCanvas = document.getElementById('af-minimap') as HTMLCanvasElement;
const controlHudEl = document.getElementById('af-control-hud')!;
const controlKeySideEls = [
  document.getElementById('af-control-key-side-0')!,
  document.getElementById('af-control-key-side-1')!,
];
const controlKeyStrokeEls = [0, 1, 2, 3].map((i) => document.getElementById(`af-control-key-stroke-${i}`)!);

const STROKE_DURATION_S = 1.1; // matches ama-flow's oc6_stroke_config().duration_s -- sim time
// Real-world OC6 crews hold about 50 strokes per minute; render at that pace regardless of
// mode (Play previously ran slower than Watch, neither matched a real cadence).
const STROKE_PERIOD_S = 60 / 50; // real seconds per stroke
const SPEED = STROKE_DURATION_S / STROKE_PERIOD_S; // sim-seconds per real second

let mode: Mode = 'watch';
let modelLabel = 'model'; // the selected checkpoint's label, set by applySelectedModel()
let duel = new Duel(randomConditions(Math.floor(Math.random() * 1_000_000)));
let scene: AmaFlowScene | null = null; // set once the dynamic import below resolves
let running = false;
let clockS = 0;
let lastTimeMs: number | null = null;
const control = { side: 0, strokeType: 0 }; // PORT forward, until the player changes it

// Wall-clock race timer -- raceStartMs and the timestamps requestAnimationFrame hands frame()
// share the same time origin as performance.now(), so they're directly comparable.
let raceStartMs = 0;
let elapsedRaceS = 0;

// Watch-only playback speed multiplier -- Play always runs at 1x, so the controls feel
// consistent regardless of what Watch was last left at.
const SPEED_MULTIPLIERS = [1, 2, 4];
let speedMultiplier = 1;
speedToggleBtn.addEventListener('click', () => {
  const i = SPEED_MULTIPLIERS.indexOf(speedMultiplier);
  speedMultiplier = SPEED_MULTIPLIERS[(i + 1) % SPEED_MULTIPLIERS.length];
  speedToggleBtn.textContent = `${speedMultiplier}x speed`;
});

function bluePlayerSide(): SideId {
  return 'player'; // blue is always the "player" slot: the model in Watch, you in Play
}
function redOpponentSide(): SideId {
  return 'opponent'; // red is always the "opponent" slot: the baseline in Watch, model in Play
}

function actionFor(side: SideId): number {
  if (mode === 'watch') {
    return side === bluePlayerSide()
      ? policies.model(duel.observation(side))
      : policies.baseline(duel.observation(side));
  }
  // Play: blue is the person's current control selection, red is the model.
  return side === bluePlayerSide()
    ? control.side * 4 + control.strokeType
    : policies.model(duel.observation(side));
}

function stepOneStroke(): void {
  (['player', 'opponent'] as SideId[]).forEach((side) => {
    if (!duel.isDone(side)) duel.step(side, actionFor(side));
  });
  hudStrokeEl.textContent = `stroke ${duel.history('player').actions.length}/${EPISODE_STROKES}`;
  if (duel.isDone('player') && duel.isDone('opponent')) finish();
}

function finish(): void {
  running = false;
  const blueLabel = mode === 'watch' ? modelLabel : 'you';
  const redLabel = mode === 'watch' ? 'baseline' : modelLabel;
  const blueRms = duel.rmsHeadingErrorDeg(bluePlayerSide());
  const redRms = duel.rmsHeadingErrorDeg(redOpponentSide());
  const blueVmg = duel.distanceMadeGoodM(bluePlayerSide());
  const redVmg = duel.distanceMadeGoodM(redOpponentSide());
  const distanceGapM = Math.abs(blueVmg - redVmg);
  // Each side's own stroke count, not a shared one -- whichever side finished the course in
  // fewer strokes was actually faster on average, and that's a real signal (the race only ends
  // once *both* are done, so a side that finishes early just stops accumulating strokes).
  const blueAvgSpeedKt = (blueVmg / (duel.history('player').actions.length * STROKE_DURATION_S)) * MPS_TO_KT;
  const redAvgSpeedKt = (redVmg / (duel.history('opponent').actions.length * STROKE_DURATION_S)) * MPS_TO_KT;

  // Always declare a winner with a concrete margin, rather than only when one side dominates
  // both metrics (that gave a vague "it's close" even when the numbers clearly differed).
  // Whoever covered more of the course wins outright; if both finished (the common case, where
  // distanceMadeGoodM caps at COURSE_LENGTH_M for anyone who completes it), fall back to
  // whoever held heading tighter.
  const blueWins = distanceGapM > 0 ? blueVmg > redVmg : blueRms < redRms;
  const winnerName = blueWins ? `blue (${blueLabel})` : `red (${redLabel})`;
  const margin =
    distanceGapM > 0
      ? `${distanceGapM.toFixed(0)} m further along the course`
      : (() => {
          const better = Math.min(blueRms, redRms);
          const worse = Math.max(blueRms, redRms);
          return `${(((worse - better) / worse) * 100).toFixed(0)}% tighter heading control (tied on distance)`;
        })();

  resultsTitleEl.textContent = `${winnerName} wins`;
  resultsMarginEl.textContent = `by ${margin}`;
  resultsTimeEl.textContent = `race time ${elapsedRaceS.toFixed(1)}s`;

  resultsBlueLabelEl.textContent = `blue (${blueLabel})`;
  resultsBlueRmsEl.textContent = `${blueRms.toFixed(1)} deg`;
  // "made good" is sailing jargon for actual progress toward the goal (vs. raw distance
  // traveled, which drifting off course would inflate) -- spelled out here instead. The course
  // total is in the column header, not repeated on every row.
  resultsBlueDistanceEl.textContent = `${blueVmg.toFixed(0)} m`;
  resultsBlueSpeedEl.textContent = `${blueAvgSpeedKt.toFixed(1)} kt`;

  resultsRedLabelEl.textContent = `red (${redLabel})`;
  resultsRedRmsEl.textContent = `${redRms.toFixed(1)} deg`;
  resultsRedDistanceEl.textContent = `${redVmg.toFixed(0)} m`;
  resultsRedSpeedEl.textContent = `${redAvgSpeedKt.toFixed(1)} kt`;

  resultsRowBlueEl.classList.toggle('af-results-row--winner', blueWins);
  resultsRowRedEl.classList.toggle('af-results-row--winner', !blueWins);

  resultsEl.hidden = false;
}

function restart(): void {
  const seed = Math.floor(Math.random() * 1_000_000);
  duel = new Duel(randomConditions(seed), seed);
  clockS = 0;
  lastTimeMs = null;
  raceStartMs = performance.now();
  elapsedRaceS = 0;
  hudTimeEl.textContent = '0.0s';
  hudStrokeEl.textContent = `stroke 0/${EPISODE_STROKES}`;
  resultsEl.hidden = true;
  running = true;
  scene?.setConditions(duel.conditions);
  compassWindLabelEl.textContent = `wind ${(duel.conditions.wind_speed_mps * MPS_TO_KT).toFixed(0)} kt`;
  compassCurrentLabelEl.textContent = `current ${(duel.conditions.current_speed_mps * MPS_TO_KT).toFixed(1)} kt`;
}

/** Highlights the player's current side/stroke-type selection directly on the canvas, so
 * Play mode doesn't require looking away to the controls column to know what's selected.
 */
function updateControlHud(): void {
  controlHudEl.hidden = mode !== 'play';
  controlKeySideEls.forEach((el, i) => el.classList.toggle('af-control-key--active', i === control.side));
  controlKeyStrokeEls.forEach((el, i) => el.classList.toggle('af-control-key--active', i === control.strokeType));
}

function setMode(next: Mode): void {
  mode = next;
  tabWatch.setAttribute('aria-selected', String(next === 'watch'));
  tabPlay.setAttribute('aria-selected', String(next === 'play'));
  playDirectionsEl.hidden = next !== 'play';
  legendWatchEl.hidden = next !== 'watch';
  legendPlayEl.hidden = next !== 'play';
  hudBlueEl.textContent = next === 'watch' ? `blue (${modelLabel}): —` : 'blue (you): —';
  hudRedEl.textContent = next === 'watch' ? 'red (baseline): —' : `red (${modelLabel}): —`;
  speedToggleBtn.hidden = next !== 'watch';
  speedMultiplier = 1;
  speedToggleBtn.textContent = '1x speed';
  updateControlHud();
  restart();
}

const modelSelectEl = document.getElementById('af-model-select') as HTMLSelectElement;
/** Points the game at the selected checkpoint and shows only that entry's info panel. */
function applySelectedModel(): void {
  setSelectedPolicy(modelSelectEl.value);
  modelLabel = modelSelectEl.selectedOptions[0].textContent ?? modelSelectEl.value;
  document.querySelectorAll<HTMLElement>('.af-model-entry').forEach((el) => {
    el.hidden = el.dataset.modelId !== modelSelectEl.value;
  });
}
applySelectedModel(); // the browser can restore a previous selection on reload
modelSelectEl.addEventListener('change', () => {
  applySelectedModel();
  restart();
});

tabWatch.addEventListener('click', () => setMode('watch'));
tabPlay.addEventListener('click', () => setMode('play'));
restartBtn.addEventListener('click', restart);
resultsCloseBtn.addEventListener('click', () => (resultsEl.hidden = true));

window.addEventListener('keydown', (e) => {
  if (mode !== 'play') return;
  if (e.key === 'ArrowLeft') control.side = 0;
  else if (e.key === 'ArrowRight') control.side = 1;
  else if (e.key === '1') control.strokeType = 0;
  else if (e.key === '2') control.strokeType = 1;
  else if (e.key === '3') control.strokeType = 2;
  else if (e.key === '4') control.strokeType = 3;
  else return;
  updateControlHud();
});

import('./scene').then(({ AmaFlowScene }) => {
  // A non-null local alias: `scene` (the module-level binding restart() reads) is nullable
  // only until this promise resolves, but TS can't see that across the closure.
  const activeScene = new AmaFlowScene(canvas, duel.conditions, COURSE_WAYPOINTS);
  scene = activeScene;
  const resizeObserver = new ResizeObserver(() => activeScene.resize());
  resizeObserver.observe(canvas);

  // Conditions are fixed for the episode, so the compass labels are set once; only each
  // arrow's rotation (relative to the current view) changes per frame, below.
  compassWindLabelEl.textContent = `wind ${(duel.conditions.wind_speed_mps * MPS_TO_KT).toFixed(0)} kt`;
  compassCurrentLabelEl.textContent = `current ${(duel.conditions.current_speed_mps * MPS_TO_KT).toFixed(1)} kt`;

  let cameraMode: 'chase' | 'top' = 'chase';
  cameraToggleBtn.addEventListener('click', () => {
    cameraMode = cameraMode === 'chase' ? 'top' : 'chase';
    activeScene.setCameraMode(cameraMode);
    cameraToggleBtn.textContent = cameraMode === 'chase' ? 'top-down view' : 'chase view';
  });

  statusEl.textContent = 'ready';
  running = true;
  raceStartMs = performance.now(); // the first race, same as restart() does for every one after

  function frame(timeMs: number) {
    requestAnimationFrame(frame);
    if (lastTimeMs === null) lastTimeMs = timeMs;
    const dtS = Math.min((timeMs - lastTimeMs) / 1000, 0.25);
    lastTimeMs = timeMs;

    if (running) {
      elapsedRaceS = (timeMs - raceStartMs) / 1000;
      hudTimeEl.textContent = `${elapsedRaceS.toFixed(1)}s`;
      clockS += dtS * SPEED * speedMultiplier;
      while (clockS >= STROKE_DURATION_S) {
        clockS -= STROKE_DURATION_S;
        if (!(duel.isDone('player') && duel.isDone('opponent'))) stepOneStroke();
      }
    }

    const elapsed = timeMs / 1000;
    // Render the transition from the stroke before last to the one just completed, timed
    // against clockS (elapsed since that step). This trades one stroke (~1s) of latency for
    // perfectly smooth motion, since the *next* state doesn't exist until the timer fires.
    const t = clockS / STROKE_DURATION_S;
    const renderStates: Record<SideId, State> = { player: [0, 0, 0, 0, 0, 0], opponent: [0, 0, 0, 0, 0, 0] };
    for (const side of ['player', 'opponent'] as SideId[]) {
      const states = duel.history(side).states;
      const i = Math.min(states.length - 1, states.length - (duel.isDone(side) ? 1 : 2));
      const a = states[Math.max(i, 0)];
      const b = states[Math.min(i + 1, states.length - 1)];
      const state = duel.isDone(side) ? states[states.length - 1] : lerpState(a, b, t);
      renderStates[side] = state;
      activeScene.setBoatState(side, state[0], state[1], state[2], elapsed);

      const waypoint = duel.currentWaypoint(side);
      activeScene.setTrackerTarget(side, waypoint[0], waypoint[1]);

      const lastAction = duel.history(side).actions.at(-1);
      if (lastAction !== undefined) {
        const { side: paddleSide, strokeType } = decodeAction(lastAction);
        activeScene.setStroke(side, paddleSide, strokeType, duel.isDone(side) ? 0 : t);
      }
      activeScene.setCrewStroke(side, duel.history(side).actions.length, duel.isDone(side) ? 0 : t);
    }
    activeScene.render(elapsed, bluePlayerSide());

    const viewUp = activeScene.viewUpAngleRad(bluePlayerSide());
    compassWindEl.style.transform = `rotate(${compassRotationDeg(duel.conditions.wind_direction_rad, viewUp)}deg)`;
    compassCurrentEl.style.transform = `rotate(${compassRotationDeg(duel.conditions.current_direction_rad, viewUp)}deg)`;
    const targetHeadingRad = duel.currentTargetHeadingRad(bluePlayerSide());
    compassTargetEl.style.transform = `rotate(${compassRotationDeg(targetHeadingRad, viewUp)}deg)`;

    // A fixed (world-up) orientation, not heading-up: rotating the map with the player's
    // heading was tried and reverted -- even smoothed, the constant small steering corrections
    // made the whole map visibly swim rather than only reorienting for the one real turn.
    drawMinimap(minimapCanvas, [
      { x: renderStates.player[0], y: renderStates.player[1], headingRad: renderStates.player[2], color: '#8b8bff' },
      { x: renderStates.opponent[0], y: renderStates.opponent[1], headingRad: renderStates.opponent[2], color: '#e05a5a' },
    ]);

    const blueLabel = mode === 'watch' ? modelLabel : 'you';
    const redLabel = mode === 'watch' ? 'baseline' : modelLabel;
    const blueErr = duel.history('player').headingErrorDeg.at(-1) ?? 0;
    const redErr = duel.history('opponent').headingErrorDeg.at(-1) ?? 0;
    const blueSpeedKt = renderStates.player[3] * MPS_TO_KT;
    const redSpeedKt = renderStates.opponent[3] * MPS_TO_KT;
    const blueAction = duel.history('player').actions.at(-1);
    const redAction = duel.history('opponent').actions.at(-1);
    const strokeText = (action: number | undefined) => {
      if (action === undefined) return '';
      const { side: s, strokeType: st } = decodeAction(action);
      return ` · ${SIDE_NAMES[s]} ${STROKE_TYPE_NAMES[st]}`;
    };
    hudBlueEl.textContent = `blue (${blueLabel}): ${blueErr.toFixed(1)} deg · ${blueSpeedKt.toFixed(1)} kt${strokeText(blueAction)}`;
    hudRedEl.textContent = `red (${redLabel}): ${redErr.toFixed(1)} deg · ${redSpeedKt.toFixed(1)} kt${strokeText(redAction)}`;

    const progressPct = (side: SideId) =>
      `${Math.max(0, Math.min(1, duel.distanceMadeGoodM(side) / COURSE_LENGTH_M)) * 100}%`;
    progressBlueEl.style.left = progressPct('player');
    progressRedEl.style.left = progressPct('opponent');
  }
  requestAnimationFrame(frame);
});
