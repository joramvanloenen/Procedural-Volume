import assert from 'node:assert/strict';
import {VolumeModel, GRID, MAT} from '../simulation.js';
import {ZONE, ORGAN_LAYERS} from '../architecture.js';

const base={seed:38127,vascularity:72,heterogeneity:58,reach:65,viscosity:40};
const neighbors=[1,-1,GRID,-GRID,GRID*GRID,-GRID*GRID];
const organs=['kidney','liver','heart','lung','organic'];

for(const organ of organs){
 const start=Date.now();
 const m=new VolumeModel({...base,organ});
 assert.ok(m.occupied>10000,organ+' tissue volume empty');
 const profile=ORGAN_LAYERS[organ];
 assert.ok(profile.length>=3,organ+' lacks anatomical layers');
 for(const [name,zone] of profile){
  assert.ok((m.layerPopulation[zone]||0)>30,
   organ+' is missing tissue compartment '+name);
 }
 assert.ok(m.growthPlan[3].length>=20&&m.growthPlan[4].length>=20,
   organ+' vascular supply/drainage blueprint is empty');
 if(organ==='kidney'){
  assert.ok(m.growthPlan[3].filter(t=>t.layer===ZONE.CORTEX).length>
            m.growthPlan[3].filter(t=>t.layer===ZONE.MEDULLA).length,
   'renal cortex must receive greater arterial priority than the medulla');
 }
 if(organ==='liver'){
  assert.ok(m.growthPlan[3].filter(t=>t.layer===ZONE.PORTAL).length>
            m.growthPlan[3].filter(t=>t.layer===ZONE.CENTRAL_VEIN).length,
   'hepatic inlet must preferentially serve portal territories');
  assert.ok(m.growthPlan[4].filter(t=>t.layer===ZONE.CENTRAL_VEIN).length>
            m.growthPlan[4].filter(t=>t.layer===ZONE.PORTAL).length,
   'hepatic return must preferentially drain central venous territories');
 }
 if(organ==='heart'){
  assert.ok(m.growthPlan[3].some(t=>t.layer===ZONE.EPICARDIUM),
   'coronary arterial plan must include surface vessels');
  assert.ok(m.growthPlan[3].some(t=>t.layer===ZONE.MYOCARDIUM),
   'coronary arterial plan must penetrate myocardial tissue');
 }
 if(organ==='lung'){
  assert.ok(m.growthPlan[3].some(t=>t.layer===ZONE.AIRWAY),
   'pulmonary arteries should track bronchovascular tissue');
  assert.ok(m.growthPlan[4].some(t=>t.layer===ZONE.PLEURA),
   'pulmonary venous return should reach intersegmental/peripheral regions');
 }

 let tissue=0;for(const v of m.matter)if(v===MAT.TISSUE||v===MAT.DENSE)tissue++;
 assert.ok(tissue>10000,organ+' lacked cellular matter');
 for(let step=0;step<100&&!m.finished;step++)m.step();
 assert.ok(m.finished,organ+' growth did not finish');
 assert.ok((m.growthSuccess[3]||0)>m.growthPlan[3].length*.55,
   organ+' arterial regions not connected to the inlet');
 assert.ok((m.growthSuccess[4]||0)>m.growthPlan[4].length*.55,
   organ+' venous regions not connected to drainage');
 const metrics=m.layerMetrics();
 assert.equal(metrics.length,profile.length,organ+' missing per-layer perfusion metrics');
 assert.ok(metrics.every(v=>Number.isFinite(v.coverage)&&v.coverage>=0&&v.coverage<=100),
   organ+' invalid regional oxygen coverages');
 assert.ok(metrics.some(v=>v.lumen>0),organ+' vasculature not assigned to anatomical layers');

 assert.ok(m.diagonalVeinSteps>8,organ+' venous growth regressed to axis-only directions');
 assert.ok(m.diagonalArterySteps>8,organ+' arterial growth regressed to axis-only directions');
 assert.ok(m.lumenCount>400,organ+' lacked lumen voxels');
 assert.ok(m.capillaryCount>100,organ+' lacked capillary voxels');
 assert.ok(m.wallCount>0,organ+' lacks voxel encapsulating vessel walls');
 assert.ok(m.coverage>70,organ+' nutrient exchange does not cover enough tissue: '+m.coverage);
 assert.ok(m.flowingVoxels>0&&m.flowRate>0,organ+' fluid did not move');
 // Fluid connections are voxel neighborhood links, never graph/tube edges.
 const visited=new Set([m.inlet]),queue=[m.inlet];
 for(let k=0;k<queue.length;k++){
  const i=queue[k],xyz=m.xyz(i);
  for(let d=0;d<6;d++){
   const n=neighbors[d],j=i+n;
   if(!m.inside(...xyz)||j<0||j>=m.size||!m.isFluid(j)||visited.has(j))continue;
   visited.add(j);queue.push(j);
  }
 }
 assert.ok(visited.has(m.outlet),organ+' outlet not connected to inlet in voxel space');
 assert.equal(visited.size,m.lumenCount,organ+' isolated fluid voxels exist');
 // Verify incompressibility: the per-voxel face-flux divergence is ~0
 // except at the fixed-pressure inlet and outlet.
 let source=0,sink=0,residual=0;
 for(let i=0;i<m.size;i++){
  if(!m.isFluid(i))continue;
  const d=m.faceX[i]+m.faceY[i]+m.faceZ[i]-
    (i>0?m.faceX[i-1]:0)-
    (i>=GRID?m.faceY[i-GRID]:0)-
    (i>=GRID*GRID?m.faceZ[i-GRID*GRID]:0);
  if(i===m.inlet)source=d;
  else if(i===m.outlet)sink=d;
  else residual=Math.max(residual,Math.abs(d));
 }
 assert.ok(Math.abs(source)>0.00001,organ+' has no source flow');
 assert.ok(Math.abs((source+sink)/source)<.002,organ+' fluid mass not conserved at inlet / outlet');
 assert.ok(residual<.0001,organ+' interior fluid divergence too high');
 const before=m.oxygen.slice();
 for(let i=0;i<8;i++)m.advanceFluid(1/30);
 assert.ok(m.dye[m.inlet]>0,organ+' flow dye injection failed');
 let outsideDye=0,movedDye=0,exchange=0;
 for(let i=0;i<m.size;i++){
  if(!m.isFluid(i))outsideDye+=m.dye[i];
  else if(i!==m.inlet)movedDye+=m.dye[i];
  if(m.matter[i]&&!m.isFluid(i)&&Math.abs(m.oxygen[i]-before[i])>1e-6)exchange++;
 }
 assert.equal(outsideDye,0,organ+' dye leaked through tissue');
 assert.ok(movedDye>0,organ+' scalar dye did not advect to another fluid voxel');
 assert.ok(exchange>0,organ+' tissue oxygen did not update by neighboring diffusion');
 console.log(organ+': '+m.lumenCount+' lumen voxels, '+m.capillaryCount+
  ' capillary voxels, '+m.wallCount+' encapsulating walls; '+m.coverage.toFixed(1)+
  '% tissue supplied; pressure iterations '+m.pressureIterations+
  ', mass conserved (+'+source.toFixed(5)+' / '+sink.toFixed(5)+'), '+
  ((Date.now()-start)/1000).toFixed(1)+'s');
}
console.log('All voxel-only perfusion and fluid-transport tests passed.');
