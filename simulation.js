// Morphogenesis engine: voxel matter, demand-guided angiogenesis, capillary anastomosis,
// connected arterial / venous circulation, pressure-driven flow and nutrient diffusion.
// Research-inspired generative model, not a physiological or medical simulator.
export const GRID = 64;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = t => t*t*(3-2*t);
const sq = x => x*x;
const add = (a,b) => ({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const mul = (v,s) => ({x:v.x*s,y:v.y*s,z:v.z*s});
const len = v => Math.hypot(v.x,v.y,v.z);
const norm = v => {let l=len(v)||1;return mul(v,1/l)};
const distance2 = (a,b) => sq(a.x-b.x)+sq(a.y-b.y)+sq(a.z-b.z);
function randomGenerator(seed) {
  return function(){let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296};
}
export class VolumeModel {
  constructor(settings) {
    this.settings={...settings};
    this.seed=Number(settings.seed)||38127;
    this.rng=randomGenerator(this.seed);
    this.N=GRID;
    this.size=GRID*GRID*GRID;
    this.density=new Float32Array(this.size);
    this.demand=new Float32Array(this.size);
    this.oxygen=new Float32Array(this.size);
    this.bytes=new Uint8Array(this.size*4);
    this.nodes=[];this.edges=[];this.bridges=0;
    this.trees={artery:[],vein:[]};
    this.roots={};
    this.iteration=0;this.maxIterations=90;this.finished=false;
    this.coverage=0;this.perfused=0;this.livingVoxels=0;this.flowLoops=0;
    this.createTissue();
    this.createAttractors();
    this.initializeCirculation();
    this.evaluateOxygen(false);
  }
  rand(){return this.rng()}
  hash(x,y,z){
    let h=Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,2147483647)+Math.imul(this.seed,1274126177);
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967295;
  }
  noise(x,y,z) {
    const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z);
    const fx=smooth(x-xi),fy=smooth(y-yi),fz=smooth(z-zi);
    let a=mix(this.hash(xi,yi,zi),this.hash(xi+1,yi,zi),fx);
    let b=mix(this.hash(xi,yi+1,zi),this.hash(xi+1,yi+1,zi),fx);
    let c=mix(this.hash(xi,yi,zi+1),this.hash(xi+1,yi,zi+1),fx);
    let d=mix(this.hash(xi,yi+1,zi+1),this.hash(xi+1,yi+1,zi+1),fx);
    return mix(mix(a,b,fy),mix(c,d,fy),fz)*2-1;
  }
  shape(x,y,z) {
    const organic=this.noise(x*3.1+13,y*3.1+7,z*3.1+3)*.070+
      this.noise(x*6.3+3,y*6.3+8,z*6.3+11)*.025;
    const s=this.settings.organ;
    let core=0;
    if(s==='kidney'){
      let xx=x+.17*(1-y*y);
      core=1-Math.sqrt(sq(xx/.77)+sq(y/.92)+sq(z/.65));
      let notch=Math.exp(-(sq((x-.58)/.29)+sq((y+.01)/.34)+sq(z/.45)));
      core-=notch*.33;
    }else if(s==='liver'){
      let off=.14*x;
      core=1-Math.sqrt(sq(x/.94)+sq((y+off)/.67)+sq(z/(.69-.16*x)));
      core+=.08*Math.exp(-(sq((x+.44)/.37)+sq((y-.35)/.24)));
    }else if(s==='heart'){
      let taper=clamp(.75+.25*(y+.5),.46,1.13);
      core=1-Math.sqrt(sq(x/(.72*taper))+sq((y+.08)/.89)+sq(z/.68));
      let lobes=Math.max(Math.exp(-(sq((x-.34)/.35)+sq((y-.45)/.4)+sq(z/.5))),
        Math.exp(-(sq((x+.34)/.35)+sq((y-.45)/.4)+sq(z/.5))));
      core+=.20*lobes;
      core-=.12*Math.exp(-(sq(x/.20)+sq((y-.82)/.25)+sq(z/.38)));
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
    return core+organic;
  }
  index(ix,iy,iz){return (iz*this.N+iy)*this.N+ix}
  coords(p){
    return [clamp(Math.round((p.x*.5+.5)*(this.N-1)),0,this.N-1),
      clamp(Math.round((p.y*.5+.5)*(this.N-1)),0,this.N-1),
      clamp(Math.round((p.z*.5+.5)*(this.N-1)),0,this.N-1)];
  }
  voxel(p){const [x,y,z]=this.coords(p);return this.index(x,y,z)}
  inTissue(p){return this.density[this.voxel(p)]>.19}
  findInside(target){
    if(this.inTissue(target))return target;
    for(let i=1;i<30;i++){
      let a=i/30;
      let p=mul(target,1-a);
      if(this.inTissue(p))return p;
    }
    return {x:0,y:0,z:0};
  }
  createTissue(){
    let N=this.N,het=this.settings.heterogeneity/100;
    let count=0;
    for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      let px=x/(N-1)*2-1,py=y/(N-1)*2-1,pz=z/(N-1)*2-1;
      let margin=this.shape(px,py,pz),i=this.index(x,y,z);
      if(margin<0)continue;
      const fbm=.55*this.noise(px*7+13,py*7+4,pz*7+11)+
        .28*this.noise(px*15,py*15,pz*15)+.17*this.noise(px*28,py*28,pz*28);
      let cortex=.20*Math.exp(-sq((margin-.13)/.11));
      let fibres=.055*Math.sin(19*px+10*this.noise(py*5,pz*5,px*5));
      let base=.43+.23*smooth(clamp(margin*3.4,0,1))+cortex+fbm*(.13+.24*het)+fibres;
      if(this.settings.organ==='kidney'){
        let medullary=Math.sin(13*py+Math.atan2(pz,px)*7);
        base-=.16*Math.max(0,medullary)*(1-clamp(margin*1.8,0,1));
      }else if(this.settings.organ==='lung'){
        base-=.12*Math.max(0,Math.sin(px*24+py*19+pz*17));
      }else if(this.settings.organ==='heart'){
        base+=.11*Math.sin(Math.atan2(py,px)*8+16*pz);
      }else if(this.settings.organ==='liver'){
        base+=.06*Math.cos(px*15+py*13)*Math.sin(pz*11);
      }
      base*=smooth(clamp(margin*20,0,1))*.85+.15;
      this.density[i]=clamp(base,.16,.97);
      this.demand[i]=clamp(.43+this.density[i]*.45+het*(.16*fbm+.10*this.noise(px*10+11,py*10,pz*10)),.3,1);
      count++;
    }
    this.livingVoxels=count;
  }
  createAttractors(){
    this.attractors=[];
    const count=Math.round(300+this.settings.vascularity*5.2);
    let attempts=0;
    while(this.attractors.length<count && attempts<count*100){
      attempts++;
      const p={x:this.rand()*1.85-.925,y:this.rand()*1.9-.95,z:this.rand()*1.5-.75};
      const i=this.voxel(p);
      if(this.density[i]<.27||this.rand()>this.demand[i])continue;
      this.attractors.push({p,demand:this.demand[i],artery:false,vein:false});
    }
  }
  addNode(p,type,parent=-1){
    let id=this.nodes.length;
    let node={id,p,type,parent,children:[],r:.011,pressure:type==='artery'?.8:type==='vein'?.2:.5,out:[]};
    this.nodes.push(node);
    if(parent>=0){
      this.nodes[parent].children.push(id);
      let l=Math.sqrt(distance2(p,this.nodes[parent].p));
      this.edges.push({a:parent,b:id,type,len:Math.max(.0001,l),r:.011,flow:0});
    }
    if(type!=='capillary')this.trees[type].push(id);
    return id;
  }
  initializeCirculation(){
    for(let type of ['artery','vein']){
      let dir=type==='artery'?-1:1;
      let root=this.findInside({x:dir*.16,y:-.52,z:dir*.12});
      let last=this.addNode(root,type);
      this.roots[type]=last;
      for(let i=1;i<=12;i++){
        const p=this.findInside({x:dir*(.16-.03*i/12),y:-.52+i*.051,z:dir*.12});
        if(distance2(p,this.nodes[last].p)<.00025)continue;
        last=this.addNode(p,type,last);
      }
    }
  }
  growTree(type){
    const ids=this.trees[type],field=type;
    const limit=Math.round(470+this.settings.vascularity*9.0);
    if(ids.length>=limit)return 0;
    const accum=new Map();
    for(let a=0;a<this.attractors.length;a++){
      const target=this.attractors[a];
      if(target[field])continue;
      let best=-1,bestD=Infinity;
      for(let k=0;k<ids.length;k++){
        let id=ids[k],p=this.nodes[id].p;
        let d=sq(target.p.x-p.x)+sq(target.p.y-p.y)+sq(target.p.z-p.z);
        if(d<bestD){bestD=d;best=id}
      }
      if(bestD<.0049){target[field]=true;continue}
      if(bestD>.58*.58||best<0)continue;
      const p=this.nodes[best].p;
      const direction=norm(sub(target.p,p));
      let weight=target.demand/(.30+Math.sqrt(bestD));
      let acc=accum.get(best);
      if(!acc){acc={x:0,y:0,z:0,count:0};accum.set(best,acc)}
      acc.x+=direction.x*weight;acc.y+=direction.y*weight;acc.z+=direction.z*weight;acc.count++;
    }
    let generated=0;
    for(let [id,acc] of accum){
      if(ids.length>=limit||generated>=75)break;
      let parent=this.nodes[id];
      let ancestral=parent.parent>=0?norm(sub(parent.p,this.nodes[parent.parent].p)):{x:0,y:1,z:0};
      let target=norm(add(mul(norm(acc),.88),mul(ancestral,.20)));
      target=norm(add(target,{x:(this.rand()-.5)*.09,y:(this.rand()-.5)*.09,z:(this.rand()-.5)*.09}));
      const step=.037;
      let p=add(parent.p,mul(target,step));
      if(!this.inTissue(p)){
        let center=norm(mul(parent.p,-1));
        p=add(parent.p,mul(norm(add(mul(target,.25),mul(center,.75))),step));
        if(!this.inTissue(p))continue;
      }
      if(this.nearbyNode(p,ids,id,step*.56))continue;
      this.addNode(p,type,id);generated++;
      if(acc.count>=7&&this.rand()<.10&&ids.length<limit){
        let tangent=norm({x:target.y-target.z,y:target.z-target.x,z:target.x-target.y});
        let alternate=norm(add(mul(target,.44),mul(tangent,this.rand()<.5?1:-1)));
        let q=add(parent.p,mul(alternate,step));
        if(this.inTissue(q)&&!this.nearbyNode(q,ids,id,step*.7)){
          this.addNode(q,type,id);generated++;
        }
      }
    }
    return generated;
  }
  nearbyNode(p,ids,except,range){
    let rr=range*range;
    for(let k=0;k<ids.length;k++){
      let id=ids[k];
      if(id!==except&&distance2(p,this.nodes[id].p)<rr)return true;
    }
    return false;
  }
  step(){
    if(this.finished)return false;
    this.growTree('artery');this.growTree('vein');
    this.iteration++;
    if(this.iteration>=this.maxIterations)this.finish();
    return !this.finished;
  }
  assignRadii(){
    for(let type of ['artery','vein']){
      let ids=this.trees[type],weights=new Float32Array(this.nodes.length);
      for(let k=ids.length-1;k>=0;k--){
        let n=this.nodes[ids[k]],weight=0;
        for(let child of n.children)if(this.nodes[child].type===type)weight+=weights[child];
        weights[n.id]=Math.max(1,weight);
        n.r=clamp(.0075+.007*Math.pow(weights[n.id],.37),.009,.067);
      }
    }
    for(let e of this.edges){
      if(e.type!=='capillary')e.r=(this.nodes[e.a].r+this.nodes[e.b].r)*.5;
    }
  }
  findLeaves(type){
    return this.trees[type].filter(id=>this.nodes[id].children.length===0);
  }
  addCapillaryBridge(a,b){
    const start=this.nodes[a].p,end=this.nodes[b].p;
    let last=a,steps=3+Math.floor(Math.sqrt(distance2(start,end))*5);
    for(let i=1;i<steps;i++){
      let t=i/steps;
      let p=add(mul(start,1-t),mul(end,t));
      p.x+=(this.rand()-.5)*.015;p.y+=(this.rand()-.5)*.015;p.z+=(this.rand()-.5)*.015;
      if(!this.inTissue(p))p=this.findInside(mul(p,.83));
      last=this.addNode(p,'capillary',last);
    }
    let edge=this.edges.length;
    let id=last;
    const l=Math.sqrt(distance2(this.nodes[id].p,end));
    this.edges.push({a:id,b,type:'capillary',len:Math.max(.005,l),r:.010,flow:0});
    for(let i=edge-steps+2;i<this.edges.length;i++)if(this.edges[i])this.edges[i].r=.010;
    this.bridges++;
  }
  connectCapillaries(){
    const A=this.findLeaves('artery'),V=this.findLeaves('vein');
    if(!A.length||!V.length)return;
    // Connect nearby terminal beds. Repeated bridges create true circuits, not dead-end tubes.
    const shuffled=A.slice().sort(()=>this.rand()-.5);
    const aim=Math.min(140,Math.max(32,Math.round(this.settings.vascularity*1.05)));
    const n=Math.min(aim,shuffled.length);
    let used=new Set();
    for(let i=0;i<n;i++){
      const a=shuffled[Math.floor(i*shuffled.length/n)];
      let best=-1,bestD=Infinity;
      for(let vid of V){
        let d=distance2(this.nodes[a].p,this.nodes[vid].p);
        // Gently favor evenly distributed drainage into return branches.
        if(used.has(vid))d*=1.1;
        if(d<bestD){bestD=d;best=vid}
      }
      if(best>=0){this.addCapillaryBridge(a,best);used.add(best)}
    }
    // Guarantee at least a few vascular connections even in an extremely small tree.
    while(this.bridges<Math.min(12,A.length)){
      this.addCapillaryBridge(A[this.bridges%A.length],V[this.bridges%V.length]);
    }
  }
  solveFlow(){
    let adj=this.nodes.map(()=>[]),maxC=0;
    for(let e of this.edges){
      e.conductance=Math.pow(e.r,4)/Math.max(.012,e.len);
      maxC=Math.max(maxC,e.conductance);
    }
    const scale=maxC?1/maxC:1;
    for(let i=0;i<this.edges.length;i++){
      let e=this.edges[i];e.conductance*=scale;
      adj[e.a].push({id:i,other:e.b,g:e.conductance});
      adj[e.b].push({id:i,other:e.a,g:e.conductance});
    }
    const arterialRoot=this.roots.artery,venousRoot=this.roots.vein;
    this.nodes[arterialRoot].pressure=1;this.nodes[venousRoot].pressure=0;
    for(let iter=0;iter<700;iter++){
      let change=0;
      for(let i=0;i<this.nodes.length;i++){
        if(i===arterialRoot||i===venousRoot)continue;
        let node=this.nodes[i],links=adj[i];
        let g=0,target=0;
        for(let j=0;j<links.length;j++){
          let item=links[j];g+=item.g;target+=item.g*this.nodes[item.other].pressure;
        }
        if(g>0){
          let p=clamp(node.pressure+(target/g-node.pressure)*1.35,0,1);
          change=Math.max(change,Math.abs(p-node.pressure));node.pressure=p;
        }
      }
      if(iter>75&&change<.000015)break;
    }
    let maximum=0;
    for(let i=0;i<this.edges.length;i++){
      let e=this.edges[i];
      e.flow=e.conductance*(this.nodes[e.a].pressure-this.nodes[e.b].pressure);
      maximum=Math.max(maximum,Math.abs(e.flow));
    }
    for(let n of this.nodes)n.out=[];
    for(let i=0;i<this.edges.length;i++){
      const e=this.edges[i];if(Math.abs(e.flow)<maximum*1e-9)continue;
      let from=e.flow>=0?e.a:e.b,to=e.flow>=0?e.b:e.a;
      this.nodes[from].out.push({edge:i,to,weight:Math.abs(e.flow)});
    }
    this.maxFlow=maximum;
    // One connected arterial tree and one connected venous tree joined by bridges:
    // each additional artery -> vein bridge adds an independent closed circuit.
    this.flowLoops=Math.max(0,this.edges.length-this.nodes.length+1);
  }
  // Oxygen-deficit feedback pass: sample unsupplied tissue voxels (rather than
  // just the initial attractors), then add connected capillary supply/return paths.
  // This reinforces the network until the requested tissue is actually served.
  rescueOxygen(){
    const N=this.N;
    const dist2=(a,b)=>sq(a.x-b.x)+sq(a.y-b.y)+sq(a.z-b.z);
    const nearest=(type,p)=>{
      let best=-1,bestD=Infinity;
      for(let id of this.trees[type]){
        let d=dist2(this.nodes[id].p,p);
        if(d<bestD){best=id;bestD=d}
      }
      return best;
    };
    const bridgeThrough=target=>{
      const a=nearest('artery',target),b=nearest('vein',target);
      if(a<0||b<0)return;
      const start=this.nodes[a].p,end=this.nodes[b].p;
      let previous=a;
      for(let [p,q] of [[start,target],[target,end]]){
        const steps=Math.max(1,Math.ceil(Math.sqrt(dist2(p,q))/.050));
        for(let k=1;k<=steps;k++){
          const t=k/steps;
          let next={x:mix(p.x,q.x,t),y:mix(p.y,q.y,t),z:mix(p.z,q.z,t)};
          if(!this.inTissue(next))next=this.findInside(next);
          if(p===target&&k===steps){
            this.edges.push({a:previous,b,type:'capillary',len:Math.max(.005,Math.sqrt(dist2(this.nodes[previous].p,end))),r:.010,flow:0});
          }else previous=this.addNode(next,'capillary',previous);
        }
      }
      this.bridges++;
    };
    const previousTargets=[];
    for(let pass=0;pass<7&&this.coverage<97;pass++){
      const deprived=[];
      for(let z=1;z<N-1;z+=2)for(let y=1;y<N-1;y+=2)for(let x=1;x<N-1;x+=2){
        let i=this.index(x,y,z);
        if(this.density[i]<.19)continue;
        const deficit=this.demand[i]*.58-this.oxygen[i];
        if(deficit<=0)continue;
        deprived.push({p:{x:x/(N-1)*2-1,y:y/(N-1)*2-1,z:z/(N-1)*2-1},deficit});
      }
      deprived.sort((a,b)=>b.deficit-a.deficit);
      let chosen=[];
      for(let a of deprived){
        if(chosen.length>=36)break;
        if(chosen.some(p=>dist2(p,a.p)<sq(.13)))continue;
        if(previousTargets.some(p=>dist2(p,a.p)<sq(.10)))continue;
        chosen.push(a.p);
        bridgeThrough(a.p);
      }
      if(!chosen.length)break;
      previousTargets.push(...chosen);
      this.solveFlow();
      this.evaluateOxygen(true);
    }
  }
  finish(){
    if(this.finished)return;
    this.assignRadii();
    this.connectCapillaries();
    this.solveFlow();
    this.evaluateOxygen(true);
    this.rescueOxygen();
    this.finished=true;
  }
  evaluateOxygen(perfused){
    const N=this.N,size=this.size,dist=new Float32Array(size);
    dist.fill(999);
    let capMaximum=0;
    for(let e of this.edges)if(e.type==='capillary')capMaximum=Math.max(capMaximum,Math.abs(e.flow));
    for(let e of this.edges){
      if(e.type==='vein')continue;
      if(perfused&&e.type==='capillary'&&Math.abs(e.flow)<capMaximum*.0001)continue;
      const a=this.nodes[e.a].p,b=this.nodes[e.b].p;
      let steps=Math.max(1,Math.ceil(e.len*(N-1)*.9));
      let initial=e.type==='artery'?2.2:0;
      for(let k=0;k<=steps;k++){
        const t=k/steps;
        let x=clamp(Math.round((mix(a.x,b.x,t)*.5+.5)*(N-1)),0,N-1);
        let y=clamp(Math.round((mix(a.y,b.y,t)*.5+.5)*(N-1)),0,N-1);
        let z=clamp(Math.round((mix(a.z,b.z,t)*.5+.5)*(N-1)),0,N-1);
        let i=this.index(x,y,z);
        if(this.density[i]>.08)dist[i]=Math.min(dist[i],initial);
      }
    }
    const slice=N*N;
    // Two directional voxel-neighborhood sweeps propagate the shortest Manhattan
    // transport distance from perfused segments through the volume texture.
    for(let z=0;z<N;z++)for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      let i=this.index(x,y,z),d=dist[i];
      if(x)d=Math.min(d,dist[i-1]+1);
      if(y)d=Math.min(d,dist[i-N]+1);
      if(z)d=Math.min(d,dist[i-slice]+1);
      dist[i]=d;
    }
    for(let z=N-1;z>=0;z--)for(let y=N-1;y>=0;y--)for(let x=N-1;x>=0;x--){
      let i=this.index(x,y,z),d=dist[i];
      if(x<N-1)d=Math.min(d,dist[i+1]+1);
      if(y<N-1)d=Math.min(d,dist[i+N]+1);
      if(z<N-1)d=Math.min(d,dist[i+slice]+1);
      dist[i]=d;
    }
    let range=3.3+this.settings.reach*.107,good=0,received=0;
    for(let i=0;i<size;i++){
      if(this.density[i]===0){this.oxygen[i]=0;continue}
      const d=dist[i];
      const O=clamp((1-d/range)*1.17-this.demand[i]*.14,0,1);
      this.oxygen[i]=O;
      if(O>=this.demand[i]*.54)good++;
      if(O>.25)received++;
    }
    this.coverage=this.livingVoxels?100*good/this.livingVoxels:0;
    this.perfused=this.livingVoxels?100*received/this.livingVoxels:0;
    for(let i=0;i<size;i++){
      const j=i*4;
      this.bytes[j]=Math.round(this.density[i]*255);
      this.bytes[j+1]=Math.round(this.oxygen[i]*255);
      this.bytes[j+2]=Math.round(clamp((3.5-dist[i])/3.5,0,1)*255);
      this.bytes[j+3]=this.density[i]>0?255:0;
    }
  }
  edgeCount(type){return this.edges.reduce((a,e)=>a+(e.type===type?1:0),0)}
  pickNext(nodeId){
    const choices=this.nodes[nodeId].out;
    if(!choices.length)return null;
    let sum=0;
    for(let i=0;i<choices.length;i++)sum+=Math.sqrt(choices[i].weight);
    let sample=this.rand()*sum;
    for(let i=0;i<choices.length;i++){
      let c=choices[i];sample-=Math.sqrt(c.weight);
      if(sample<=0)return c;
    }
    return choices[choices.length-1];
  }
}
