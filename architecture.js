import {voxelizeCurve} from './vascular-geometry.js';
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
  const cellSize=.38, rowSpacing=cellSize*Math.sqrt(3)/2;
  const row=Math.round((y+.025)/rowSpacing);
  const columnShift=(Math.abs(row)%2)*.5;
  const cx=(Math.round((x+.02)/cellSize-columnShift)+columnShift)*cellSize-.02;
  const cy=row*rowSpacing-.025;
  const r=Math.hypot(x-cx,y-cy);
  // Lobules form columns in Z: central veins are longitudinal channels and
  // portal triads occupy the outer hexagonal lattice between lobules.
  if(depth<.046){zone=ZONE.CAPSULE;density=.85;demand=.12;resistance=4.2;supply=.05;drain=.05;}
  else if(r<.070){zone=ZONE.CENTRAL_VEIN;density=.53;demand=.69;resistance=.68;supply=.25;drain=3.6;}
  else if(r>.16){zone=ZONE.PORTAL;density=.78;demand=.68;resistance=.73;supply=3.6;drain=.25;}
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
 // Functional destinations are not proportional only to volume: a hepatic
 // central vein occupies little tissue but must receive the lobule's drainage.
 // Zonal budgets therefore encode the known direction of organ blood flow.
 const quotas={
  kidney:{
   3:{2:.62,3:.18,4:.20},4:{2:.52,3:.22,4:.26}
  },
  liver:{
   3:{5:.25,6:.72,7:.03},4:{5:.30,6:.03,7:.67}
  },
  lung:{
   3:{8:.02,9:.54,10:.44},4:{8:.20,9:.10,10:.70}
  },
  heart:{
   3:{11:.32,12:.65,13:.03},4:{11:.46,12:.50,13:.04}
  },
  organic:{
   3:{14:.72,15:.02,16:.26},4:{14:.62,15:.04,16:.34}
  }
 };
 const budget=quotas[model.settings.organ]?.[type]||{};
 const groups=[...zones.entries()].sort((a,b)=>b[1].weight-a[1].weight);
 const minDistanceSquared=type===3?40:42;
 // Allocate quotas in proportion to total zonal metabolic work.
 for(let [layer,group] of groups){
  const quota=Math.max(1,Math.round(count*(budget[layer]??group.weight/Math.max(1,total))));
  group.candidates.sort((a,b)=>b.importance-a.importance);
  let chosen=0;
  for(let candidate of group.candidates){
   if(chosen>=quota)break;
   const separation=(layer===ZONE.CENTRAL_VEIN||layer===ZONE.PORTAL)?22:minDistanceSquared;
   if(selected.some(p=>sq(p.x-candidate.x)+sq(p.y-candidate.y)+sq(p.z-candidate.z)<separation))continue;
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
// A smooth voxel centerline must use edge/corner moves as well as face moves.
// Dijkstra expands all 26 directions, weighted by Euclidean length and local
// tissue cost. A diagonal candidate is valid ONLY when its corner crossing can
// be resolved to face-adjacent intermediate fluid voxels. Thus both the path
// and its simulated flow remain fully connected.
const directions26=[];
for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
 if(!(x||y||z))continue;
 const count=Math.abs(x)+Math.abs(y)+Math.abs(z);
 directions26.push({x,y,z,count,len:Math.sqrt(count)});
}
const orders3=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function legal(model,type,i){
 const m=model.matter[i];
 return m===1||m===2||m===type;
}
// Only a physical face-linked staircase is added where a diagonal segment
// crosses the grid. The 3D centerline itself is not limited to axis directions.
function faceConnector(model,type,from,to){
 const [x,y,z]=model.xyz(from),[tx,ty,tz]=model.xyz(to);
 const dx=tx-x,dy=ty-y,dz=tz-z;
 if(Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))!==1)return null;
 const axes=[];
 if(dx)axes.push([dx,0,0]);
 if(dy)axes.push([0,dy,0]);
 if(dz)axes.push([0,0,dz]);
 if(axes.length===1)return [];
 const permutations=axes.length===2?[[0,1],[1,0]]:orders3;
 let best=null,lowest=Infinity;
 for(const order of permutations){
  let cx=x,cy=y,cz=z,cost=0,bridge=[],valid=true;
  for(let k=0;k<axes.length-1;k++){
   const a=axes[order[k]];cx+=a[0];cy+=a[1];cz+=a[2];
   if(!model.inside(cx,cy,cz)){valid=false;break;}
   const index=model.index(cx,cy,cz);
   if(!legal(model,type,index)){valid=false;break;}
   bridge.push(index);
   cost+=model.matter[index]===type?.05:1+model.resistance[index]*.30;
  }
  if(valid&&cost<lowest){best=bridge;lowest=cost;}
 }
 return best;
}
export function routeInMatter(model,type,target){
 if(model.matter[target]===type)return [];
 const SIZE=model.size,N=model.N;
 if(!model.routingScratch)model.routingScratch={
  cost:new Float32Array(SIZE),parent:new Int32Array(SIZE),
  seen:new Uint32Array(SIZE),closed:new Uint32Array(SIZE),stamp:0
 };
 const state=model.routingScratch;
 state.stamp++;
 if(state.stamp===4294967295){state.stamp=1;state.seen.fill(0);state.closed.fill(0);}
 const stamp=state.stamp,g=state.cost,parent=state.parent,
  seen=state.seen,closed=state.closed;
 const open=new BinaryHeap();
 seen[target]=stamp;g[target]=0;parent[target]=-1;open.push(target,0);
 let found=-1,steps=0;
 while(open.length&&steps++<140000){
  const item=open.pop(),i=item.node;
  if(closed[i]===stamp)continue;
  closed[i]=stamp;
  if(model.matter[i]===type){found=i;break;}
  const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/(N*N));
  if(!model.inside(x,y,z))continue;
  const previous=parent[i];
  const pdx=previous<0?0:Math.sign(i%N-previous%N);
  const pdy=previous<0?0:Math.sign(Math.floor(i/N)%N-Math.floor(previous/N)%N);
  const pdz=previous<0?0:Math.sign(Math.floor(i/(N*N))-Math.floor(previous/(N*N)));
  for(const d of directions26){
   const xx=x+d.x,yy=y+d.y,zz=z+d.z;
   if(!model.inside(xx,yy,zz))continue;
   const j=model.index(xx,yy,zz);
   if(closed[j]===stamp||!legal(model,type,j))continue;
   // A corner-only touch is not a physical lumen connection.
   // Evaluate all valid one- or two-voxel connectors before allowing it.
   const bridge=d.count===1?[]:faceConnector(model,type,i,j);
   if(!bridge)continue;
   const existing=model.matter[j]===type;
   const affinity=type===3?model.supplyAffinity[j]:model.drainAffinity[j];
   const matrix=existing?.09:1+model.resistance[j]*.34+
     .07/(.5+Math.max(.1,affinity));
   // A small curvature penalty favors prolonged diagonal directions
   // over jagged alternating grid-aligned bends.
   const turn=previous<0?0:(pdx!==d.x||pdy!==d.y||pdz!==d.z?.11:0);
   const bridgePenalty=bridge.reduce((v,k)=>v+(model.matter[k]===type?.004:.018*model.resistance[k]),0);
   const proposed=g[i]+d.len*matrix+turn+bridgePenalty;
   if(seen[j]===stamp&&proposed>=g[j])continue;
   seen[j]=stamp;parent[j]=i;g[j]=proposed;open.push(j,proposed);
  }
 }
 if(found<0)return null;
 const path=[found];let i=found,guard=0;
 while(i!==target&&guard++<SIZE){i=parent[i];if(i<0)return null;path.push(i);}
 return i===target?path:null;
}
export function countRouteDirections(model,path){
 let diagonal=0,axis=0;
 for(let k=1;k<path.length;k++){
  const a=model.xyz(path[k-1]),b=model.xyz(path[k]);
  const d=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
  if(d>1)diagonal++;
  else if(d===1)axis++;
 }
 return {diagonal,axis};
}

// Use the resistance-aware guide only to choose circulation destinations.
// The actual spatial vessel is a curved 3D voxel field, not a stair-step
// polyline of filled grid edges.
export function integrateVesselRoute(model,type,target){
 const path=routeInMatter(model,type,target);
 if(!path||path.length<2)return false;
 const counts=countRouteDirections(model,path);
 const result=voxelizeCurve(model,type,path,{
  radius:(t)=>1.02+Math.sin(t*Math.PI)*.09,
  register:true,
  work:model.demand[target]*(type===3?model.supplyAffinity[target]:model.drainAffinity[target]),
  strength:1.25
 });
 if(result.newVoxels){
  // Meaningful direction statistics now refer to consecutive guided points,
  // while curveStats explicitly capture 3D bend and length.
  if(type===4)model.diagonalVeinSteps+=counts.diagonal;
  else model.diagonalArterySteps+=counts.diagonal;
  if(!model.branchRouteStats)model.branchRouteStats={3:{diagonal:0,axis:0},4:{diagonal:0,axis:0}};
  model.branchRouteStats[type].diagonal+=counts.diagonal;
  model.branchRouteStats[type].axis+=counts.axis;
 }
 return result.newVoxels>0;
}
