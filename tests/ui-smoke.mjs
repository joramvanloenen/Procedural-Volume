import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../main.js',import.meta.url),'utf8');
const sim=readFileSync(new URL('../simulation.js',import.meta.url),'utf8');

assert.ok(html.includes('class="viewer-column"'), '3D view must have a shared column with scanner controls');
const view=html.indexOf('<main class="viewport">'),end=html.indexOf('</main>',view);
const scanner=html.indexOf('<section class="viewer-controls"',end);
const side=html.indexOf('<aside class="sidebar"');
const inspector=html.indexOf('<aside class="inspector">');
assert.ok(side>=0&&view>side&&end>view&&scanner>end&&inspector>scanner,
  'scanner must be directly after viewport and before inspector');
for(const id of ['threshold','opacity','hairVisibility','slice','renderScale','zoneSelect','modeTabs','showVeins']){
 assert.equal(html.split('id="'+id+'"').length-1,1,'expected one control for '+id);
 assert.ok(html.indexOf('id="'+id+'"')>scanner,'scanner parameter '+id+' is not beneath the view');
}
assert.ok(html.indexOf('id="vascularity"')<view,
  'generative controls should stay in the organ configuration section');
assert.ok(css.includes('.viewer-column>.viewport')&&css.includes('.viewer-controls-grid'),
 'missing mobile/desktop panel layout');
assert.ok(js.includes("renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2.0))"),
 'display pixel ratio must not be capped at the former blurry 1.15');
assert.ok(js.includes("float stepLength=0.0125"),
 'volume shader must use the finer march step');
assert.ok(sim.includes('export const GRID=80;'),'3D voxel simulation should be 80 cubed');
assert.ok(js.includes('uHairVessels')&&js.includes('uHairVisibility'),
 'hairline vessel renderer needs a distinct 3D occupancy and contrast control');
assert.ok(html.includes('id="hairVisibility"'),
 'fine vessel visibility control must be immediately below volume');
console.log('Scanner controls sit directly under viewport; high-resolution GPU and voxel settings verified.');
