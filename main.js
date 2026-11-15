import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VolumeModel, GRID} from './simulation.js';

const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let model=null,volumeTexture=null,playing=true,growthAccumulator=0,generationId=0;
let lastTime=performance.now(),mode=0;
const settings={organ:'kidney',seed:38127,vascularity:72,heterogeneity:58,reach:65,speed:2};

const wrap=$('canvasWrap');
let renderer,scene,camera,controls,volumeMesh,vascularGroup,tracerPoints,tracers=[];
let arteryMesh=null,veinMesh=null,capillaryMesh=null;
const clippingPlane=new THREE.Plane(new THREE.Vector3(0,0,-1),1);
const clock=new THREE.Clock();
const vec=new THREE.Vector3();
const eye=new THREE.Vector3();

const vertexShader=[
  'out vec3 vPosition;',
  'void main(){',
  'vPosition=position;',
  'gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);',
  '}'
].join('\n');
const fragmentShader=[
  'precision highp float;',
  'precision highp sampler3D;',
  'in vec3 vPosition;',
  'out vec4 fragColor;',
  'uniform sampler3D uVolume;',
  'uniform vec3 uEye;',
  'uniform float uThreshold;',
  'uniform float uOpacity;',
  'uniform float uClip;',
  'uniform float uTime;',
  'uniform int uMode;',
  'void main(){',
  'vec3 dir=normalize(vPosition-uEye);',
  'vec3 inv=1.0/dir;',
  'vec3 t0=(-vec3(1.0)-uEye)*inv;',
  'vec3 t1=( vec3(1.0)-uEye)*inv;',
  'vec3 nearT=min(t0,t1);',
  'vec3 farT=max(t0,t1);',
  'float enter=max(0.0,max(max(nearT.x,nearT.y),nearT.z));',
  'float leave=min(min(farT.x,farT.y),farT.z);',
  'if(leave<enter)discard;',
  'vec4 result=vec4(0.0);',
  'float stepSize=0.020;',
  'float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);',
  'float t=enter+stepSize*jitter;',
  'for(int i=0;i<150;i++){',
  'if(t>leave||result.a>.985)break;',
  'vec3 p=uEye+t*dir;',
  't+=stepSize;',
  'if(p.z>uClip)continue;',
  'vec3 uv=clamp((p+1.0)*.5,vec3(.001),vec3(.999));',
  'vec4 sampleValue=texture(uVolume,uv);',
  'float d=sampleValue.r;',
  'float presence=smoothstep(uThreshold-.012,uThreshold+.05,d);',
  'if(presence<.008||sampleValue.a<.01)continue;',
  'float oxygen=sampleValue.g;',
  'float cortex=smoothstep(.62,.92,d);',
  'vec3 colour=vec3(.30,.45,.46)+vec3(.40,.43,.39)*d+vec3(.25,.23,.17)*cortex;',
  'float strength=(.015+.09*presence)*uOpacity;',
  'if(uMode==1){',
  'vec3 deficient=vec3(.91,.32,.28);',
  'vec3 supplied=vec3(.22,.83,.65);',
  'colour=mix(deficient,supplied,smoothstep(.12,.8,oxygen))*(.60+.45*d);',
  'strength*=1.30;',
  '}else if(uMode==2){',
  'colour=mix(vec3(.33,.29,.29),vec3(.98,.76,.65),d);',
  'colour=mix(colour,vec3(.97,.91,.76),cortex*.30);',
  'strength*=1.12;',
  '}else{',
  'colour+=.06*sin(uTime*.3+d*37.0);',
  '}',
  'float a=clamp(strength*presence,0.0,.22);',
  'result.rgb+=(1.0-result.a)*colour*a;',
  'result.a+=(1.0-result.a)*a;',
  '}',
  'if(result.a<.004)discard;',
  'fragColor=vec4(result.rgb,result.a);',
  '}'
].join('\n');

