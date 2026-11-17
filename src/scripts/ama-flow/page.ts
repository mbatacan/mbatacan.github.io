// Controller for the /lab/rl-paddler page: owns the race state (Watch/Play, the Duel, clock and timer),
// wires the page's controls (tabs, model picker, restart, speed, camera, keyboard), and runs the
// render loop that feeds the three.js scene, minimap and HUD. Imported by the page's
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
import { bearingSector, compassRotationDeg } from '../../lib/ama-flow/compass';
import { drawMinimap } from './minimap';
import type { AmaFlowScene } from './scene';

const SIDE_NAMES = ['port', 'starboard'];
const STROKE_TYPE_NAMES = ['forward', 'draw', 'poke', 'rudder'];
const MPS_TO_KT = 1.94384;

const BOAT_COLORS = { player: '#8f8fff', opponent: '#ff7b6e' };
const OFF_COURSE_BAR_DEG = 30; // heading error at which the off-course marker reaches the bar's end

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
const cameraButtons = {
  chase: document.getElementById('af-camera-chase')!,
  top: document.getElementById('af-camera-top')!,
};
const pauseBtn = document.getElementById('af-pause')!;
const speedGroupEl = document.getElementById('af-speed')!;
const speedButtons = [...speedGroupEl.querySelectorAll<HTMLElement>('[data-speed]')];
const hudConditionsEl = document.getElementById('af-hud-conditions')!;
const hudMarkEl = document.getElementById('af-hud-mark')!;
const hudLeadLabelEl = document.getElementById('af-hud-lead-label')!;
const hudLeadEl = document.getElementById('af-hud-lead')!;
const hudSpeedEl = document.getElementById('af-hud-speed')!;
const hudMadeGoodEl = document.getElementById('af-hud-made-good')!;
const hudWindEl = document.getElementById('af-hud-wind')!;
const hudCurrentEl = document.getElementById('af-hud-current')!;
const hudOffCourseEl = document.getElementById('af-hud-offcourse')!;
const offCourseMarkerEl = document.getElementById('af-offcourse-marker')!;
const minimapCanvas = document.getElementById('af-minimap') as HTMLCanvasElement;
const chipSideEls = [0, 1].map((i) => document.getElementById(`af-chip-side-${i}`)!);
const chipStrokeEls = [0, 1, 2, 3].map((i) => document.getElementById(`af-chip-stroke-${i}`)!);

const STROKE_DURATION_S = 1.1; // matches ama-flow's oc6_stroke_config().duration_s -- sim time
// Real-world OC6 crews hold about 50 strokes per minute; render at that pace regardless of
// mode (Play previously ran slower than Watch, neither matched a real cadence).
const STROKE_PERIOD_S = 60 / 50; // real seconds per stroke
const SPEED = STROKE_DURATION_S / STROKE_PERIOD_S; // sim-seconds per real second

let mode: Mode = 'watch';
let duel = new Duel(randomConditions(Math.floor(Math.random() * 1_000_000)));
let scene: AmaFlowScene | null = null; // set once the dynamic import below resolves
let running = false;
let paused = false;
let clockS = 0;
let lastTimeMs: number | null = null;
const control = { side: 0, strokeType: 0 }; // PORT forward, until the player changes it

// Race clock: accumulated from frame deltas (not wall-clock), so it stops while paused and runs
// with the playback speed.
let elapsedRaceS = 0;

// Watch-only playback speed multiplier -- Play always runs at 1x, so the controls feel
// consistent regardless of what Watch was last left at.
let speedMultiplier = 1;
function setSpeed(multiplier: number): void {
  speedMultiplier = multiplier;
  speedButtons.forEach((el) => el.setAttribute('aria-pressed', String(Number(el.dataset.speed) === multiplier)));
}
speedButtons.forEach((el) => el.addEventListener('click', () => setSpeed(Number(el.dataset.speed))));

function setPaused(next: boolean): void {
  paused = next;
  pauseBtn.setAttribute('aria-pressed', String(next));
  pauseBtn.textContent = next ? 'resume' : 'pause';
}
pauseBtn.addEventListener('click', () => setPaused(!paused));

