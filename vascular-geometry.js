// Curved 3D centerline -> voxel-fluid conversion. No tube meshes,
// graph-based fluid movement or geometry outside the voxel volume.
// A smoothed resistance-aware guide is rasterized into face-connected
// plasma voxels. The same method draws artery, vein and capillary beds.
export const DIRECTIONS_26=[];
for(let z=-1;z<=1;z++)for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
 if(x||y||z){
  const count=Math.abs(x)+Math.abs(y)+Math.abs(z);
  DIRECTIONS_26.push({x,y,z,count,length:Math.sqrt(count)});
 }
}
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const sq=x=>x*x;
function passable(m,i,type){
 const t=m.matter[i];
 return t===1||t===2||t===type||
  (type===5&&(t===3||t===4));
}
function safe(m,p,type){
 const x=Math.round(p[0]),y=Math.round(p[1]),z=Math.round(p[2]);
 return m.inside(x,y,z)&&passable(m,m.index(x,y,z),type);
}
function normalize(x,y,z){
 const len=Math.hypot(x,y,z)||1;
 return [x/len,y/len,z/len];
}
function sampleCurve(v,p0,p1,p2,p3,t){
 const t2=t*t,t3=t2*t;
 // Cubic Catmull-Rom interpolates the key points with continuous tangents.
 const a=2*p1[v],b=-p0[v]+p2[v],c=2*p0[v]-5*p1[v]+4*p2[v]-p3[v],
  d=-p0[v]+3*p1[v]-3*p2[v]+p3[v];
 return .5*(a+b*t+c*t2+d*t3);
}
export function buildCurvedCenterline(model,path,type,strength=.82){
 if(path.length<2)return path.map(i=>model.xyz(i));
 const input=path.map(i=>model.xyz(i));
 const len=input.length;
 let points=input.map(v=>v.slice());
 // Repeated chord relaxation removes alternating 90-degree corners.
 // Preserve the root and the terminal endpoint exactly.
 for(let pass=0;pass<3;pass++){
  const next=points.map(p=>p.slice());
  for(let k=1;k<len-1;k++){
   const p=points[k],a=points[k-1],b=points[k+1];
   const proposed=[
    p[0]*.48+(a[0]+b[0])*.26,
    p[1]*.48+(a[1]+b[1])*.26,
    p[2]*.48+(a[2]+b[2])*.26
   ];
   if(safe(model,proposed,type))next[k]=proposed;
  }
  points=next;
 }
 // Coherent anatomical resistance field bends the branch away from hard
 // layers. Noise is continuous in world space, not independent random turns.
 // Project all offsets perpendicular to the route direction so there are
 // no backwards loops or grid-axis-only offsets.
 for(let i=2;i<len-2;i++){
  const p=points[i];
  const left=points[Math.max(0,i-2)],right=points[Math.min(len-1,i+2)];
  const tangent=normalize(right[0]-left[0],right[1]-left[1],right[2]-left[2]);
  const x=Math.round(p[0]),y=Math.round(p[1]),z=Math.round(p[2]);
  const res=(dx,dy,dz)=>{
   const xx=x+dx,yy=y+dy,zz=z+dz;
   if(!model.inside(xx,yy,zz))return model.resistance[model.index(x,y,z)];
   return model.resistance[model.index(xx,yy,zz)];
  };
  const gradient=[
   res(1,0,0)-res(-1,0,0),
   res(0,1,0)-res(0,-1,0),
   res(0,0,1)-res(0,0,-1)
  ];
  const n=[
   model.noise(p[0]*.16+3,p[1]*.16+11,p[2]*.16+29),
   model.noise(p[0]*.16+27,p[1]*.16+5,p[2]*.16+13),
   model.noise(p[0]*.16+13,p[1]*.16+29,p[2]*.16+3)
  ];
  let offset=n.map((v,j)=>v*.45-gradient[j]*.18);
  const along=offset.reduce((sum,v,j)=>sum+v*tangent[j],0);
  offset=offset.map((v,j)=>v-tangent[j]*along);
  const envelope=Math.min(1,i/5,(len-1-i)/5);
  const candidate=p.map((v,j)=>v+offset[j]*strength*envelope);
  // Never smooth a bend through the organ exterior or through a
  // competing artery/vein. Keep the guide in viable matter voxels.
  if(safe(model,candidate,type))points[i]=candidate;
 }
 // Uniform arc-length sampling at <=0.38 voxel / step avoids gaps.
 const samples=[points[0]];
 for(let k=0;k<len-1;k++){
  const p0=points[Math.max(0,k-1)],p1=points[k],p2=points[k+1],
   p3=points[Math.min(len-1,k+2)];
  const subdivisions=Math.max(4,Math.ceil(Math.hypot(
   p2[0]-p1[0],p2[1]-p1[1],p2[2]-p1[2])/.28));
  for(let q=1;q<=subdivisions;q++){
   const t=q/subdivisions;
   const c=[0,1,2].map(v=>sampleCurve(v,p0,p1,p2,p3,t));
   if(safe(model,c,type))samples.push(c);
   else samples.push([
    p1[0]+(p2[0]-p1[0])*t,
    p1[1]+(p2[1]-p1[1])*t,
    p1[2]+(p2[2]-p1[2])*t
   ]);
  }
 }
 return samples;
}
function stampBall(model,type,p,r,parent,options={}){
 const x0=Math.max(2,Math.floor(p[0]-r)),x1=Math.min(model.N-3,Math.ceil(p[0]+r));
 const y0=Math.max(2,Math.floor(p[1]-r)),y1=Math.min(model.N-3,Math.ceil(p[1]+r));
 const z0=Math.max(2,Math.floor(p[2]-r)),z1=Math.min(model.N-3,Math.ceil(p[2]+r));
 const added=[];
 // Center first, then adjacent shell ensures no isolated side voxels.
 const potential=[];
 for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const d2=sq(x-p[0])+sq(y-p[1])+sq(z-p[2]);
  if(d2>r*r)continue;
  const i=model.index(x,y,z);
  if(!passable(model,i,type)||model.depth[i]<.035)continue;
  potential.push([i,d2]);
 }
 potential.sort((a,b)=>a[1]-b[1]);
 // Never convert an existing fluid voxel of the other family; it may be
 // a capillary connector, but not a physical aneurysm-like merge.
 for(let [i] of potential){
  if(model.matter[i]===type){if(parent<0)parent=i;continue;}
  if(model.isFluid(i))continue;
  if(model.setFluid(i,type)){
   if(options.register&&model.vesselSites?.[type])model.vesselSites[type].push(i);
   if(options.register&&model.branchParent)model.branchParent[i]=parent;
   if(options.register&&model.branchLoad&&i===options.terminal)
    model.branchLoad[i]+=options.work||0;
   added.push(i);
   parent=i;
  }
 }
 return {added,parent};
}
export function voxelizeCurve(model,type,path,{radius=1.04,register=false,work=0,strength=.82}={}){
 if(path.length<2)return {newVoxels:0,diagonal:0,curvature:0,points:0};
 const samples=buildCurvedCenterline(model,path,type,strength);
 let parent=path[0],newVoxels=0;
 let previous=null,totalLength=0,diagonal=0,curvature=0,lastDirection=null;
 for(let n=0;n<samples.length;n++){
  const p=samples[n];
  const radii=typeof radius==='function'?radius(n/Math.max(1,samples.length-1)):radius;
  const stamped=stampBall(model,type,p,radii,parent,{register,work,terminal:n===samples.length-1?path[path.length-1]:-1});
  parent=stamped.parent;
  newVoxels+=stamped.added.length;
  if(previous){
   const diff=[p[0]-previous[0],p[1]-previous[1],p[2]-previous[2]];
   totalLength+=Math.hypot(...diff);
   const dir=normalize(...diff);
   if(lastDirection)curvature+=Math.acos(clamp(dir.reduce((v,a,j)=>v+a*lastDirection[j],0),-1,1));
   lastDirection=dir;
   if(diff.filter(v=>Math.abs(v)>.00001).length>=2)diagonal++;
  }
  previous=p;
 }
 if(register&&model.branchLoad&&parent>=0)model.branchLoad[parent]+=(work||0);
 if(!model.curveStats)model.curveStats={3:{segments:0,curvature:0,length:0},4:{segments:0,curvature:0,length:0},5:{segments:0,curvature:0,length:0}};
 const stats=model.curveStats[type];
 stats.segments++;stats.curvature+=curvature;stats.length+=totalLength;
 return {newVoxels,diagonal,curvature,points:samples.length};
}
