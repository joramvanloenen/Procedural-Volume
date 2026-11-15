// Anatomical zonation and demand-guided 3D vascular layout.
// Educational organ-specific templates, not clinical reconstructions.
//
// A single layer class is recorded for each *tissue voxel*. Structural
// layers control density, consumption, vessel routing resistance, and location
// of supplying / draining branches. Nothing here renders surface-only geometry.
export const ZONE = Object.freeze({
  VOID:0, CAPSULE:1, CORTEX:2, MEDULLA:3, RENAL_COLUMN:4,
  HEPATOCYTES:5, PORTAL:6, CENTRAL_VEIN:7, PLEURA:8, AIRWAY:9,
  ALVEOLI:10, EPICARDIUM:11, MYOCARDIUM:12, ENDOCARDIUM:13,
  PROLIFERATING:14, NECROTIC:15, MATRIX:16
});
export const ORGAN_LAYERS={
 kidney:[['Capsule',1],['Cortex',2],['Medullary pyramids',3],['Renal columns',4]],
 liver:[['Capsule',1],['Hepatic lobules',5],['Portal territories',6],['Central-venous territories',7]],
 lung:[['Pleura',8],['Bronchial connective tissue',9],['Alveolar parenchyma',10]],
 heart:[['Epicardium',11],['Myocardium',12],['Endocardium',13]],
 organic:[['Outer proliferating shell',14],['Low-oxygen core',15],['Interstitial matrix',16]]
};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const sq=x=>x*x;
const stepDirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const cell=(x,y,z)=>x+y*64+z*4096;

// Return the architecture independently of growth so every cell has purpose.
// depth is distance *inside* the organ isosurface, from the shape SDF.
export function tissueProfile(organ,x,y,z,depth,noise){
 let zone, density=.65,demand=.8,resistance=1, supply=1,drain=1;
 if(organ==='kidney'){
  const angular=Math.cos(Math.atan2(z,x+.10)*7.0 +y*.55);
  if(depth<.055){zone=ZONE.CAPSULE;density=.83;demand=.16;resistance=5.5;supply=.05;drain=.05;}
  else if(depth<.245){zone=ZONE.CORTEX;density=.74;demand=1.22;resistance=1.50;supply=2.5;drain=2.2;}
  else if(angular>.05){zone=ZONE.MEDULLA;density=.45;demand=.55;resistance=.78;supply=.73;drain=.82;}
  else {zone=ZONE.RENAL_COLUMN;density=.67;demand=.90;resistance=.82;supply=1.42;drain=1.45;}
 }else if(organ==='liver'){
  // Staggered lobular territories with a central venous core and peripheral
  // portal territories. At 64^3 this is a mesoscopic, not cellular, lobule.
  const cellSize=.34;
  const cx=Math.round((x+.06)/cellSize)*cellSize-.06;
  const cy=Math.round((y-.04)/cellSize)*cellSize+.04;
  const cz=Math.round((z+.02)/cellSize)*cellSize-.02;
  const r=Math.hypot(x-cx,y-cy,(z-cz)*.93);
  if(depth<.046){zone=ZONE.CAPSULE;density=.85;demand=.12;resistance=4.2;supply=.05;drain=.05;}
  else if(r<.070){zone=ZONE.CENTRAL_VEIN;density=.53;demand=.69;resistance=.68;supply=.25;drain=3.6;}
  else if(r>.215){zone=ZONE.PORTAL;density=.78;demand=.68;resistance=.73;supply=3.6;drain=.25;}
  else{zone=ZONE.HEPATOCYTES;density=.70;demand=1.05;resistance=1.18;supply=1.25;drain=1.25;}
 }else if(organ==='lung'){
  // Bronchovascular bundles near conducting airways, low-density alveolar
  // tissue farther out; venous collection favors intersegmental margins.
  let left=Math.abs(x)-.36;
  let airway=Math.hypot(left*.87,z*.9)-(.090+.015*Math.sin(y*9));
  if(depth<.055){zone=ZONE.PLEURA;density=.80;demand=.14;resistance=4.8;supply=.17;drain=1.9;}
  else if(airway<.12){zone=ZONE.AIRWAY;density=.54;demand=.42;resistance=.76;supply=2.7;drain=.42;}
  else {zone=ZONE.ALVEOLI;density=.38;demand=1.12;resistance=.92;supply=1.4;drain=1.45;}
 }else if(organ==='heart'){
  if(depth<.09){zone=ZONE.EPICARDIUM;density=.75;demand=.55;resistance=.85;supply=2.8;drain=3.1;}
  else if(depth>.48){zone=ZONE.ENDOCARDIUM;density=.69;demand=.58;resistance=1.6;supply=.38;drain=.40;}
  else{zone=ZONE.MYOCARDIUM;density=.89;demand=1.4;resistance=1.68;supply=1.7;drain=1.25;}
 }else{
  if(depth<.12){zone=ZONE.PROLIFERATING;density=.75;demand=1.38;resistance=1.25;supply=2.6;drain=2.4;}
  else if(depth>.43){zone=ZONE.NECROTIC;density=.48;demand=.17;resistance=2.5;supply=.32;drain=.42;}
  else{zone=ZONE.MATRIX;density=.62;demand=.90;resistance=1.1;supply=1.4;drain=1.6;}
 }
 const variation=(noise||0)*.075;
 return {
  zone,
  density:clamp(density+variation,.13,.97),
  demand:clamp(demand*(1+variation*.5),.10,1.7),
  resistance:clamp(resistance*(1+variation*.3),.30,6),
  supply,drain
 };
}

