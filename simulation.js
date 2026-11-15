// Everything persistent is a voxel field. No procedural tube or vessel-edge meshes.
// Voxel classes: 0 void, 1 parenchyma, 2 dense tissue, 3 arterial fluid,
// 4 venous fluid, 5 capillary fluid, 6 encapsulating vessel wall.
// Tissue sprouts are grown by 6-neighbor chemotaxis and capillary paths
// are connected using 3D distance fields. Flow is a conservative face-flux
// finite-volume pressure/transport model (not a full Navier-Stokes solver).
export const GRID=64;
const N=GRID, N2=N*N, SIZE=N*N*N;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const sq=x=>x*x;
const step6=[1,-1,N,-N,N2,-N2];
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
  this.occupied=0;this.lumenCount=0;this.capillaryCount=0;this.wallCount=0;
  this.inlet=-1;this.outlet=-1;this.tips=[];this.iteration=0;this.maxIterations=66;
  this.finished=false;this.coverage=0;this.perfused=0;this.flowingVoxels=0;this.flowRate=0;
  this.fluidTime=0;this.fluidClock=0;this.flowSolved=false;
  this.buildTissue();this.seedVessels();this.updateTexture();
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
  this.lumenCount++;if(type===MAT.CAPILLARY)this.capillaryCount++;
  this.pressure[i]=type===MAT.ARTERY?.82:type===MAT.VEIN?.18:.50;
  this.bloodOxygen[i]=type===MAT.ARTERY?1:type===MAT.VEIN?.50:.80;
  this.nutrient[i]=.85;
  this.oxygen[i]=.9;
  return true;
 }
 seedVessels(){
  let mid=N/2;
  let [ax,ay,az]=this.nearestTissue(mid-5,mid-16,mid-2);
  let [vx,vy,vz]=this.nearestTissue(mid+5,mid-16,mid+2);
  this.inlet=this.index(ax,ay,az);this.outlet=this.index(vx,vy,vz);
  this.setFluid(this.inlet,MAT.ARTERY);this.setFluid(this.outlet,MAT.VEIN);
  for(let type of [MAT.ARTERY,MAT.VEIN]){
   let xyz=type===MAT.ARTERY?[ax,ay,az]:[vx,vy,vz];
   for(let i=0;i<13;i++){
    let [x,y,z]=xyz;const at=this.index(x,y,z);
    if(this.matter[at]===MAT.TISSUE||this.matter[at]===MAT.DENSE)this.setFluid(at,type);
    if(i%2===0){
     for(let a=0;a<3;a++){
      const angle=(a/3)*Math.PI*2+this.rand()*1.7;
      this.tips.push({x,y,z,type,dx:Math.cos(angle),dy:0.12+this.rand()*.7,dz:Math.sin(angle),age:0});
     }
    }
    xyz=[x,Math.min(N-2,y+1),z];
   }
  }
 }
 step(){
  if(this.finished)return false;
  let proposed=[],limit=45+Math.round(this.settings.vascularity*1.05);
  const choose6=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let tipList=this.tips;
  // Deterministic shuffle prevents a directional processing bias.
  for(let i=tipList.length-1;i>0;i--){let j=Math.floor(this.rand()*(i+1));[tipList[i],tipList[j]]=[tipList[j],tipList[i]]}
  const next=[],active=Math.min(tipList.length,limit);
  for(let n=0;n<active;n++){
   let tip=tipList[n],best=-1,bestScore=-Infinity,bestDir=null;
   for(let d of choose6){
    let x=tip.x+d[0],y=tip.y+d[1],z=tip.z+d[2];
    if(!this.inside(x,y,z))continue;
    let i=this.index(x,y,z),type=this.matter[i];
    if(type!==MAT.TISSUE&&type!==MAT.DENSE)continue;
    let x2=x+d[0]*2,y2=y+d[1]*2,z2=z+d[2]*2;
    let ahead=this.inside(x2,y2,z2)?this.index(x2,y2,z2):-1;
    let dir=(tip.dx*d[0]+tip.dy*d[1]+tip.dz*d[2]);
    // Sprouts are biased by unmet metabolic demand, direction persistence
    // and the density of same-type neighboring voxels.
    let crowded=0;
    for(let o of step6){
     let neighbor=i+o;
     if(this.matter[neighbor]===tip.type)crowded++;
    }
    let score=.85*(1-this.oxygen[i])+.45*this.demand[i]+.65*dir-.14*crowded+
      (ahead>=0&&this.matter[ahead]===tip.type?-.55:0)+this.rand()*.57;
    if(score>bestScore){bestScore=score;best=i;bestDir=d}
   }
   if(best<0)continue;
   this.setFluid(best,tip.type);
   const [x,y,z]=this.xyz(best);
   let dx=.71*tip.dx+.29*bestDir[0],dy=.71*tip.dy+.29*bestDir[1],dz=.71*tip.dz+.29*bestDir[2],norm=Math.hypot(dx,dy,dz)||1;
   const newTip={x,y,z,type:tip.type,dx:dx/norm,dy:dy/norm,dz:dz/norm,age:tip.age+1};
   next.push(newTip);
   const chance=(.017+this.settings.vascularity*.00067);
   if(tip.age>2&&this.rand()<chance&&next.length<limit){
    let r=this.rand()*Math.PI*2;
    proposed.push({x,y,z,type:tip.type,dx:Math.cos(r),dy:this.rand()*1.4-.4,dz:Math.sin(r),age:0});
   }
  }
  this.tips=next.concat(proposed).slice(0,limit);
  this.iteration++;
  if(this.iteration>=this.maxIterations||(!this.tips.length&&this.iteration>10)){
   this.finish();
  }
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
 pathFrom(i,dist,targetType){
  if(dist[i]===32767)return null;
  let path=[],current=i,guard=0;
  while(dist[current]>0&&guard++<SIZE){
   let best=-1,d=dist[current];
   let [x,y,z]=this.xyz(current);
   if(!this.inside(x,y,z))return null;
   for(let o of step6){let j=current+o;if(dist[j]<d){d=dist[j];best=j}}
   if(best<0)return null;
   if(this.matter[current]===MAT.TISSUE||this.matter[current]===MAT.DENSE||this.matter[current]===MAT.WALL)path.push(current);
   current=best;
  }
  if(this.matter[current]!==targetType)return null;
  return path;
 }
 connectThrough(i,dA,dV){
  let a=this.pathFrom(i,dA,MAT.ARTERY),b=this.pathFrom(i,dV,MAT.VEIN);
  if(!a||!b||a.length+b.length>75)return false;
  for(let index of a.concat(b)){
   if(!this.isFluid(index))this.setFluid(index,MAT.CAPILLARY);
  }
  return true;
 }
 connectCapillaryBeds(rounds=4){
  // Connect unmet-demand tissue directly to both arterial and venous fields.
  // All path segments are actual connected fluid voxels; no abstract edge exists.
  let dA=this.distanceFrom(MAT.ARTERY),dV=this.distanceFrom(MAT.VEIN);
  let selected=[],created=0;
  for(let round=0;round<rounds;round++){
   let candidates=[];
   for(let z=3;z<N-3;z+=3)for(let y=3;y<N-3;y+=3)for(let x=3;x<N-3;x+=3){
    let i=this.index(x,y,z),t=this.matter[i];
    if(t!==MAT.TISSUE&&t!==MAT.DENSE)continue;
    if(dA[i]>28||dV[i]>28)continue;
    let unmet=this.demand[i]*(1-this.oxygen[i]),dx=dA[i],dy=dV[i];
    let score=unmet*2+.085*(dx+dy)+this.rand()*.15;
    if(this.oxygen[i]>this.demand[i]*.65)score-=1.8;
    if(dx<2||dy<2)score-=.3;
    candidates.push({x,y,z,i,score});
   }
   candidates.sort((a,b)=>b.score-a.score);
   let chosen=[],budget=round===0?48:36;
   for(let c of candidates){
    if(chosen.length>=budget)break;
    if(selected.some(p=>sq(p.x-c.x)+sq(p.y-c.y)+sq(p.z-c.z)<25))continue;
    if(chosen.some(p=>sq(p.x-c.x)+sq(p.y-c.y)+sq(p.z-c.z)<36))continue;
    if(this.connectThrough(c.i,dA,dV)){
     chosen.push(c);created++;
    }
   }
   if(!chosen.length)break;
   selected.push(...chosen);
   dA=this.distanceFrom(MAT.ARTERY);dV=this.distanceFrom(MAT.VEIN);
   this.recomputeCoverage(true);
   if(this.coverage>=97)break;
  }
  this.bridges=created;
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
  let reach=2.2+this.settings.reach*.12,covered=0,perf=0,voxels=0;
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
  // Solve the discrete incompressible pressure potential on the lumen mask.
  // Faces shared with tissue and vessel walls are no-flux boundaries.
  // Fixed pressure at inlet & outlet provides circulation drive.
  const p=this.pressure,m=this.matter,rootA=this.inlet,rootV=this.outlet;
  const permeability=i=>m[i]===MAT.CAPILLARY?.30:1;
  const indices=[];
  for(let i=0;i<SIZE;i++)if(this.isFluid(i)&&i!==rootA&&i!==rootV)indices.push(i);
  p[rootA]=1;p[rootV]=0;
  for(let it=0;it<460;it++){
   let worst=0;
   // Alternating sweep reduces lattice anisotropy and pressure residual.
   const backwards=Boolean(it&1);
   for(let t=0;t<indices.length;t++){
    const i=indices[backwards?indices.length-1-t:t];
    let total=0,weight=0;
    const k0=permeability(i);
    for(let o of step6){
     let j=i+o;if(!this.isFluid(j))continue;
     let g=.5*(k0+permeability(j));
     total+=g*p[j];weight+=g;
    }
    if(weight===0)continue;
    let target=total/weight;
    let next=clamp(p[i]+(target-p[i])*1.38,0,1);
    worst=Math.max(worst,Math.abs(p[i]-next));p[i]=next;
   }
   if(it>160&&worst<.00004)break;
  }
  this.flowRate=0;this.flowingVoxels=0;
  const fx=this.faceX,fy=this.faceY,fz=this.faceZ;
  fx.fill(0);fy.fill(0);fz.fill(0);
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
   for(let k=0;k<3;k++){
    if((k===0&&x>=N-1)||(k===1&&y>=N-1)||(k===2&&z>=N-1))continue;
    const j=i+[1,N,N2][k];
    if(!this.isFluid(j))continue;
    const conductance=(permeability(i)+permeability(j))*.5;
    const flow=conductance*(p[i]-p[j]);
    (k===0?fx:k===1?fy:fz)[i]=flow;
    this.flowRate=Math.max(this.flowRate,Math.abs(flow));
   }
  }
  const speed=this.flowRate? .56/this.flowRate:0;
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
  this.recomputeCoverage();
  this.connectCapillaryBeds(6);
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
  dye[this.inlet]=dyeValue;plasma[this.inlet]=1;
  const dd=new Float32Array(SIZE),do2=new Float32Array(SIZE);
  const speed=this.flowRate?(.23/this.flowRate)*pulse:0;
  const viscosity=clamp(this.settings.viscosity/100,0,1);
  const fluidMobility=1-.48*viscosity;
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   for(let axis=0;axis<3;axis++){
    const offset=[1,N,N2][axis];
    const x=i%N,y=Math.floor(i/N)%N,z=Math.floor(i/N2);
    if((axis===0&&x>=N-1)||(axis===1&&y>=N-1)||(axis===2&&z>=N-1))continue;
    const j=i+offset;
    if(!this.isFluid(j))continue;
    let q=[this.faceX,this.faceY,this.faceZ][axis][i]*speed*fluidMobility;
    if(q===0)continue;
    let donor=q>0?i:j,receiver=q>0?j:i,volume=clamp(Math.abs(q),0,.24);
    let deltaD=volume*dye[donor],deltaO=volume*plasma[donor];
    dd[donor]-=deltaD;dd[receiver]+=deltaD;
    do2[donor]-=deltaO;do2[receiver]+=deltaO;
   }
  }
  for(let i=0;i<SIZE;i++){
   if(!this.isFluid(i))continue;
   dye[i]=clamp((dye[i]+dd[i])*.999,0,1);
   plasma[i]=clamp(plasma[i]+do2[i],0,1);
  }
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
     totalO+=exchange*(plasma[j]-oxygen[i]);
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
 updateTexture(){
  const f=this.fieldBytes,m=this.materialBytes,v=this.flowBytes;
  for(let i=0;i<SIZE;i++){
   const t=this.matter[i],j=i*4;
   m[i]=t;
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
