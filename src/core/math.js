// 彩虹海 modification: match the compact layout and observe motion preferences.
import * as THREE from "three";
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionPreference.matches;
motionPreference.addEventListener?.('change', event => { reducedMotion = event.matches; });
const mobile = () => globalThis.innerWidth <= 700 || globalThis.innerHeight <= 600;
let randomSeed = 20260906;
function random() {
  randomSeed = Math.imul(randomSeed, 1664525) + 1013904223 | 0;
  return (randomSeed >>> 0) / 4294967296;
}
function gaussian() {
  return Math.sqrt(-2 * Math.log(Math.max(1e-6, random()))) * Math.cos(TAU * random());
}
export {
  TAU,
  clamp,
  gaussian,
  mobile,
  random,
  reducedMotion,
  smooth
};