export function applyArchitecture(model){
 const N=model.N,L=model.layers=new Uint8Array(model.size);
 const resistance=model.resistance=new Float32Array(model.size);
 const supply=model.supplyAffinity=new Float32Array(model.size);
 const drain=model.drainAffinity=new Float32Array(model.size);
 model.zoneLabels=ORGAN_LAYERS[model.settings.organ]||ORGAN_LAYERS.organic;
 model.layerPopulation={};model.layerDemand={};
 const h=model.settings.heterogeneity/100;
 for(let z=1;z<N-1;z++)for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){
  const i=model.index(x,y,z);
  if(!model.matter[i])continue;
  const u=x/(N-1)*2-1,v=y/(N-1)*2-1,w=z/(N-1)*2-1;
  const depth=model.depth[i],n=model.noise(u*9+6,v*9+8,w*9+1);
  const info=tissueProfile(model.settings.organ,u,v,w,depth,n*h);
  const d=clamp(info.density+(model.density[i]-.62)*(.18+.20*h),.12,.98);
  model.density[i]=d;
  model.demand[i]=info.demand*clamp(.80+.25*d+.12*n*h,.60,1.18);
  resistance[i]=info.resistance*(.78+.55*d*d);
  supply[i]=info.supply;
  drain[i]=info.drain;
  L[i]=info.zone;
  model.matter[i]=d>.69?2:1;
  model.layerPopulation[info.zone]=(model.layerPopulation[info.zone]||0)+1;
  model.layerDemand[info.zone]=(model.layerDemand[info.zone]||0)+model.demand[i];
 }
 model.layerNames=model.zoneLabels.map(([name])=>name);
}

// Select transport destinations by functional tissue zones. Unlike random
// sprouting, target quotas are proportional to tissue metabolic demand and
// separately weighted by artery (supply) and vein (drainage) affinity.
export function buildRegionalTargets(model,type,count){
 const affinity=type===3?model.supplyAffinity:model.drainAffinity;
 const zones=new Map(),N=model.N;
 for(let z=3;z<N-3;z+=3)for(let y=3;y<N-3;y+=3)for(let x=3;x<N-3;x+=3){
  const i=model.index(x,y,z);
  if(model.matter[i]!==1&&model.matter[i]!==2)continue;
  const layer=model.layers[i],a=affinity[i];
  if(a<.3)continue;
  const demand=model.demand[i],density=model.density[i],hardness=model.resistance[i];
  const importance=demand*a/(.7+hardness*.11);
  const candidate={i,x,y,z,layer,importance};
  let group=zones.get(layer);
  if(!group){group={candidates:[],weight:0};zones.set(layer,group)}
  group.candidates.push(candidate);
  group.weight+=importance;
 }
 let total=0;for(let group of zones.values())total+=group.weight;
 let selected=[],assigned=new Map();
 const groups=[...zones.entries()].sort((a,b)=>b[1].weight-a[1].weight);
 const minDistanceSquared=type===3?40:42;
 // Allocate quotas in proportion to total zonal metabolic work.
 for(let [layer,group] of groups){
  const quota=Math.max(2,Math.round(count*group.weight/Math.max(1,total)));
  group.candidates.sort((a,b)=>b.importance-a.importance);
  let chosen=0;
  for(let candidate of group.candidates){
   if(chosen>=quota)break;
   if(selected.some(p=>sq(p.x-candidate.x)+sq(p.y-candidate.y)+sq(p.z-candidate.z)<minDistanceSquared))continue;
   selected.push(candidate);chosen++;
  }
  assigned.set(layer,chosen);
 }
 // Refill any spare budget with the highest unmet zonal demand.
 let remaining=[...zones.values()].flatMap(g=>g.candidates);
 remaining.sort((a,b)=>b.importance-a.importance);
 for(let candidate of remaining){
  if(selected.length>=count)break;
  if(selected.some(p=>sq(p.x-candidate.x)+sq(p.y-candidate.y)+sq(p.z-candidate.z)<minDistanceSquared))continue;
  selected.push(candidate);
 }
 // Early trajectories establish long regional trunks before finer feeders.
 const center=N*.5;
 selected.sort((a,b)=>{
  const wa=a.importance,wb=b.importance;
  const da=Math.hypot(a.x-center,a.y-center,a.z-center);
  const db=Math.hypot(b.x-center,b.y-center,b.z-center);
  return .55*db+.8*wb-(.55*da+.8*wa);
 });
 return selected.slice(0,count);
}