/** What each canoe is called on the page: periwinkle first, coral second. */
function boatNames(): [string, string] {
  return mode === 'watch' ? ['agent', 'scripted'] : ['you', 'agent'];
}

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
  hudStrokeEl.textContent = `${duel.history('player').actions.length}/${EPISODE_STROKES}`;
  if (duel.isDone('player') && duel.isDone('opponent')) finish();
}

function finish(): void {
  running = false;
  const [blueLabel, redLabel] = boatNames();
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
  const winnerName = blueWins ? blueLabel : redLabel;
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

  resultsBlueLabelEl.textContent = blueLabel;
  resultsBlueRmsEl.textContent = `${blueRms.toFixed(1)} deg`;
  // "made good" is sailing jargon for actual progress toward the goal (vs. raw distance
  // traveled, which drifting off course would inflate) -- spelled out here instead. The course
  // total is in the column header, not repeated on every row.
  resultsBlueDistanceEl.textContent = `${blueVmg.toFixed(0)} m`;
  resultsBlueSpeedEl.textContent = `${blueAvgSpeedKt.toFixed(1)} kt`;

  resultsRedLabelEl.textContent = redLabel;
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
  elapsedRaceS = 0;
  hudTimeEl.textContent = '0.0s';
  hudStrokeEl.textContent = `0/${EPISODE_STROKES}`;
  resultsEl.hidden = true;
  running = true;
  setPaused(false);
  scene?.setConditions(duel.conditions);
  hudConditionsEl.textContent = `${windKt()} kt wind, ${currentKt()} kt current`;
}

const windKt = () => (duel.conditions.wind_speed_mps * MPS_TO_KT).toFixed(0);
const currentKt = () => (duel.conditions.current_speed_mps * MPS_TO_KT).toFixed(1);

/** Lights the side and stroke-type chips around the speed readout. */
function showStroke(side: number, strokeType: number): void {
  chipSideEls.forEach((el, i) => el.classList.toggle('af-stroke-chip--active', i === side));
  chipStrokeEls.forEach((el, i) => el.classList.toggle('af-stroke-chip--active', i === strokeType));
}

function setMode(next: Mode): void {
  mode = next;
  tabWatch.setAttribute('aria-selected', String(next === 'watch'));
  tabPlay.setAttribute('aria-selected', String(next === 'play'));
  playDirectionsEl.hidden = next !== 'play';
  legendWatchEl.hidden = next !== 'watch';
  legendPlayEl.hidden = next !== 'play';
  speedGroupEl.hidden = next !== 'watch';
  setSpeed(1);
  restart();
}

const modelSelectEl = document.getElementById('af-model-select') as HTMLSelectElement;
/** Points the game at the selected checkpoint and shows only that entry's info panel. */
function applySelectedModel(): void {
  setSelectedPolicy(modelSelectEl.value);
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
});

