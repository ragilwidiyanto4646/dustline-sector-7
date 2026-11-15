/* ============================================================================
   DUSTLINE // Sector 7 — textures.js
   Procedural textures and text sprites: every surface in the yard is drawn
   on a canvas at boot, so the game ships no image files. One module, one job.
   ========================================================================== */
import * as THREE from 'three';
import { pick, rand } from './util.js';

export function canvasTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}
function speckle(ctx, s, n, colors, rMin = 1, rMax = 3) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = pick(colors);
    ctx.globalAlpha = rand(0.15, 0.55);
    ctx.beginPath(); ctx.arc(rand(0, s), rand(0, s), rand(rMin, rMax), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
export const TEX = {};
export function buildTextures() {
  TEX.sand = canvasTexture(256, (x, s) => {
    x.fillStyle = '#c2a06b'; x.fillRect(0, 0, s, s);
    speckle(x, s, 2200, ['#b28e58', '#d4b47e', '#a37f4e', '#cbb184']);
    x.strokeStyle = 'rgba(90,70,40,.25)';
    for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(rand(0, s), rand(0, s)); x.lineTo(rand(0, s), rand(0, s)); x.stroke(); }
  }, [24, 18]);
  TEX.concrete = canvasTexture(256, (x, s) => {
    x.fillStyle = '#9a958c'; x.fillRect(0, 0, s, s);
    speckle(x, s, 1800, ['#8a857c', '#aaa59c', '#7d7870']);
    x.strokeStyle = 'rgba(60,58,52,.35)'; x.lineWidth = 2;
    x.strokeRect(1, 1, s - 2, s - 2);
    x.beginPath(); x.moveTo(0, s / 2); x.lineTo(s, s / 2); x.stroke();
  }, [6, 3]);
  TEX.metal = canvasTexture(256, (x, s) => {
    x.fillStyle = '#7e6f5a'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.07)'; x.fillRect(0, i * 22, s, 10); }
    speckle(x, s, 500, ['#6b5d4b', '#8d7d66', '#5d4f3f']);
    x.fillStyle = 'rgba(40,30,20,.5)'; x.fillRect(0, 0, s, 6); x.fillRect(0, s - 6, s, 6);
  }, [2, 1]);
  TEX.crate = canvasTexture(256, (x, s) => {
    x.fillStyle = '#8a6b3f'; x.fillRect(0, 0, s, s);
    x.strokeStyle = '#5d4526'; x.lineWidth = 10; x.strokeRect(5, 5, s - 10, s - 10);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(s, s); x.moveTo(s, 0); x.lineTo(0, s); x.stroke();
    speckle(x, s, 500, ['#7a5c34', '#9c7c4c']);
  });
  TEX.containerBlue = canvasTexture(256, (x, s) => {
    x.fillStyle = '#2f5d7d'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 16, 0, 6, s); }
    speckle(x, s, 400, ['#274f6b', '#3a6d8f', '#1e4258']);
  }, [2, 1]);
  TEX.containerRust = canvasTexture(256, (x, s) => {
    x.fillStyle = '#8a4a30'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 16; i++) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 16, 0, 6, s); }
    speckle(x, s, 700, ['#7a3f28', '#9c5a3a', '#5f3018']);
  }, [2, 1]);
  TEX.wallPaint = canvasTexture(256, (x, s) => {
    x.fillStyle = '#b8a888'; x.fillRect(0, 0, s, s);
    x.fillStyle = '#a30f0f'; x.fillRect(0, s * 0.62, s, s * 0.1);
    speckle(x, s, 900, ['#a89a78', '#c4b694']);
    x.fillStyle = 'rgba(40,32,20,.35)'; x.fillRect(0, s - 14, s, 14);
  }, [4, 1]);
}

export function makeTextSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.font = 'bold 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#000'; x.shadowBlur = 12; x.fillStyle = color;
  x.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(7, 1.75, 1); return sp;
}
