/* ============================================================================
   DUSTLINE // Sector 7 — util.js
   Small shared helpers. No game state lives here; every module that needs
   a clamp, a random roll or a vector imports it from here instead of
   re-declaring its own copy.
   ========================================================================== */
import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const $ = (id) => document.getElementById(id);
export const fmtMoney = (n) => '$' + Math.round(n).toLocaleString('en-US');
export const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