// 3D A* over shared-face voxels. The cost field is resistance of tissue and
// distance; capsule / high-density organ layers discourage shortcuts.
// Existing same-kind vessel voxels have a low merge cost, while other vessel
// types and exterior voids are excluded.
class BinaryHeap{
 constructor(){this.data=[]}
 push(node,score){const a=this.data;let i=a.length;a.push({node,score});while(i>0){let j=(i-1)>>1;if(a[j].score<=score)break;a[i]=a[j];i=j}a[i]={node,score}}
 pop(){const a=this.data,top=a[0],last=a.pop();if(!a.length)return top;let i=0;
  while((i*2+1)<a.length){let j=i*2+1,r=j+1;if(r<a.length&&a[r].score<a[j].score)j=r;if(last.score<=a[j].score)break;a[i]=a[j];i=j}a[i]=last;return top}
 get length(){return this.data.length}
}
// Multi-source, weighted Dijkstra: connect a target to the *lowest cost* node
// of the entire existing vascular tree, not an arbitrarily chosen nearest node.
// Pre-existing vessels are absorbing terminals; no free-floating branch can occur.
// Per-voxel traversing cost includes actual matrix density / layer resistance.
export function routeInMatter(model,type,target){
 if(model.matter[target]===type)return [];
 const SIZE=model.size,N=model.N;
 if(!model.routingScratch)model.routingScratch={
  cost:new Float32Array(SIZE),parent:new Int32Array(SIZE),
  seen:new Uint32Array(SIZE),closed:new Uint32Array(SIZE),stamp:0
 };
 const state=model.routingScratch;
 state.stamp++;
 if(state.stamp===4294967295){
  state.stamp=1;state.seen.fill(0);state.closed.fill(0);
 }
 const stamp=state.stamp,g=state.cost,parent=state.parent,
  seen=state.seen,closed=state.closed;
 const open=new BinaryHeap();
 seen[target]=stamp;g[target]=0;parent[target]=-1;open.push(target,0);
 let found=-1,steps=0;
 while(open.length&&steps++<100000){
  const item=open.pop(),i=item.node;
  if(closed[i]===stamp)continue;
  closed[i]=stamp;
  if(model.matter[i]===type){found=i;break;}
  const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/(N*N));
  if(!model.inside(x,y,z))continue;
  for(const d of stepDirs){
   const xx=x+d[0],yy=y+d[1],zz=z+d[2];
   if(!model.inside(xx,yy,zz))continue;
   const j=cell(xx,yy,zz),matter=model.matter[j];
   if(!matter||matter===5||matter===6||matter===3&&type!==3||matter===4&&type!==4||closed[j]===stamp)continue;
   const previous=parent[i],lastDir=previous<0?0:
    (i-previous)===(j-i)?1:0;
   const matrixCost=matter===type?.08:
    1+model.resistance[j]*.35+(lastDir?0:.04)+
    .08/(.5+(type===3?model.supplyAffinity[j]:model.drainAffinity[j]));
   const proposed=g[i]+matrixCost;
   if(seen[j]===stamp&&proposed>=g[j])continue;
   seen[j]=stamp;parent[j]=i;g[j]=proposed;
   open.push(j,proposed);
  }
 }
 if(found<0)return null;
 let path=[found],i=found,guard=0;
 while(i!==target&&guard++<SIZE){
  i=parent[i];if(i<0)return null;path.push(i);
 }
 return i===target?path:null;
}

export function integrateVesselRoute(model,type,target){
 const path=routeInMatter(model,type,target);
 if(!path||!path.length)return false;
 const root=model.xyz(path[0]),end=model.xyz(target);
 let newly=0,parent=path[0],terminal=parent;
 for(let i of path){
  if(model.matter[i]===type){parent=i;terminal=i;continue;}
  if(model.setFluid(i,type)){
   model.vesselSites[type].push(i);
   model.branchParent[i]=parent;
   parent=i;terminal=i;newly++;
  }
 }
 if(newly)model.branchLoad[terminal]+=model.demand[target]*
   (type===3?model.supplyAffinity[target]:model.drainAffinity[target]);
 if(newly){
  const axes=+(Math.abs(root[0]-end[0])>2)+
   +(Math.abs(root[1]-end[1])>2)+
   +(Math.abs(root[2]-end[2])>2);
  if(axes>=2){
   if(type===4)model.diagonalVeinSteps++;
   else model.diagonalArterySteps++;
  }
 }
 return newly>0;
}
