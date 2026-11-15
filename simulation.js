// Everything persistent is a voxel field. No procedural tube or vessel-edge meshes.
// Voxel classes: 0 void, 1 parenchyma, 2 dense tissue, 3 arterial fluid,
// 4 venous fluid, 5 capillary fluid, 6 encapsulating vessel wall.
// Tissue sprouts explore a 26-neighbor 3D neighborhood, with face-connected
// voxel bridges for diagonals; capillary paths use 3D distance fields. Flow is a conservative face-flux
// finite-volume pressure/transport model (not a full Navier-Stokes solver).
import {applyArchitecture,buildRegionalTargets,integrateVesselRoute,ZONE} from './architecture.js?v=scan-hires-20261115-r3';
import {DIRECTIONS_26,voxelizeCurve} from './vascular-geometry.js?v=scan-hires-20261115-r3';
export const GRID=80;
const N=GRID, N2=N*N, SIZE=N*N*N;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const sq=x=>x*x;
const step6=[1,-1,N,-N,N2,-N2];
// Growth may choose any of 26 3D directions; mass transport still occurs
// strictly across the six shared voxel faces to preserve a watertight lumen.
const growthDirs=[];
for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
 if(dx||dy||dz)growthDirs.push([dx,dy,dz]);
}
const routes3=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export const MAT={VOID:0,TISSUE:1,DENSE:2,ARTERY:3,VEIN:4,CAPILLARY:5,WALL:6};
function randomGenerator(seed){return()=>{let t=seed+=0x6d2b79f5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};}
export class VolumeModel{
 constructor(options={}){
  this.settings={organ:'kidney',seed:38127,vascularity:72,heterogeneity:58,reach:65,viscosity:40,...options};
  this.seed=+this.settings.seed||38127;
  this.random=randomGenerator(this.seed);
  this.N=N;this.size=SIZE;
  this.matter=new Uint8Array(SIZE);
  this.density=new Float32Array(SIZE);
  this.depth=new Float32Array(SIZE);
  this.layers=new Uint8Array(SIZE);
  this.layerBytes=new Uint8Array(SIZE);
  this.demand=new Float32Array(SIZE);
  this.oxygen=new Float32Array(SIZE);
  this.nutrient=new Float32Array(SIZE);
  this.bloodOxygen=new Float32Array(SIZE);
  this.dye=new Float32Array(SIZE);
  this.pressure=new Float32Array(SIZE);
  this.vx=new Float32Array(SIZE);
  this.vy=new Float32Array(SIZE);
  this.vz=new Float32Array(SIZE);
  this.faceX=new Float32Array(SIZE);
  this.faceY=new Float32Array(SIZE);
  this.faceZ=new Float32Array(SIZE);
  this.fieldBytes=new Uint8Array(SIZE*4);
  this.materialBytes=new Uint8Array(SIZE);
  this.flowBytes=new Uint8Array(SIZE*4);
  this.smoothVesselBytes=new Uint8Array(SIZE*4);
  this.geometryVersion=0;this.smoothedVersion=-1;
  this.occupied=0;this.lumenCount=0;this.capillaryCount=0;this.wallCount=0;
  this.inlet=-1;this.outlet=-1;this.tips=[];this.iteration=0;this.maxIterations=60;
  this.vesselSites={3:[],4:[]};this.growthPlan={3:[],4:[]};
  this.reservedVesselType=new Uint8Array(SIZE);
  this.branchParent=new Int32Array(SIZE);this.branchParent.fill(-1);
  this.branchLoad=new Float32Array(SIZE);this.trunkVoxels=0;
  this.diagonalVeinSteps=0;this.diagonalArterySteps=0;
  this.finished=false;this.coverage=0;this.perfused=0;this.flowingVoxels=0;this.flowRate=0;
  this.fluidTime=0;this.fluidClock=0;this.flowSolved=false;
  this.buildTissue();applyArchitecture(this);this.seedVessels();this.planVessels();this.updateTexture();
 }
 index(x,y,z){return x+y*N+z*N2}
 xyz(i){let z=Math.floor(i/N2),y=Math.floor((i-z*N2)/N);return [i-z*N2-y*N,y,z]}
 inside(x,y,z){return x>0&&x<N-1&&y>0&&y<N-1&&z>0&&z<N-1}
 isFluid(i){let t=this.matter[i];return t>=3&&t<=5}
 rand(){return this.random()}
 hash(x,y,z){let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,2147483647)+Math.imul(this.seed,1274126177);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967295}
 noise(x,y,z){
  const a=Math.floor(x),b=Math.floor(y),c=Math.floor(z),u=smooth(x-a),v=smooth(y-b),w=smooth(z-c);
  let f=(xi,yi,zi)=>this.hash(xi,yi,zi)*2-1;
  return mix(mix(mix(f(a,b,c),f(a+1,b,c),u),mix(f(a,b+1,c),f(a+1,b+1,c),u),v),
      mix(mix(f(a,b,c+1),f(a+1,b,c+1),u),mix(f(a,b+1,c+1),f(a+1,b+1,c+1),u),v),w);
 }
 morphology(x,y,z){
  const n=this.noise(x*3.1+13,y*3.1+7,z*3.1+3)*.07+this.noise(x*6.3+3,y*6.3+8,z*6.3+11)*.025;
  let s=this.settings.organ,core=0;
  if(s==='kidney'){
   let xx=x+.17*(1-y*y);
   core=1-Math.sqrt(sq(xx/.77)+sq(y/.92)+sq(z/.65));
   core-=.33*Math.exp(-(sq((x-.58)/.29)+sq(y/.34)+sq(z/.45)));
  }else if(s==='liver'){
   core=1-Math.sqrt(sq(x/.94)+sq((y+.14*x)/.67)+sq(z/(.69-.16*x)));
   core+=.08*Math.exp(-(sq((x+.44)/.37)+sq((y-.35)/.24)));
  }else if(s==='heart'){
   let taper=clamp(.75+.25*(y+.5),.46,1.13);
   core=1-Math.sqrt(sq(x/(.72*taper))+sq((y+.08)/.89)+sq(z/.68));
   core+=.2*Math.max(Math.exp(-(sq((x-.34)/.35)+sq((y-.45)/.4)+sq(z/.5))),Math.exp(-(sq((x+.34)/.35)+sq((y-.45)/.4)+sq(z/.5))));
  }else if(s==='lung'){
   let left=1-Math.sqrt(sq((x+.36)/.55)+sq((y+.01)/.95)+sq(z/.55));
   let right=1-Math.sqrt(sq((x-.36)/.55)+sq((y+.01)/.92)+sq(z/.55));
   let bridge=1-Math.sqrt(sq(x/.37)+sq((y+.33)/.32)+sq(z/.28));
   core=Math.max(left,right,bridge);
   core-=.09*Math.exp(-sq(x/.17))*clamp(y+.2,0,1);
  }else{
   core=1-Math.sqrt(sq(x/.81)+sq(y/.87)+sq(z/.75));
   core+=.11*Math.sin(x*7+y*3)*Math.cos(z*5);
  }
  return core+n;
 }
 buildTissue(){
  let het=this.settings.heterogeneity/100;
  for(let z=1;z<N-1;z++)for(let y=1;y<N-1;y++)for(let x=1;x<N-1;x++){
   let u=x/(N-1)*2-1,v=y/(N-1)*2-1,w=z/(N-1)*2-1;
   let edge=this.morphology(u,v,w);if(edge<=0)continue;
   let i=this.index(x,y,z);
   this.depth[i]=edge;
   let fbm=.55*this.noise(u*7+13,v*7+4,w*7+11)+.28*this.noise(u*15,v*15,w*15)+.17*this.noise(u*28,v*28,w*28);
   let cortex=.2*Math.exp(-sq((edge-.13)/.11));
   let d=.43+.23*smooth(clamp(edge*3.4,0,1))+cortex+fbm*(.13+.24*het);
   if(this.settings.organ==='kidney')d-=.14*Math.max(0,Math.sin(13*v+7*Math.atan2(w,u)))*(1-clamp(edge*1.8,0,1));
   if(this.settings.organ==='lung')d-=.12*Math.max(0,Math.sin(u*24+v*19+w*17));
   if(this.settings.organ==='heart')d+=.09*Math.sin(Math.atan2(v,u)*8+16*w);
   d*=smooth(clamp(edge*20,0,1))*.85+.15;
   d=clamp(d,.16,.98);
   this.density[i]=d;
   this.demand[i]=clamp(.40+.48*d+het*(.15*fbm+.08*this.noise(u*10+11,v*10,w*10)),.3,1);
   this.matter[i]=d>.69?MAT.DENSE:MAT.TISSUE;
   this.occupied++;
  }
 }
 nearestTissue(x,y,z){
  x=clamp(Math.round(x),2,N-3);y=clamp(Math.round(y),2,N-3);z=clamp(Math.round(z),2,N-3);
  if(this.matter[this.index(x,y,z)])return [x,y,z];
  let cx=Math.round(N/2),cy=Math.round(N/2),cz=Math.round(N/2);
  for(let k=1;k<26;k++){
   let a=k/26;let xx=Math.round(mix(x,cx,a)),yy=Math.round(mix(y,cy,a)),zz=Math.round(mix(z,cz,a));
   if(this.matter[this.index(xx,yy,zz)])return [xx,yy,zz];
  }
  return [cx,cy,cz];
 }
 setFluid(i,type){
  let before=this.matter[i];if(!before)return false;
  if(this.isFluid(i))return before===type;
  this.matter[i]=type;this.density[i]=type===MAT.CAPILLARY?.67:.79;
  this.geometryVersion++;
  this.lumenCount++;if(type===MAT.CAPILLARY)this.capillaryCount++;
  this.pressure[i]=type===MAT.ARTERY?.82:type===MAT.VEIN?.18:.50;
  this.bloodOxygen[i]=type===MAT.ARTERY?(this.settings.organ==='lung'?.53:1):type===MAT.VEIN?.70:.80;
  this.nutrient[i]=.85;
  this.oxygen[i]=.9;
  return true;
 }
 // Organ-dependent roots reflect the supply and drainage regions rather than
 // two universal vertical trunks. Each new branch grows into a regional target
 // and merges with the closest low-resistance section of its existing tree.
 seedVessels(){
  const profiles={
   kidney:[[.24,-.24,-.13],[.25,.17,.16]],
   liver:[[-.35,-.24,-.14],[.30,.23,.14]],
   heart:[[.25,.38,-.05],[-.24,.36,.12]],
   lung:[[-.13,-.33,-.07],[.13,-.33,.10]],
   organic:[[-.17,-.45,-.13],[.20,-.41,.16]]
  };
  const roots=profiles[this.settings.organ]||profiles.organic;
  const pick=p=>{
   const pos=p.map(v=>Math.round((v*.5+.5)*(N-1)));
   return this.nearestTissue(...pos);
  };
  const [ax,ay,az]=pick(roots[0]),[vx,vy,vz]=pick(roots[1]);
  this.inlet=this.index(ax,ay,az);
  this.outlet=this.index(vx,vy,vz);
  if(this.inlet===this.outlet){
   const pos=this.nearestTissue(vx+5,vy+4,vz+4);
   this.outlet=this.index(...pos);
  }
  this.setFluid(this.inlet,MAT.ARTERY);
  this.setFluid(this.outlet,MAT.VEIN);
  this.vesselSites[MAT.ARTERY].push(this.inlet);
  this.vesselSites[MAT.VEIN].push(this.outlet);
 }
 planVessels(){
  const count=Math.max(20,Math.round(28+this.settings.vascularity*.32));
  this.growthPlan[MAT.ARTERY]=buildRegionalTargets(this,MAT.ARTERY,count);
  this.growthPlan[MAT.VEIN]=buildRegionalTargets(this,MAT.VEIN,count);
  // Each branch network needs its own future perfusion destinations.
  // Without reservations arterial tube dilation can consume the venous
  // targets in dense myocardium, producing false perfusion and few veins.
  const reserved=this.reservedVesselType;
  for(const t of this.growthPlan[MAT.ARTERY])reserved[t.i]=MAT.ARTERY;
  const used=new Set();
  for(const target of this.growthPlan[MAT.VEIN]){
   if(reserved[target.i]===MAT.ARTERY||used.has(target.i)){
    const [x,y,z]=this.xyz(target.i);
    let best=-1,bestScore=-Infinity;
    for(let r=1;r<=4;r++){
     for(let dz=-r;dz<=r;dz++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy),Math.abs(dz))!==r)continue;
      const xx=x+dx,yy=y+dy,zz=z+dz;
      if(!this.inside(xx,yy,zz))continue;
      const i=this.index(xx,yy,zz);
      if(reserved[i]||used.has(i)||this.layers[i]!==target.layer)continue;
      if(this.matter[i]!==MAT.TISSUE&&this.matter[i]!==MAT.DENSE)continue;
      const cost=Math.hypot(dx,dy,dz);
      const score=this.drainAffinity[i]*this.demand[i]-
        this.resistance[i]*.17-cost*.3;
      if(score>bestScore){best=i;bestScore=score;}
     }
     if(best>=0)break;
    }
    if(best>=0){target.i=best;[target.x,target.y,target.z]=this.xyz(best);}
   }
   if(reserved[target.i]===MAT.ARTERY)continue;
   reserved[target.i]=MAT.VEIN;used.add(target.i);
  }
  this.maxIterations=Math.max(this.growthPlan[MAT.ARTERY].length,this.growthPlan[MAT.VEIN].length);
  this.maxIterations=Math.max(1,this.maxIterations);
  this.growthSuccess={3:0,4:0};
 }
 step(){
  if(this.finished)return false;
  for(const type of [MAT.ARTERY,MAT.VEIN]){
   const dest=this.growthPlan[type][this.iteration];
   if(dest&&integrateVesselRoute(this,type,dest.i))this.growthSuccess[type]++;
  }
  this.iteration++;
  if(this.iteration>=this.maxIterations)this.finish();
  return !this.finished;
 }
 // Multi-source 6-neighborhood flood distances. Nothing travels through air.
 distanceFrom(type){
  const dist=new Int16Array(SIZE);dist.fill(32767);
  const queue=new Int32Array(SIZE);let tail=0,head=0;
  for(let i=0;i<SIZE;i++){
   if(this.matter[i]===type){dist[i]=0;queue[tail++]=i}
  }
  while(head<tail){
   const i=queue[head++],d=dist[i]+1;
   let x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   if(x===0||x===N-1||y===0||y===N-1||z===0||z===N-1)continue;
   for(let k=0;k<6;k++){
    let j=i+step6[k];if(this.matter[j]===MAT.VOID||dist[j]<=d)continue;
    if(type===MAT.ARTERY&&this.matter[j]===MAT.VEIN)continue;
    if(type===MAT.VEIN&&this.matter[j]===MAT.ARTERY)continue;
    dist[j]=d;queue[tail++]=j;
   }
  }
  return dist;
 }
 // Find a smooth descending route over the 3D distance field, not an
 // axis-only Manhattan staircase. The 26-neighborhood is weighted by
 // geometric distance, tissue resistance, and tangent continuation.
 pathFrom(i,dist,targetType){
  if(dist[i]===32767)return null;
  let path=[i],current=i,previous=null,guard=0;
  while(dist[current]>0&&guard++<SIZE){
   let best=-1,score=-Infinity;
   const [x,y,z]=this.xyz(current),source=dist[current];
   if(!this.inside(x,y,z))return null;
   for(const d of DIRECTIONS_26){
    const nx=x+d.x,ny=y+d.y,nz=z+d.z;
    if(!this.inside(nx,ny,nz))continue;
    const j=this.index(nx,ny,nz),matter=this.matter[j];
    if(!matter||dist[j]>=source)continue;
    if((matter===MAT.ARTERY||matter===MAT.VEIN)&&matter!==targetType)continue;
    const progress=(source-dist[j])/d.length;
    let tangent=0;
    if(previous){
     const dx=x-previous[0],dy=y-previous[1],dz=z-previous[2];
     const l=Math.hypot(dx,dy,dz)||1;
     tangent=(dx*d.x+dy*d.y+dz*d.z)/(l*d.length);
    }
    const cost=(matter===targetType?.60:.13*this.resistance[j]);
    const value=progress+.20*tangent-cost;
    if(value>score){best=j;score=value;}
   }
   if(best<0)return null;
   previous=[x,y,z];current=best;path.push(current);
  }
  if(this.matter[current]!==targetType)return null;
  return path;
 }
 connectThrough(i,dA,dV){
  const a=this.pathFrom(i,dA,MAT.ARTERY),
    b=this.pathFrom(i,dV,MAT.VEIN);
  if(!a||!b||a.length+b.length>70)return false;
  // Convert independent curved guides into the same material lattice.
  // Each short arc joins the existing inlet/outlet tree by physical
  // fluid voxels; there is no hidden conduit or graph-edge flow.
  const artery=voxelizeCurve(this,MAT.CAPILLARY,a.reverse(),{
   radius:1.00,strength:.65
  });
  const vein=voxelizeCurve(this,MAT.CAPILLARY,b.reverse(),{
   radius:1.00,strength:.65
  });
  return artery.newVoxels+vein.newVoxels>0;
 }
 // Mature conducting trunks according to the metabolic work of downstream
 // branch territories. High-load parent channels become a little wider,
 // while fine terminal branches remain at single-voxel resolution.
 // This is the coarse voxel analogue of demand-dependent vessel caliber.
 matureTrunks(){
  const assigned=[];
  for(let type of [MAT.ARTERY,MAT.VEIN]){
   const sites=this.vesselSites[type];
   // Every new branch is appended after its parent; reverse-order accumulation
   // yields downstream demand that must pass through each parent voxel.
   for(let k=sites.length-1;k>=0;k--){
    const i=sites[k],p=this.branchParent[i];
    if(p>=0&&this.matter[p]===type)this.branchLoad[p]+=this.branchLoad[i];
   }
   for(let i of sites){
    const load=this.branchLoad[i],r=load>65?2.15:load>22?1.72:load>9?1.36:0;
    if(!r)continue;
    const [x,y,z]=this.xyz(i);
    for(let dz=-2;dz<=2;dz++)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
     const rr=dx*dx+dy*dy+dz*dz;
     if(rr===0||rr>r*r)continue;
     const xx=x+dx,yy=y+dy,zz=z+dz;
     if(!this.inside(xx,yy,zz))continue;
     const j=this.index(xx,yy,zz);
     if(this.matter[j]!==MAT.TISSUE&&this.matter[j]!==MAT.DENSE)continue;
     if(this.reservedVesselType[j]&&this.reservedVesselType[j]!==type)continue;
     if(this.depth[j]<.042)continue;
     assigned.push([j,type]);
    }
   }
  }
  for(let [i,type] of assigned){
   if(this.matter[i]===MAT.TISSUE||this.matter[i]===MAT.DENSE){
    if(this.setFluid(i,type))this.trunkVoxels++;
   }
  }
 }
 connectCapillaryBeds(rounds=5){
  let dA=this.distanceFrom(MAT.ARTERY),dV=this.distanceFrom(MAT.VEIN);
  let selected=[],created=0;
  for(let round=0;round<rounds;round++){
   let candidates=[];
   for(let z=3;z<N-3;z+=3)for(let y=3;y<N-3;y+=3)for(let x=3;x<N-3;x+=3){
    const center=this.index(x,y,z),centerLayer=this.layers[center];
    if(!centerLayer)continue;
    // The voxel grid is only a sampling accelerator. Actual capillary beds
    // are placed at local oxygen deficits, not grid-crossing positions.
    let best=null,bestValue=-Infinity;
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const xx=x+dx,yy=y+dy,zz=z+dz,i=this.index(xx,yy,zz);
     const matter=this.matter[i];
     if(matter!==MAT.TISSUE&&matter!==MAT.DENSE)continue;
     if(dA[i]>38||dV[i]>38)continue;
     const layer=this.layers[i];
     if(layer!==centerLayer)continue;
     if(layer===ZONE.CAPSULE||layer===ZONE.PLEURA||
        layer===ZONE.ENDOCARDIUM||layer===ZONE.NECROTIC)continue;
     const need=this.demand[i]*(1-this.oxygen[i]*.94);
     const transport=(dA[i]+dV[i])*.018;
     const matrix=this.resistance[i]*.085;
     let score=need*2.6+.75*this.demand[i]-transport-matrix;
     if(this.settings.organ==='kidney'&&layer===ZONE.CORTEX)score+=.45;
     if(this.settings.organ==='liver'&&layer===ZONE.HEPATOCYTES)score+=.35;
     if(this.settings.organ==='lung'&&layer===ZONE.ALVEOLI)score+=.45;
     if(this.settings.organ==='heart'&&layer===ZONE.MYOCARDIUM)score+=.48;
     const quality=score-.015*(dx*dx+dy*dy+dz*dz);
     if(quality>bestValue){bestValue=quality;best={x:xx,y:yy,z:zz,i,score};}
    }
    if(best)candidates.push(best);
   }
   candidates.sort((a,b)=>b.score-a.score);
   const chosen=[],budget=round===0?26:17;
   for(let c of candidates){
    if(chosen.length>=budget)break;
    if(selected.some(p=>sq(p.x-c.x)+sq(p.y-c.y)+sq(p.z-c.z)<(this.settings.organ==='heart'?28:48)))continue;
    if(chosen.some(p=>sq(p.x-c.x)+sq(p.y-c.y)+sq(p.z-c.z)<(this.settings.organ==='heart'?33:62)))continue;
    if(this.connectThrough(c.i,dA,dV)){chosen.push(c);created++;}
   }
   if(!chosen.length)break;
   selected.push(...chosen);
   dA=this.distanceFrom(MAT.ARTERY);dV=this.distanceFrom(MAT.VEIN);
   this.recomputeCoverage(true);
   if(this.coverage>=96.5)break;
  }
  this.bridges=created;
 }
 // All blood is one physically face-connected volume: inlet -> capillary
 // exchange beds -> venous outlet. Spline stamps can leave small side
 // islands near reserved anatomical destinations, so rescue the minimal
 // number of actual lumen voxels rather than inventing a graph connection.
 ensureCirculation(){
  const visited=new Uint8Array(SIZE),queue=new Int32Array(SIZE);
  let count=0;
  const flood=()=>{
   let head=0,tail=0;visited.fill(0);
   visited[this.inlet]=1;queue[tail++]=this.inlet;
   while(head<tail){
    const i=queue[head++];
    const [x,y,z]=this.xyz(i);
    if(!this.inside(x,y,z))continue;
    for(const o of step6){
     const j=i+o;
     if(!visited[j]&&this.isFluid(j)){visited[j]=1;queue[tail++]=j;}
    }
   }
   count=tail;
  };
  let repaired=0,created=0;
  flood();
  for(let pass=0;pass<30&&count<this.lumenCount;pass++){
   const parents=new Int32Array(SIZE);parents.fill(-1);
   const found=new Uint8Array(SIZE);
   let head=0,tail=0;
   for(let i=0;i<SIZE;i++){
    if(visited[i]){found[i]=1;queue[tail++]=i;}
   }
   let target=-1;
   while(head<tail&&target<0){
    const i=queue[head++],[x,y,z]=this.xyz(i);
    if(!this.inside(x,y,z))continue;
    for(const o of step6){
     const j=i+o;
     if(found[j]||!this.matter[j])continue;
     found[j]=1;parents[j]=i;
     if(this.isFluid(j)){target=j;break;}
     queue[tail++]=j;
    }
   }
   if(target<0)break;
   const route=[];let current=target;
   while(current>=0&&!visited[current]&&route.length<SIZE){
    if(!this.isFluid(current))route.push(current);
    current=parents[current];
   }
   // Construct true 6-face lumen bridges, with no phantom edge connectivity.
   for(const i of route.reverse())if(this.setFluid(i,MAT.CAPILLARY))created++;
   repaired++;
   flood();
  }
  this.connectedVoxels=count;
  this.isolatedVoxels=this.lumenCount-count;
  this.connectivityRepairs=repaired;
  this.repairCapillaryVoxels=created;
 }
 rebuildWall(){
  let walls=[];
  for(let i=N2+N+1;i<SIZE-N2-N-1;i++){
   if(!this.isFluid(i))continue;
   for(let o of step6){
    let j=i+o;
    if(this.matter[j]===MAT.TISSUE||this.matter[j]===MAT.DENSE)walls.push(j);
   }
  }
  for(let j of walls){
   if(this.matter[j]===MAT.TISSUE||this.matter[j]===MAT.DENSE){
    this.matter[j]=MAT.WALL;this.density[j]=clamp(this.density[j]+.18,.2,1);this.wallCount++;
    this.geometryVersion++;
   }
  }
 }
 recomputeCoverage(reseed=false){
  // Neighborhood distance model used as initial condition & growth chemotaxis.
  // The actual fields then evolve by finite-volume advection and diffusion.
  let dist=new Int16Array(SIZE);dist.fill(32767);
  const q=new Int32Array(SIZE);let head=0,tail=0;
  for(let i=0;i<SIZE;i++){
   let t=this.matter[i];
   if(t===MAT.CAPILLARY||t===MAT.ARTERY){
    dist[i]=t===MAT.CAPILLARY?0:2;q[tail++]=i;
   }
  }
  // Start queue with all sources; core arteries are treated as weaker tissue
  // exchange surfaces than capillaries. An actual blood plasma field follows.
  while(head<tail){
   let i=q[head++],d=dist[i]+1;
   let x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   if(x===0||x===N-1||y===0||y===N-1||z===0||z===N-1)continue;
   for(let o of step6){
    let j=i+o;
    if(!this.matter[j]||dist[j]<=d)continue;
    dist[j]=d;q[tail++]=j;
   }
  }
  let reach=(2.2+this.settings.reach*.12)*(N/64),covered=0,perf=0,voxels=0;
  for(let i=0;i<SIZE;i++){
   let t=this.matter[i];if(!t||this.isFluid(i))continue;
   voxels++;
   let initial=clamp(1.04-dist[i]/reach,0,1);
   if(reseed)this.oxygen[i]=Math.max(this.oxygen[i],initial);
   else this.oxygen[i]=initial;
   this.nutrient[i]=Math.max(this.nutrient[i],initial*.94);
   if(this.oxygen[i]>this.demand[i]*.48)covered++;
   if(this.oxygen[i]>.22)perf++;
  }
  this.coverage=voxels?100*covered/voxels:0;
  this.perfused=voxels?100*perf/voxels:0;
 }
 solvePressure(){
  // Matrix-free preconditioned conjugate gradients solve the discrete
  // finite-volume pressure Poisson equation. Fluid/solid faces are impermeable.
  // Pressure boundary values: a single artery inlet = 1, vein outlet = 0.
  // This is an incompressible, viscosity-damped low-Reynolds-number flow model.
  const p=this.pressure,m=this.matter,rootA=this.inlet,rootV=this.outlet;
  const permeability=i=>m[i]===MAT.CAPILLARY?.30:1;
  const indices=[];
  const diag=new Float64Array(SIZE),b=new Float64Array(SIZE);
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i)||i===rootA||i===rootV)continue;
   indices.push(i);
   const g0=permeability(i);
   for(let k=0;k<6;k++){
    const j=i+step6[k];
    if(!this.isFluid(j))continue;
    const g=(g0+permeability(j))*.5;
    diag[i]+=g;
    if(j===rootA)b[i]+=g;
   }
  }
  // Starting from a neutral field, solve A*p=b with Jacobi preconditioning.
  const x=new Float64Array(SIZE),r=new Float64Array(SIZE),
    direction=new Float64Array(SIZE),Ad=new Float64Array(SIZE);
  for(let i of indices)x[i]=.5;
  const apply=(src,dst)=>{
   for(let i of indices){
    let sum=diag[i]*src[i],g0=permeability(i);
    for(let k=0;k<6;k++){
     const j=i+step6[k];
     if(j===rootA||j===rootV||!this.isFluid(j))continue;
     sum-=(g0+permeability(j))*.5*src[j];
    }
    dst[i]=sum;
   }
  };
  apply(x,Ad);
  let rr=0,initial=0;
  for(let i of indices){
   r[i]=b[i]-Ad[i];
   let zi=r[i]/Math.max(diag[i],1e-8);
   direction[i]=zi;rr+=r[i]*zi;
   initial+=r[i]*r[i];
  }
  const tolerance=Math.sqrt(initial)*1e-6;
  let count=0;
  for(let iter=0;iter<1100&&rr>1e-24;iter++){
   apply(direction,Ad);
   let denom=0;
   for(let i of indices)denom+=direction[i]*Ad[i];
   if(!(denom>1e-25))break;
   let alpha=rr/denom;
   let err=0;
   for(let i of indices){
    x[i]+=alpha*direction[i];
    r[i]-=alpha*Ad[i];err+=r[i]*r[i];
   }
   count=iter+1;
   if(Math.sqrt(err)<tolerance)break;
   let next=0;
   for(let i of indices){
    const zi=r[i]/Math.max(diag[i],1e-8);
    Ad[i]=zi;
    next+=r[i]*zi;
   }
   let beta=next/rr;
   for(let i of indices)direction[i]=Ad[i]+beta*direction[i];
   rr=next;
  }
  p[rootA]=1;p[rootV]=0;
  for(let i of indices)p[i]=clamp(x[i],0,1);
  this.pressureIterations=count;
  this.flowRate=0;this.flowingVoxels=0;
  const fx=this.faceX,fy=this.faceY,fz=this.faceZ;
  fx.fill(0);fy.fill(0);fz.fill(0);
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   for(let k=0;k<3;k++){
    if((k===0&&x>=N-1)||(k===1&&y>=N-1)||(k===2&&z>=N-1))continue;
    const j=i+[1,N,N2][k];if(!this.isFluid(j))continue;
    const conductance=(permeability(i)+permeability(j))*.5;
    const flow=conductance*(p[i]-p[j]);
    (k===0?fx:k===1?fy:fz)[i]=flow;
    this.flowRate=Math.max(this.flowRate,Math.abs(flow));
   }
  }
  const speed=this.flowRate?.56/this.flowRate:0;
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   this.vx[i]=(fx[i]+(x>0?fx[i-1]:0))*.5*speed;
   this.vy[i]=(fy[i]+(y>0?fy[i-N]:0))*.5*speed;
   this.vz[i]=(fz[i]+(z>0?fz[i-N2]:0))*.5*speed;
   if(Math.hypot(this.vx[i],this.vy[i],this.vz[i])>.002)this.flowingVoxels++;
  }
  this.flowSolved=true;
 }
 finish(){
  if(this.finished)return;
  this.matureTrunks();
  this.recomputeCoverage();
  this.connectCapillaryBeds(5);
  this.ensureCirculation();
  this.rebuildWall();
  this.solvePressure();
  this.recomputeCoverage(true);
  this.finished=true;
  this.updateTexture();
 }
 // Flux-limited, conservative upwind transport across SHARED 3D voxel faces.
 // No dye or plasma can cross into a nonfluid tissue voxel. Oxygen & nutrient
 // exchange then cross fluid/tissue interfaces by a separate diffusion flux.
 advanceFluid(dt=1/30){
  if(!this.finished)return;
  this.fluidClock+=Math.max(0,dt);
  const ticks=Math.min(4,Math.max(1,Math.round(dt*30)));
  for(let sub=0;sub<ticks;sub++)this.transportSubstep();
  this.fluidTime+=dt;
  this.updateTexture();
 }
 transportSubstep(){
  const m=this.matter,dye=this.dye,plasma=this.bloodOxygen,oxygen=this.oxygen,nutrients=this.nutrient;
  const pulse=1+.22*Math.sin(this.fluidTime*7.0);
  const dyeValue=.5+.5*Math.sin(this.fluidTime*3.2);
  dye[this.inlet]=dyeValue;plasma[this.inlet]=this.settings.organ==='lung'?.53:1;
  const dd=new Float32Array(SIZE),do2=new Float32Array(SIZE);
  const outgoing=new Float32Array(SIZE);
  const speed=this.flowRate?(.23/this.flowRate)*pulse:0;
  const viscosity=clamp(this.settings.viscosity/100,0,1);
  const fluidMobility=1-.48*viscosity;
  const fluxes=[this.faceX,this.faceY,this.faceZ],offsets=[1,N,N2];
  // First pass: compute total outward volume per donor voxel.
  // No source may advect more than its volume in a single timestep.
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   for(let axis=0;axis<3;axis++){
    if((axis===0&&x>=N-1)||(axis===1&&y>=N-1)||(axis===2&&z>=N-1))continue;
    const j=i+offsets[axis];if(!this.isFluid(j))continue;
    const flux=fluxes[axis][i]*speed*fluidMobility;
    if(!flux)continue;
    const donor=flux>0?i:j;
    outgoing[donor]+=Math.min(.24,Math.abs(flux));
   }
  }
  // Second pass: scale competing face fluxes for each donor, then apply
  // equal and opposite transfers, conserving total tracer and oxygen mass.
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   for(let axis=0;axis<3;axis++){
    if((axis===0&&x>=N-1)||(axis===1&&y>=N-1)||(axis===2&&z>=N-1))continue;
    const j=i+offsets[axis];if(!this.isFluid(j))continue;
    const flux=fluxes[axis][i]*speed*fluidMobility;
    if(!flux)continue;
    const donor=flux>0?i:j,receiver=flux>0?j:i;
    const fraction=Math.min(.24,Math.abs(flux))*
      Math.min(1,.82/Math.max(outgoing[donor],1e-9));
    const dyeTransport=fraction*dye[donor],oxygenTransport=fraction*plasma[donor];
    dd[donor]-=dyeTransport;dd[receiver]+=dyeTransport;
    do2[donor]-=oxygenTransport;do2[receiver]+=oxygenTransport;
   }
  }
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   dye[i]=clamp((dye[i]+dd[i])*.999,0,1);
   plasma[i]=clamp(plasma[i]+do2[i],0,1);
  }
  // The inflow is a fixed-concentration blood reservoir, not a finite voxel
  // that permanently depletes after a few steps of circulation.
  dye[this.inlet]=dyeValue;
  plasma[this.inlet]=this.settings.organ==='lung'?.53:1;
  // Face exchange and tissue diffusion in the same 3D lattice.
  // Compute changes from the old field, then apply simultaneously.
  const oNext=new Float32Array(SIZE),nNext=new Float32Array(SIZE);
  for(let i=0;i<SIZE;i++){
   if(!m[i]||this.isFluid(i))continue;
   let totalO=0,totalN=0;
   for(let k=0;k<6;k++){
    let j=i+step6[k],t=m[j];if(!t)continue;
    if(this.isFluid(j)){
     // Vessel wall is metabolically active but permeable to oxygen.
     const exchange=t===MAT.CAPILLARY?.105:t===MAT.ARTERY?.025:.008;
     if(this.settings.organ==='lung'&&this.layers[i]===ZONE.ALVEOLI){
      // Alveolar exchange oxygenates pulmonary blood; it is not a systemic
      // artery arriving at this bed already fully oxygenated.
      totalO+=.035*(.99-oxygen[i]);
      do2[j]+=.018*Math.max(0,.99-plasma[j]);
     }else totalO+=exchange*(plasma[j]-oxygen[i]);
     totalN+=exchange*.85*(.90-nutrients[i]);
     // Blood loses oxygen to nearby tissue. Flux is bounded per fluid voxel.
     if(t===MAT.CAPILLARY)do2[j]-=Math.max(0,plasma[j]-oxygen[i])*.004;
    }else{
     totalO+=.055*(oxygen[j]-oxygen[i]);
     totalN+=.048*(nutrients[j]-nutrients[i]);
    }
   }
   oNext[i]=clamp(oxygen[i]+totalO-this.demand[i]*.0016,0,1);
   nNext[i]=clamp(nutrients[i]+totalN-this.demand[i]*.0011,0,1);
  }
  let covered=0,perfused=0,count=0;
  for(let i=0;i<SIZE;i++){
   if(m[i]&&!this.isFluid(i)){
    oxygen[i]=oNext[i];nutrients[i]=nNext[i];count++;
    if(oxygen[i]>=this.demand[i]*.48)covered++;
    if(oxygen[i]>.22)perfused++;
   }else if(this.isFluid(i)){
    plasma[i]=clamp(plasma[i]+do2[i]*.35,0,1);
   }
  }
  this.coverage=count?covered/count*100:0;
  this.perfused=count?perfused/count*100:0;
 }
 // Runtime inspection of tissue viability by actual anatomical compartment.
 // Unlike global coverage, these values reveal regions that are not supplied.
 layerMetrics(){
  const stats=new Map();
  for(const [name,id] of this.zoneLabels){
   stats.set(id,{id,name,count:0,oxygen:0,demand:0,covered:0,conducting:0});
  }
  for(let i=0;i<SIZE;i++){
   const id=this.layers[i],row=stats.get(id);
   if(!row||!this.matter[i])continue;
   if(this.isFluid(i)){row.conducting++;continue;}
   row.count++;row.oxygen+=this.oxygen[i];row.demand+=this.demand[i];
   if(this.oxygen[i]>=this.demand[i]*.48)row.covered++;
  }
  return Array.from(stats.values()).map(s=>({
   id:s.id,name:s.name,count:s.count,lumen:s.conducting,
   meanOxygen:s.count?s.oxygen/s.count:0,
   meanDemand:s.count?s.demand/s.count:0,
   coverage:s.count?100*s.covered/s.count:0
  }));
 }
 // Render-only material-volume filter: a trilinearly sampled multi-channel
 // vessel occupancy field softens diagonal lumens without changing the discrete
 // fluid mask, chemistry, boundary conditions or face-flux connectivity.
 updateVesselOccupancy(){
  if(this.smoothedVersion===this.geometryVersion)return false;
  const out=this.smoothVesselBytes;
  const weights=[.31,1,.31];
  for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   const base=this.index(x,y,z)*4;
   let artery=0,vein=0,capillary=0,wall=0;
   for(let dz=-1;dz<=1;dz++){
    const zz=z+dz;if(zz<0||zz>=N)continue;
    for(let dy=-1;dy<=1;dy++){
     const yy=y+dy;if(yy<0||yy>=N)continue;
     for(let dx=-1;dx<=1;dx++){
      const xx=x+dx;if(xx<0||xx>=N)continue;
      const weight=weights[dx+1]*weights[dy+1]*weights[dz+1];
      const kind=this.matter[this.index(xx,yy,zz)];
      if(kind===MAT.ARTERY)artery+=weight;
      else if(kind===MAT.VEIN)vein+=weight;
      else if(kind===MAT.CAPILLARY)capillary+=weight;
      else if(kind===MAT.WALL)wall+=weight;
     }
    }
   }
   out[base]=Math.round(clamp(artery*.69,0,1)*255);
   out[base+1]=Math.round(clamp(vein*.69,0,1)*255);
   out[base+2]=Math.round(clamp(capillary*.69,0,1)*255);
   out[base+3]=Math.round(clamp(wall*.5,0,1)*255);
  }
  this.smoothedVersion=this.geometryVersion;
  return true;
 }
 updateTexture(){
  this.updateVesselOccupancy();
  const f=this.fieldBytes,m=this.materialBytes,v=this.flowBytes;
  for(let i=0;i<SIZE;i++){
   const t=this.matter[i],j=i*4;
   m[i]=t;
   this.layerBytes[i]=this.layers[i];
   f[j]=Math.round(clamp(this.density[i],0,1)*255);
   f[j+1]=Math.round(clamp(this.isFluid(i)?this.bloodOxygen[i]:this.oxygen[i],0,1)*255);
   f[j+2]=Math.round(clamp(this.nutrient[i],0,1)*255);
   f[j+3]=Math.round(clamp(this.dye[i],0,1)*255);
   v[j]=Math.round(clamp(this.vx[i]*.65+.5,0,1)*255);
   v[j+1]=Math.round(clamp(this.vy[i]*.65+.5,0,1)*255);
   v[j+2]=Math.round(clamp(this.vz[i]*.65+.5,0,1)*255);
   v[j+3]=Math.round(clamp(this.pressure[i],0,1)*255);
  }
 }
}
