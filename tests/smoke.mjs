import assert from 'node:assert/strict';
import {VolumeModel} from '../simulation.js';
const base={seed:38127,vascularity:72,heterogeneity:58,reach:65};
const organs=['kidney','liver','heart','lung','organic'];
for(const organ of organs){
  const m=new VolumeModel({...base,organ});
  assert.ok(m.livingVoxels>10000,organ+' missing tissue volume');
  assert.ok(m.attractors.length>100,organ+' missing metabolic attractors');
  for(let i=0;i<m.maxIterations+2&&!m.finished;i++)m.step();
  assert.equal(m.finished,true,organ+' growth did not terminate');
  assert.ok(m.bridges>=30,organ+' lacks capillary anastomosis');
  assert.equal(m.flowLoops,m.bridges-1,organ+' circulation is not connected as expected');
  assert.ok(m.coverage>=95,organ+' insufficient oxygen coverage: '+m.coverage.toFixed(1)+'%');
  assert.ok(m.edges.every(e=>Number.isFinite(e.flow)&&e.len>0),organ+' invalid flow');
  assert.ok(m.edges.some(e=>e.type==='capillary'&&Math.abs(e.flow)>1e-12),organ+' no capillary flow');
  // A true circulation must have a directed positive-pressure route
  // from the arterial inlet to the venous return, not just disconnected tubes.
  const source=m.roots.artery,sink=m.roots.vein;
  const seen=new Set([source]),queue=[source];
  for(let q=0;q<queue.length;q++){
    for(const link of m.nodes[queue[q]].out){
      if(!seen.has(link.to)){seen.add(link.to);queue.push(link.to)}
    }
  }
  assert.ok(seen.has(sink),organ+' missing directed source-to-sink path');
  assert.ok(m.bytes.some(v=>v>0),organ+' generated empty 3D texture');
  console.log(organ+': '+m.nodes.length+' nodes / '+m.bridges+' bridges / '+m.flowLoops+' loops / '+m.coverage.toFixed(1)+'% supplied');
}
console.log('All five volumetric morphogenesis tests passed.');
