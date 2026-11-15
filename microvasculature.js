// Sub-voxel visual profile for TRUE one-voxel lumen channels.
// Fine venules join pre-existing capillary exchange beds to venous collectors.
// No extra meshes, particles or abstract flow edges: blood still travels
// through MAT.VEIN/CAPILLARY voxels in the shared finite-volume solver.
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const sq=x=>x*x;
const weight=(m,i)=>{
 const t=m.matter[i];
 if(t===4)return -.1;
 if(t===5)return .16;
 if(t!==1&&t!==2)return Infinity;
 return .35+.12*m.resistance[i]+.13*m.density[i];
};
function bridge(m,from,to){
 const [x,y,z]=m.xyz(from),[tx,ty,tz]=m.xyz(to);
 const delta=[tx-x,ty-y,tz-z];
 if(delta.some(v=>Math.abs(v)>1))return null;
 const axes=[];
 for(let k=0;k<3;k++)if(delta[k])axes.push(k);
 if(!axes.length)return [];
 const orders=axes.length===1?[[axes[0]]]:axes.length===2?
   [[axes[0],axes[1]],[axes[1],axes[0]]]:
   [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
 let best=null,bestCost=Infinity;
 for(const order of orders){
  const p=[x,y,z],items=[],last=order.length-1;
  let cost=0,valid=true;
  for(let k=0;k<last;k++){
   const axis=order[k];p[axis]+=delta[axis];
   if(!m.inside(...p)){valid=false;break;}
   const i=m.index(...p),w=weight(m,i);
   if(!Number.isFinite(w)){valid=false;break;}
   items.push(i);cost+=w;
  }
  if(valid&&cost<bestCost){best=items;bestCost=cost;}
 }
 return best;
}
function setThin(m,i,parent){
 if(m.matter[i]===4||m.matter[i]===5)return i;
 if(m.matter[i]!==1&&m.matter[i]!==2)return parent;
 if(!m.setFluid(i,4))return parent;
 m.hairVoxels[i]=255;
 m.hairVenuleCount++;
 // Reserve thin lumens from any later trunk thickening (growth occurs last).
 return i;
}
export function sproutFineVenules(m,{limit=85}={}){
 // Tissue demand selects drain targets *near functioning capillary beds*.
 // Sampling an existing capillary voxel guarantees one terminus is supplied.
 const spacing=3.3,targets=[];
 const dV=m.distanceFrom(4);
 const seed=m.settings.seed||0;
 for(let z=3;z<m.N-3;z+=2)for(let y=3;y<m.N-3;y+=2)for(let x=3;x<m.N-3;x+=2){
  const i=m.index(x,y,z);
  if(m.matter[i]!==5)continue;
  if(dV[i]<3||dV[i]>16)continue;
  let localNeed=0,valid=0;
  for(const [dx,dy,dz] of directions){
   const j=m.index(x+dx,y+dy,z+dz);
   if(m.matter[j]===1||m.matter[j]===2||m.matter[j]===6){
    localNeed+=m.demand[j]*(1-.5*m.oxygen[j]);
    valid++;
   }
  }
  if(valid<2)continue;
  // Small deterministic jitter avoids regular-spacing microvascular artifacts.
  const noise=m.hash(x*5+19,y*7+23,z*3+29);
  const layer=m.layers[i];
  const score=localNeed/valid*1.7 +.035*dV[i] +
    (m.settings.organ==='heart'&&layer===12?.5:0) +
    (m.settings.organ==='kidney'&&layer===2?.2:0) + .25*noise;
  targets.push({i,x,y,z,score});
 }
 targets.sort((a,b)=>b.score-a.score);
 const chosen=[];
 let branches=0,connected=0;
 for(const target of targets){
  if(branches>=limit)break;
  if(chosen.some(p=>sq(p.x-target.x)+sq(p.y-target.y)+sq(p.z-target.z)<spacing*spacing))continue;
  const path=m.pathFrom(target.i,dV,4); // from capillary to vein
  if(!path||path.length<4||path.length>20)continue;
  // Path follows a 3D demand-aware descent; sample a gentle moving average
  // to remove Manhattan corners while staying inside viable tissue.
  const control=path.slice().reverse().map(i=>m.xyz(i));
  const smoothed=control.map(p=>p.slice());
  for(let k=1;k<control.length-1;k++){
   const a=control[k-1],b=control[k],c=control[k+1];
   const q=[0,1,2].map(j=>.22*a[j]+.56*b[j]+.22*c[j]);
   const qi=q.map(Math.round);
   if(m.inside(...qi)&&Number.isFinite(weight(m,m.index(...qi))))smoothed[k]=q;
  }
  let prev=path[path.length-1],newVoxels=0,valid=true;
  for(let k=1;k<smoothed.length;k++){
   const a=smoothed[k-1],b=smoothed[k];
   const len=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
   const steps=Math.max(1,Math.ceil(len/.33));
   for(let n=1;n<=steps;n++){
    const t=n/steps,xyz=[0,1,2].map(j=>Math.round(a[j]*(1-t)+b[j]*t));
    if(!m.inside(...xyz)){valid=false;break;}
    const j=m.index(...xyz),w=weight(m,j);
    if(!Number.isFinite(w)){valid=false;break;}
    if(j===prev)continue;
    let connector=bridge(m,prev,j);
    if(connector===null){valid=false;break;}
    for(const mid of connector){
     const old=m.matter[mid];
     prev=setThin(m,mid,prev);
     if(old!==4&&m.matter[mid]===4)newVoxels++;
    }
    const old=m.matter[j];prev=setThin(m,j,prev);
    if(old!==4&&m.matter[j]===4)newVoxels++;
   }
   if(!valid)break;
  }
  if(newVoxels>=2){
   branches++;connected++;chosen.push(target);
  }
 }
 m.hairBranchCount=branches;
 m.hairConnectedCount=connected;
 return {branches,connected,voxels:m.hairVenuleCount};
}
