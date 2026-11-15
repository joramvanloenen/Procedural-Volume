import {VolumeModel} from './simulation.js?v=hair-venules-20261115-r4';

// Heavy voxel growth, pressure solve and advection run off the rendering thread.
// Each update is a snapshot of 3D material/velocity/chemical textures.
let model=null,timer=null,playing=true,speed=2,generation=0,tickCount=0,lastVesselVersion=-1;
const state=()=>{
 const m=model;
 return {
  iteration:m.iteration,maxIterations:m.maxIterations,finished:m.finished,
  coverage:m.coverage,perfused:m.perfused,
  lumenCount:m.lumenCount,capillaryCount:m.capillaryCount,
  wallCount:m.wallCount,flowingVoxels:m.flowingVoxels,
  hairVenuleCount:m.hairVenuleCount,hairBranchCount:m.hairBranchCount,
  diagonalArterySteps:m.diagonalArterySteps,diagonalVeinSteps:m.diagonalVeinSteps,
  occupied:m.occupied,pressureIterations:m.pressureIterations||0,
  trunkVoxels:m.trunkVoxels,regionMetrics:m.layerMetrics(),
  arteryTargets:m.growthSuccess?.[3]||0,veinTargets:m.growthSuccess?.[4]||0
 };
};
function snapshot(){
 if(!model)return;
 model.updateTexture();
 const field=model.fieldBytes.slice(),material=model.materialBytes.slice(),flow=model.flowBytes.slice(),layers=model.layerBytes.slice();
 const changed=model.smoothedVersion!==lastVesselVersion;
 const vessel=changed?model.smoothVesselBytes.slice():null;
 const hair=changed?model.hairVoxels.slice():null;
 if(changed)lastVesselVersion=model.smoothedVersion;
 const transfers=[field.buffer,material.buffer,flow.buffer,layers.buffer];
 if(vessel)transfers.push(vessel.buffer);
 if(hair)transfers.push(hair.buffer);
 postMessage({kind:'snapshot',stats:state(),field,material,flow,layers,vessel,hair},transfers);
}
function halt(){if(timer)clearInterval(timer);timer=null;model=null;}
function start(settings){
 halt();generation++;tickCount=0;lastVesselVersion=-1;speed=settings.speed||2;playing=true;
 try{
  model=new VolumeModel(settings);
  snapshot();
  const run=generation;
  timer=setInterval(()=>{
   if(!model||!playing||run!==generation)return;
   if(!model.finished){
    const steps=Math.max(1,Math.round(speed*1.1));
    for(let i=0;i<steps&&!model.finished;i++){
     if(model.iteration===model.maxIterations-1)postMessage({kind:'phase',text:'Connecting vascular voxels and solving fluid pressure'});
     model.step();
    }
    tickCount++;
    if(tickCount%2===0||model.finished)snapshot();
   }else{
    model.advanceFluid(Math.max(1/30,Math.min(.12,speed/24)));
    tickCount++;
    if(tickCount%1===0)snapshot();
   }
  },85);
 }catch(e){postMessage({kind:'error',message:String(e&&e.message||e)})}
}
self.onmessage=({data})=>{
 if(data.kind==='start'){start(data.settings);return;}
 if(data.kind==='pause'){playing=Boolean(data.playing);return;}
 if(data.kind==='speed'){speed=data.speed;return;}
 if(data.kind==='viscosity'&&model){model.settings.viscosity=data.value;return;}
 if(data.kind==='reach'&&model){
  model.settings.reach=data.value;
  model.recomputeCoverage(true);snapshot();
  return;
 }
};