const uniforms={
  uVolume:{value:null},uEye:{value:new THREE.Vector3(0,0,3)},
  uThreshold:{value:.32},uOpacity:{value:.46},uClip:{value:1},
  uTime:{value:0},uMode:{value:0}
};
const materials={
  artery:new THREE.MeshPhongMaterial({color:0xe87e6c,emissive:0x7c201b,emissiveIntensity:.32,shininess:95,side:THREE.DoubleSide,clippingPlanes:[clippingPlane]}),
  vein:new THREE.MeshPhongMaterial({color:0x6bb3d9,emissive:0x183f69,emissiveIntensity:.45,shininess:100,side:THREE.DoubleSide,clippingPlanes:[clippingPlane]}),
  capillary:new THREE.MeshPhongMaterial({color:0xe4bfa1,emissive:0x73523f,emissiveIntensity:.27,shininess:110,transparent:true,opacity:.79,side:THREE.DoubleSide,clippingPlanes:[clippingPlane]})
};
const visibleControls={artery:'showArteries',vein:'showVeins',capillary:'showCapillaries'};

function initViewer(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  }catch(error){
    showError('WebGL2 is required to render the 3D tissue volume. '+error.message);
    return false;
  }
  if(!renderer.capabilities.isWebGL2){
    showError('This viewer requires WebGL2 and 3D textures. Try a current browser with hardware acceleration.');
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.35));
  renderer.setSize(wrap.clientWidth,wrap.clientHeight);
  renderer.setClearColor(0x0b151e,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.2;
  renderer.localClippingEnabled=true;
  wrap.appendChild(renderer.domElement);
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(43,wrap.clientWidth/Math.max(1,wrap.clientHeight),.05,100);
  camera.position.set(2.70,1.25,3.30);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.062;
  controls.minDistance=1.55;controls.maxDistance=9;
  controls.target.set(0,0,0);
  controls.update();
  scene.add(new THREE.AmbientLight(0xd7f0eb,1.5));
  const key=new THREE.DirectionalLight(0xffffff,3.0);key.position.set(3,5,6);scene.add(key);
  const rim=new THREE.DirectionalLight(0x62b9d5,2.5);rim.position.set(-3,-2,-4);scene.add(rim);
  const fill=new THREE.DirectionalLight(0xffb49d,.9);fill.position.set(-3,3,2);scene.add(fill);
  volumeMesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),
    new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,glslVersion:THREE.GLSL3,
      side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false}));
  volumeMesh.renderOrder=1;
  volumeMesh.frustumCulled=false;
  scene.add(volumeMesh);
  vascularGroup=new THREE.Group();
  vascularGroup.renderOrder=3;
  scene.add(vascularGroup);
  const ghost=new THREE.BoxGeometry(2.02,2.02,2.02);
  const ghostMesh=new THREE.LineSegments(
    new THREE.EdgesGeometry(ghost),
    new THREE.LineBasicMaterial({color:0x305460,transparent:true,opacity:.13,depthWrite:false})
  );
  scene.add(ghostMesh);
  const axes=new THREE.Group();
  for(let a of [[-1.06,-1.05,-1.06,-.83,-1.05,-1.06],[-1.06,-1.05,-1.06,-1.06,-.82,-1.06],[-1.06,-1.05,-1.06,-1.06,-1.05,-.83]]){
    let g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0],a[1],a[2]),new THREE.Vector3(a[3],a[4],a[5])]);
    axes.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:0x5d8b8d,transparent:true,opacity:.7})));
  }
  scene.add(axes);
  initTracers();
  const resize=new ResizeObserver(()=>resizeViewer());
  resize.observe(wrap);
  window.addEventListener('resize',resizeViewer);
  requestAnimationFrame(animate);
  return true;
}
function resizeViewer(){
  if(!renderer)return;
  const w=Math.max(1,wrap.clientWidth),h=Math.max(1,wrap.clientHeight);
  camera.aspect=w/h;camera.updateProjectionMatrix();
  renderer.setSize(w,h);
}
function showError(message){
  $('loading').classList.remove('hidden');
  $('loadingTitle').textContent='Unable to initialize';
  $('loadingText').textContent=message;
  $('status').textContent='Viewer unavailable';
}
function initTracers(){
  const count=180;
  let g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
  g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(count*3),3));
  tracerPoints=new THREE.Points(g,new THREE.PointsMaterial({
    size:.038,vertexColors:true,transparent:true,opacity:.94,
    depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true,
    clippingPlanes:[clippingPlane]
  }));
  tracerPoints.renderOrder=5;
  tracerPoints.frustumCulled=false;
  tracerPoints.visible=false;
  scene.add(tracerPoints);
}
function updateVolume(){
  if(!model)return;
  if(!volumeTexture){
    volumeTexture=new THREE.Data3DTexture(model.bytes,GRID,GRID,GRID);
    volumeTexture.format=THREE.RGBAFormat;
    volumeTexture.type=THREE.UnsignedByteType;
    volumeTexture.minFilter=THREE.LinearFilter;
    volumeTexture.magFilter=THREE.LinearFilter;
    volumeTexture.unpackAlignment=1;
    volumeTexture.generateMipmaps=false;
    uniforms.uVolume.value=volumeTexture;
  }else{
    // Data3DTexture retains its original data reference unless explicitly replaced.
    volumeTexture.image.data=model.bytes;
  }
  volumeTexture.needsUpdate=true;
}
function tubeGeometry(type){
  const verts=[],normals=[],indices=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3();
  const direction=new THREE.Vector3(),tangent=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3();
  const sides=6;
  let count=0;
  for(let e of model.edges){
    if(e.type!==type||e.len<.00001)continue;
    let p=model.nodes[e.a].p,q=model.nodes[e.b].p;
    a.set(p.x,p.y,p.z);b.set(q.x,q.y,q.z);
    direction.subVectors(b,a).normalize();
    tangent.set(Math.abs(direction.y)<.88?0:1,Math.abs(direction.y)<.88?1:0,0);
    u.crossVectors(direction,tangent).normalize();
    v.crossVectors(direction,u).normalize();
    const r0=type==='capillary'?.0105:model.nodes[e.a].r;
    const r1=type==='capillary'?.0105:model.nodes[e.b].r;
    for(let ring=0;ring<2;ring++){
      const center=ring===0?a:b,r=ring===0?r0:r1;
      for(let j=0;j<=sides;j++){
        let angle=j/sides*Math.PI*2;
        let nx=u.x*Math.cos(angle)+v.x*Math.sin(angle);
        let ny=u.y*Math.cos(angle)+v.y*Math.sin(angle);
        let nz=u.z*Math.cos(angle)+v.z*Math.sin(angle);
        verts.push(center.x+nx*r,center.y+ny*r,center.z+nz*r);
        normals.push(nx,ny,nz);
      }
    }
    const base=count*(sides+1)*2;
    for(let j=0;j<sides;j++){
      const n=base+j,m=base+sides+1+j;
      indices.push(n,m,n+1,n+1,m,m+1);
    }
    count++;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}
function updateVessels(){
  if(!model)return;
  for(let type of ['artery','vein','capillary']){
    const previous=type==='artery'?arteryMesh:type==='vein'?veinMesh:capillaryMesh;
    if(previous){vascularGroup.remove(previous);previous.geometry.dispose()}
    const mesh=new THREE.Mesh(tubeGeometry(type),materials[type]);
    mesh.frustumCulled=false;mesh.renderOrder=type==='capillary'?3:4;
    mesh.visible=$(visibleControls[type]).checked;
    vascularGroup.add(mesh);
    if(type==='artery')arteryMesh=mesh;
    if(type==='vein')veinMesh=mesh;
    if(type==='capillary')capillaryMesh=mesh;
  }
}
function resetTracers(){
  if(!model||!model.finished)return;
  tracers=[];
  const count=tracerPoints.geometry.getAttribute('position').count;
  for(let i=0;i<count;i++){
    let p={from:model.roots.artery,to:0,edge:0,t:0,speed:.19+model.rand()*.22};
    rewindTracer(p);
    // Pre-fill the path at different travel stages for immediate visible circulation.
    for(let k=0;k<Math.floor(model.rand()*50);k++){
      const e=model.edges[p.edge];
      if(!e)break;
      p.t+=.33;
      if(p.t>=1)advanceTracer(p);
    }
    tracers.push(p);
  }
  tracerPoints.visible=$('showTracers').checked;
}
function rewindTracer(p){
  p.from=model.roots.artery;
  let c=model.pickNext(p.from);
  if(!c){p.edge=-1;p.to=p.from;p.t=0;return}
  p.edge=c.edge;p.to=c.to;p.t=model.rand()*.3;
}
function advanceTracer(p){
  if(p.to===model.roots.vein){rewindTracer(p);return}
  const next=model.pickNext(p.to);
  if(!next){rewindTracer(p);return}
  p.from=p.to;p.to=next.to;p.edge=next.edge;p.t=0;
}
function animateTracers(dt){
  if(!tracers.length||!tracerPoints.visible||!playing)return;
  let positions=tracerPoints.geometry.attributes.position;
  let colours=tracerPoints.geometry.attributes.color;
  for(let i=0;i<tracers.length;i++){
    let p=tracers[i],e=model.edges[p.edge];
    if(!e)continue;
    p.t+=p.speed*dt/Math.max(.017,e.len);
    let hops=0;
    while(p.t>=1&&hops++<8){p.t-=1;advanceTracer(p);e=model.edges[p.edge];if(!e)break}
    if(!e)continue;
    const a=model.nodes[p.from].p,b=model.nodes[p.to].p;
    positions.setXYZ(i,a.x+(b.x-a.x)*p.t,a.y+(b.y-a.y)*p.t,a.z+(b.z-a.z)*p.t);
    if(e.type==='artery')colours.setXYZ(i,1,.75,.5);
    else if(e.type==='vein')colours.setXYZ(i,.48,.84,1);
    else colours.setXYZ(i,1,1,.78);
  }
  positions.needsUpdate=true;colours.needsUpdate=true;
}
function paintProgress(){
  if(!model)return;
  const percent=model.finished?100:Math.round(model.iteration/model.maxIterations*100);
  $('growthFill').style.width=percent+'%';
  $('growthPercent').textContent=percent+'%';
}
function updateStats(){
  if(!model)return;
  $('coverage').textContent=model.coverage.toFixed(1);
  $('coverageFill').style.width=model.coverage.toFixed(1)+'%';
  $('coverageState').textContent=model.coverage>=80?'WELL SUPPLIED':model.coverage>=50?'PATCHY':'OXYGEN DEFICIT';
  $('segments').textContent=model.edges.length.toLocaleString('en-US');
  $('connections').textContent=model.bridges.toLocaleString('en-US');
  $('flowloops').textContent=model.finished?model.flowLoops.toLocaleString('en-US'):'—';
  $('perfused').textContent=model.perfused.toFixed(0)+'%';
  if(model.finished){
    $('status').textContent='Perfused network established';
    $('networkState').textContent='Circulation connected';
    $('networkDescription').textContent=model.bridges+' capillary bridges create closed supply-and-return paths; flow follows computed pressure gradients.';
  }else{
    $('status').textContent='Angiogenic sprouts propagating';
    $('networkState').textContent='Sprouting / neighborhood growth';
    $('networkDescription').textContent='New vessel branches move toward unserved oxygen-demand attractors.';
  }
  paintProgress();
}
function applyVisibility(){
  if(volumeMesh)volumeMesh.visible=$('showVolume').checked;
  for(let type of ['artery','vein','capillary']){
    let m=type==='artery'?arteryMesh:type==='vein'?veinMesh:capillaryMesh;
    if(m)m.visible=$(visibleControls[type]).checked;
  }
  if(tracerPoints)tracerPoints.visible=Boolean(model&&model.finished&&$('showTracers').checked);
}
function animate(time){
  requestAnimationFrame(animate);
  if(!renderer)return;
  let dt=Math.min(.06,Math.max(0,(time-lastTime)/1000));lastTime=time;
  if(model&&playing&&!model.finished){
    growthAccumulator+=dt*(3+settings.speed*5.5);
    let n=0;
    while(growthAccumulator>=1&&n<5&&!model.finished){
      growthAccumulator-=1;n++;
      model.step();
      if(model.iteration%6===0||model.finished)updateVessels();
      if(model.iteration%12===0&&!model.finished){
        model.evaluateOxygen(false);updateVolume();updateStats();
      }
      if(model.finished){
        updateVessels();updateVolume();resetTracers();applyVisibility();updateStats();
        break;
      }
    }
    paintProgress();
  }
  if(model)animateTracers(dt);
  uniforms.uEye.value.copy(camera.position);
  uniforms.uTime.value=time*.001;
  controls.update();
  renderer.render(scene,camera);
}
function beginGeneration(){
  if(!renderer)return;
  const id=++generationId;
  playing=true;growthAccumulator=0;
  $('playPause').textContent='Ⅱ Pause';
  $('loadingTitle').textContent='Seeding the tissue volume';
  $('loadingText').textContent='Computing local densities and metabolic demand';
  $('loading').classList.remove('hidden');
  $('regenerate').disabled=true;
  // Yield so the new loading state is painted before allocating the volume.
  requestAnimationFrame(()=>{
    setTimeout(()=>{
      if(id!==generationId)return;
      try{
        const next=new VolumeModel({...settings});
        model=next;
        $('specimenName').textContent=settings.organ.toUpperCase()+' / SPECIMEN '+settings.seed;
        $('resLabel').textContent=GRID+'³ VOXELS';
        updateVolume();
        updateVessels();
        tracers=[];
        applyVisibility();
        updateStats();
        $('loading').classList.add('hidden');
      }catch(error){
        console.error(error);
        showError('Generation failed: '+error.message);
      }finally{$('regenerate').disabled=false}
    },18);
  });
}
function setMode(next){
  mode=next;uniforms.uMode.value=mode;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',Number(['mri','oxygen','structure'].indexOf(b.dataset.mode))===mode));
  $('renderMode').textContent=['DENSITY / MRI','PERFUSION / OXYGEN','TISSUE / ANATOMY'][mode];
}
function bindSlider(id,output,render,apply){
  const slider=$(id);
  const update=()=>{
    let n=Number(slider.value);
    slider.style.setProperty('--percent',((n-Number(slider.min))/(Number(slider.max)-Number(slider.min))*100)+'%');
    $(output).textContent=render(n);
    if(apply)apply(n);
  };
  slider.addEventListener('input',update);
  update();
}
function bindUI(){
  bindSlider('vascularity','vascularityValue',n=>n+'%',n=>settings.vascularity=n);
  bindSlider('heterogeneity','heterogeneityValue',n=>n+'%',n=>settings.heterogeneity=n);
  bindSlider('reach','reachValue',n=>n+'%',n=>{
    settings.reach=n;
    if(model){model.settings.reach=n;model.evaluateOxygen(model.finished);updateVolume();updateStats()}
  });
  bindSlider('speed','speedValue',n=>n+'×',n=>settings.speed=n);
  bindSlider('threshold','thresholdValue',n=>(n/100).toFixed(2),n=>uniforms.uThreshold.value=n/100);
  bindSlider('opacity','opacityValue',n=>n+'%',n=>uniforms.uOpacity.value=n/100);
  bindSlider('slice','sliceValue',n=>n+'%',n=>{
    uniforms.uClip.value=n/50-1;
    clippingPlane.constant=n/50-1;
  });
  $('organ').addEventListener('change',()=>{
    settings.organ=$('organ').value;beginGeneration();
  });
  $('seed').addEventListener('change',()=>{
    settings.seed=clamp(Math.floor(Number($('seed').value))||1,1,999999);
    $('seed').value=settings.seed;beginGeneration();
  });
  $('vascularity').addEventListener('change',beginGeneration);
  $('heterogeneity').addEventListener('change',beginGeneration);
  $('regenerate').addEventListener('click',beginGeneration);
  $('restart').addEventListener('click',beginGeneration);
  $('randomize').addEventListener('click',()=>{
    settings.seed=1+Math.floor(Math.random()*999998);
    $('seed').value=settings.seed;beginGeneration();
  });
  $('playPause').addEventListener('click',()=>{
    playing=!playing;
    $('playPause').textContent=playing?'Ⅱ Pause':'▷ Play';
    $('status').textContent=playing?'Simulation active':'Simulation paused';
  });
  for(let id of ['showVolume','showArteries','showVeins','showCapillaries','showTracers']){
    $(id).addEventListener('change',applyVisibility);
  }
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(['mri','oxygen','structure'].indexOf(b.dataset.mode))));
  $('resetView').addEventListener('click',()=>{
    camera.position.set(2.70,1.25,3.30);controls.target.set(0,0,0);controls.update();
  });
  $('screenshot').addEventListener('click',()=>{
    renderer.render(scene,camera);
    const canvas=document.createElement('canvas');
    canvas.width=renderer.domElement.width;canvas.height=renderer.domElement.height;
    let ctx=canvas.getContext('2d');
    ctx.fillStyle='#0b151e';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(renderer.domElement,0,0);
    let link=document.createElement('a');
    link.download='procedural-volume-'+settings.organ+'-'+settings.seed+'.png';
    link.href=canvas.toDataURL('image/png');link.click();
  });
  window.addEventListener('keydown',e=>{
    const tag=document.activeElement?.tagName||'';
    if(e.key.toLowerCase()==='g'&&!['INPUT','SELECT','TEXTAREA'].includes(tag)){
      beginGeneration();
    }
  });
  setMode(0);
}
bindUI();
if(initViewer())beginGeneration();