import('./scene').then(({ AmaFlowScene }) => {
  // A non-null local alias: `scene` (the module-level binding restart() reads) is nullable
  // only until this promise resolves, but TS can't see that across the closure.
  const activeScene = new AmaFlowScene(canvas, duel.conditions, COURSE_WAYPOINTS);
  scene = activeScene;
  const resizeObserver = new ResizeObserver(() => activeScene.resize());
  resizeObserver.observe(canvas);

  hudConditionsEl.textContent = `${windKt()} kt wind, ${currentKt()} kt current`;

  (['chase', 'top'] as const).forEach((cameraMode) => {
    cameraButtons[cameraMode].addEventListener('click', () => {
      activeScene.setCameraMode(cameraMode);
      cameraButtons.chase.setAttribute('aria-pressed', String(cameraMode === 'chase'));
      cameraButtons.top.setAttribute('aria-pressed', String(cameraMode === 'top'));
    });
  });

  statusEl.textContent = '';
  running = true;

  function frame(timeMs: number) {
    requestAnimationFrame(frame);
    if (lastTimeMs === null) lastTimeMs = timeMs;
    const dtS = Math.min((timeMs - lastTimeMs) / 1000, 0.25);
    lastTimeMs = timeMs;

    if (running && !paused) {
      elapsedRaceS += dtS * speedMultiplier;
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
    const tracks: Record<SideId, [number, number][]> = { player: [], opponent: [] };
    for (const side of ['player', 'opponent'] as SideId[]) {
      const states = duel.history(side).states;
      const i = Math.min(states.length - 1, states.length - (duel.isDone(side) ? 1 : 2));
      const a = states[Math.max(i, 0)];
      const b = states[Math.min(i + 1, states.length - 1)];
      const state = duel.isDone(side) ? states[states.length - 1] : lerpState(a, b, t);
      renderStates[side] = state;
      tracks[side] = states.slice(0, Math.max(i, 0) + 1).map((s): [number, number] => [s[0], s[1]]);
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

    drawMinimap(
      minimapCanvas,
      (['opponent', 'player'] as SideId[]).map((side) => ({
        x: renderStates[side][0],
        y: renderStates[side][1],
        headingRad: renderStates[side][2],
        color: BOAT_COLORS[side],
        track: tracks[side],
      })),
    );

    const [blueLabel, redLabel] = boatNames();
    const blueErr = duel.history('player').headingErrorDeg.at(-1) ?? 0;
    const redErr = duel.history('opponent').headingErrorDeg.at(-1) ?? 0;
    const blueAction = duel.history('player').actions.at(-1);
    const redAction = duel.history('opponent').actions.at(-1);
    const strokeText = (action: number | undefined) => {
      if (action === undefined) return '';
      const { side: s, strokeType: st } = decodeAction(action);
      return ` · ${SIDE_NAMES[s]} ${STROKE_TYPE_NAMES[st]}`;
    };
    hudBlueEl.textContent = `${blueLabel}: ${blueErr.toFixed(1)} deg · ${(renderStates.player[3] * MPS_TO_KT).toFixed(1)} kt${strokeText(blueAction)}`;
    hudRedEl.textContent = `${redLabel}: ${redErr.toFixed(1)} deg · ${(renderStates.opponent[3] * MPS_TO_KT).toFixed(1)} kt${strokeText(redAction)}`;

    // The in-view HUD follows the periwinkle canoe.
    const [x, y, psi, u, v] = renderStates.player;
    const legBearing = duel.currentTargetHeadingRad('player');
    // Ground velocity (body frame u, v) projected on the leg's bearing.
    const madeGoodMps = u * Math.cos(psi - legBearing) - v * Math.sin(psi - legBearing);
    hudSpeedEl.textContent = (u * MPS_TO_KT).toFixed(1);
    hudMadeGoodEl.textContent = (madeGoodMps * MPS_TO_KT).toFixed(1);

    const mark = duel.currentWaypoint('player');
    hudMarkEl.textContent = `${Math.hypot(mark[0] - x, mark[1] - y).toFixed(0)} m`;

    const leadM = duel.distanceMadeGoodM('player') - duel.distanceMadeGoodM('opponent');
    const leader = leadM > 0 ? blueLabel : redLabel;
    hudLeadLabelEl.textContent = Math.abs(leadM) < 0.5 ? 'level' : `${leader} ${leader === 'you' ? 'lead' : 'leads'} by`;
    hudLeadEl.textContent = Math.abs(leadM) < 0.5 ? '' : `${Math.abs(leadM).toFixed(0)} m`;

    // Boat-relative: the wind by where it comes from, the current by where it sets toward.
    const { wind_direction_rad, current_direction_rad } = duel.conditions;
    hudWindEl.textContent = `${windKt()} kt from ${bearingSector(compassRotationDeg(wind_direction_rad, psi) + 180)}`;
    hudCurrentEl.textContent = `${currentKt()} kt toward ${bearingSector(compassRotationDeg(current_direction_rad, psi))}`;

    // Positive heading error is bow to port of the course, so the marker moves left.
    hudOffCourseEl.textContent = Math.abs(blueErr).toFixed(0);
    const offCourse = Math.max(-1, Math.min(1, blueErr / OFF_COURSE_BAR_DEG));
    offCourseMarkerEl.style.left = `${50 - offCourse * 50}%`;

    // Play shows the stroke you have selected (it fires next); Watch shows the agent's last one.
    if (mode === 'play') showStroke(control.side, control.strokeType);
    else if (blueAction !== undefined) {
      const { side: s, strokeType: st } = decodeAction(blueAction);
      showStroke(s, st);
    }
  }
  requestAnimationFrame(frame);
});
