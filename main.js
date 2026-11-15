import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {VolumeModel, GRID} from './simulation.js';
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=$('canvasWrap');
const settings={organ:'kidney',seed:38127,vascularity:72,heterogeneity:58,reach:65,speed:2,viscosity:40};
let model=null,renderer=null,scene=null,camera=null,controls=null,mesh=null;
let fieldTex=null,classTex=null,flowTex=null;
let playing=true,lastTime=performance.now(),growthTime=0,fluidTime=0,telemetryTime=0,generation=0;
const vertexShader="out vec3 vPosition;\nvoid main(){\n vPosition=position;\n gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);\n}";
const fragmentShader="precision highp float;\nprecision highp sampler3D;\nin vec3 vPosition;\nout vec4 fragColor;\nuniform sampler3D uField;\nuniform sampler3D uClasses;\nuniform sampler3D uFlow;\nuniform vec3 uEye;\nuniform float uThreshold;\nuniform float uOpacity;\nuniform float uClip;\nuniform int uMode;\nuniform bool uShowTissue;\nuniform bool uShowArtery;\nuniform bool uShowVein;\nuniform bool uShowCapillary;\nuniform bool uShowDye;\nvoid main(){\n vec3 direction=normalize(vPosition-uEye);\n vec3 inv=1.0/direction;\n vec3 t0=(-vec3(1.0)-uEye)*inv;\n vec3 t1=(vec3(1.0)-uEye)*inv;\n vec3 nearT=min(t0,t1),farT=max(t0,t1);\n float entry=max(0.0,max(max(nearT.x,nearT.y),nearT.z));\n float exitT=min(min(farT.x,farT.y),farT.z);\n if(exitT<=entry)discard;\n vec4 accum=vec4(0.0);\n float stepLength=0.0205;\n float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);\n float t=entry+stepLength*jitter;\n for(int k=0;k<148;k++){\n  if(t>exitT||accum.a>.992)break;\n  vec3 p=uEye+t*direction;\n  t+=stepLength;\n  if(p.z>uClip)continue;\n  vec3 uv=clamp((p+1.0)*.5,vec3(.002),vec3(.998));\n  float material=floor(texture(uClasses,uv).r*255.0+.5);\n  if(material<.5)continue;\n  bool fluid=material>2.5&&material<5.5;\n  if(fluid&&((material<3.5&&!uShowArtery)||\n     (material>3.5&&material<4.5&&!uShowVein)||\n     (material>4.5&&!uShowCapillary)))continue;\n  if(!fluid&&!uShowTissue)continue;\n  vec4 f=texture(uField,uv);\n  float density=f.r;\n  float threshold=smoothstep(uThreshold-.018,uThreshold+.045,density);\n  if(threshold<.008)continue;\n  vec4 flow=texture(uFlow,uv);\n  float o2=f.g,dye=f.a,pressure=flow.a;\n  vec3 velocity=flow.rgb*2.0-1.0;\n  float speed=length(velocity);\n  float alpha=.014+.032*density;\n  vec3 color=vec3(.38,.49,.50)+density*vec3(.39,.37,.32);\n  if(material>1.5&&material<2.5)color+=vec3(.10,.08,.07);\n  if(material>5.5){color=vec3(.84,.77,.68);alpha*=1.28;}\n  if(fluid){\n   alpha=.21;\n   color=material<3.5?vec3(.94,.38,.29):\n        material<4.5?vec3(.28,.63,.86):vec3(1.0,.75,.52);\n   color*=.68+.26*o2;\n  }\n  if(uMode==0){\n   if(!fluid)color=mix(vec3(.23,.34,.40),vec3(.95,.96,.90),density);\n   else color=mix(vec3(.64,.72,.73),color,.63);\n   if(material>5.5)color=vec3(.95,.93,.86);\n  } else if(uMode==1){\n   float viability=smoothstep(.10,.80,o2);\n   color=mix(vec3(.95,.29,.23),vec3(.26,.95,.65),viability);\n   if(fluid)color=mix(color,vec3(.88,.98,.82),.26);\n  } else if(uMode==2){\n   if(!fluid){\n    color=mix(vec3(.40,.28,.31),vec3(.95,.74,.64),density);\n    if(material>5.5)color=vec3(.92,.67,.51);\n   }\n  } else {\n   if(!fluid){\n    color=mix(vec3(.16,.27,.31),vec3(.43,.57,.54),density);\n    alpha*=.40;\n   }else{\n    color=mix(vec3(.27,.70,1.0),vec3(1.0,.45,.28),pressure);\n    color=mix(color,vec3(1.0,.98,.70),clamp(dye*.82,0.0,.82));\n    color+=vec3(.16,.33,.25)*min(speed*2.0,.8);\n    alpha=.24;\n   }\n  }\n  if(fluid&&uShowDye){\n   float flash=smoothstep(.23,.9,dye);\n   color=mix(color,vec3(1.0,.91,.64),flash*(uMode==3?.47:.25));\n   alpha+=flash*.055;\n  }\n  if(!fluid)alpha*=uOpacity*.90;\n  alpha*=threshold;\n  alpha=clamp(alpha,0.0,.36);\n  accum.rgb+=(1.0-accum.a)*color*alpha;\n  accum.a+=(1.0-accum.a)*alpha;\n }\n if(accum.a<.003)discard;\n fragColor=vec4(accum.rgb/max(accum.a,.001),accum.a);\n}";
const uniforms={
 uField:{value:null},uClasses:{value:null},uFlow:{value:null},
 uEye:{value:new THREE.Vector3(3,1,3)},uThreshold:{value:.32},
 uOpacity:{value:.46},uClip:{value:1},uMode:{value:0},
 uShowTissue:{value:true},uShowArtery:{value:true},uShowVein:{value:true},
 uShowCapillary:{value:true},uShowDye:{value:true}
};
function showError(message){
 $('loading').classList.remove('hidden');
 $('loadingTitle').textContent='Viewer error';
 $('loadingText').textContent=message;
 $('status').textContent='WebGL2 not available';
 console.error(message);
}
function setup(){
 try{renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});}
 catch(err){showError('WebGL2 required: '+err.message);return false;}
 if(!renderer.capabilities.isWebGL2){showError('Please use a recent browser with WebGL2 and 3D textures.');return false;}
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.15));
 renderer.setSize(wrap.clientWidth,wrap.clientHeight);
 renderer.setClearColor(0x071119,0);
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.27;
 wrap.appendChild(renderer.domElement);
 scene=new THREE.Scene();
 camera=new THREE.PerspectiveCamera(44,wrap.clientWidth/Math.max(1,wrap.clientHeight),.05,100);
 camera.position.set(2.8,1.22,3.3);
 controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=true;controls.dampingFactor=.055;
 controls.target.set(0,0,0);controls.minDistance=1.85;controls.maxDistance=9;
 controls.update();
 mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.ShaderMaterial({
  vertexShader,fragmentShader,glslVersion:THREE.GLSL3,
  uniforms,transparent:true,side:THREE.BackSide,depthWrite:false,depthTest:false
 }));
 mesh.frustumCulled=false;scene.add(mesh);
 scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02,2.02,2.02)),
  new THREE.LineBasicMaterial({color:0x466e74,transparent:true,opacity:.13,depthWrite:false})));
 new ResizeObserver(resize).observe(wrap);
 window.addEventListener('resize',resize);
 requestAnimationFrame(animate);
 return true;
}
function resize(){
 if(!renderer)return;
 const w=Math.max(1,wrap.clientWidth),h=Math.max(1,wrap.clientHeight);
 camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
}
function data3d(buffer,channels,filter=THREE.LinearFilter){
 const tex=new THREE.Data3DTexture(buffer,GRID,GRID,GRID);
 tex.format=channels===1?THREE.RedFormat:THREE.RGBAFormat;
 tex.type=THREE.UnsignedByteType;
 tex.minFilter=filter;tex.magFilter=filter;
 tex.unpackAlignment=1;tex.generateMipmaps=false;tex.needsUpdate=true;
 return tex;
}
function upload(){
 if(!model)return;
 model.updateTexture();
 if(!fieldTex){
  fieldTex=data3d(model.fieldBytes,4);
  classTex=data3d(model.materialBytes,1,THREE.NearestFilter);
  flowTex=data3d(model.flowBytes,4);
  uniforms.uField.value=fieldTex;uniforms.uClasses.value=classTex;uniforms.uFlow.value=flowTex;
 }else{
  fieldTex.image.data=model.fieldBytes;classTex.image.data=model.materialBytes;flowTex.image.data=model.flowBytes;
  fieldTex.needsUpdate=true;classTex.needsUpdate=true;flowTex.needsUpdate=true;
 }
}
function updateStats(){
 if(!model)return;
 $('coverage').textContent=model.coverage.toFixed(1);
 $('coverageFill').style.width=clamp(model.coverage,0,100)+'%';
 $('coverageState').textContent=model.coverage>85?'WELL SUPPLIED':model.coverage>60?'PATCHY':'OXYGEN DEFICIT';
 $('segments').textContent=model.lumenCount.toLocaleString('en-US');
 $('connections').textContent=model.capillaryCount.toLocaleString('en-US');
 $('flowloops').textContent=model.finished?model.flowingVoxels.toLocaleString('en-US'):'—';
 $('perfused').textContent=model.perfused.toFixed(0)+'%';
 $('growthPercent').textContent=Math.round(model.iteration/model.maxIterations*100)+'%';
 $('growthFill').style.width=Math.round(model.iteration/model.maxIterations*100)+'%';
 if(model.finished){
  $('status').textContent='Voxel fluid transport active';
  $('networkState').textContent='3D pressure-driven circulation';
  $('networkDescription').textContent='Fluid velocity and pressure live in each lumen voxel; oxygen diffuses through surrounding cells.';
 }else{
  $('status').textContent='Voxel vascular fronts propagating';
  $('networkState').textContent='6-neighborhood morphogenesis';
  $('networkDescription').textContent='Material voxels advance toward unmet tissue demand.';
 }
}
function begin(){
 if(!renderer)return;
 const request=++generation;
 playing=true;growthTime=0;fluidTime=0;telemetryTime=0;
 $('playPause').textContent='Ⅱ Pause';
 $('loadingTitle').textContent='Seeding matter voxels';
 $('loadingText').textContent='Allocating 3D tissue, lumen and pressure fields';
 $('loading').classList.remove('hidden');
 $('regenerate').disabled=true;
 requestAnimationFrame(()=>setTimeout(()=>{
  if(request!==generation)return;
  try{
   model=new VolumeModel(settings);
   $('specimenName').textContent=settings.organ.toUpperCase()+' / VOXEL SPECIMEN '+settings.seed;
   $('resLabel').textContent=GRID+'³ VOXEL FIELD';
   upload();updateStats();$('loading').classList.add('hidden');
  }catch(err){showError('Could not generate volume: '+err.message);}
  finally{$('regenerate').disabled=false;}
 },24));
}
function advance(dt){
 if(!model||!playing)return;
 if(!model.finished){
  growthTime+=dt*(3+settings.speed*7);
  let steps=0;
  while(growthTime>=1&&steps<4&&!model.finished){
   model.step();steps++;growthTime-=1;
   if(model.iteration%3===0||model.finished){upload();updateStats();}
  }
 }else{
  fluidTime+=dt*Math.max(.5,settings.speed*.65);
  telemetryTime+=dt;
  if(fluidTime>=1/14){
   const elapsed=Math.min(.14,fluidTime);
   model.advanceFluid(elapsed);
   upload();fluidTime=0;
  }
  if(telemetryTime>.50){updateStats();telemetryTime=0;}
 }
}
function animate(t){
 requestAnimationFrame(animate);
 if(!renderer)return;
 const dt=Math.min(.06,Math.max(0,(t-lastTime)/1000));lastTime=t;
 advance(dt);
 uniforms.uEye.value.copy(camera.position);
 controls.update();renderer.render(scene,camera);
}
function slider(id,display,format,callback){
 const el=$(id);if(!el)return;
 const update=()=>{
  let value=+el.value;
  el.style.setProperty('--percent',(100*(value-(+el.min))/((+el.max)-(+el.min)))+'%');
  $(display).textContent=format(value);callback(value);
 };
 el.addEventListener('input',update);update();
}
function visibility(){
 uniforms.uShowTissue.value=$('showVolume').checked;
 uniforms.uShowArtery.value=$('showArteries').checked;
 uniforms.uShowVein.value=$('showVeins').checked;
 uniforms.uShowCapillary.value=$('showCapillaries').checked;
 uniforms.uShowDye.value=$('showTracers').checked;
}
function modeChanged(i){
 uniforms.uMode.value=i;
 $('renderMode').textContent=['DENSITY / MRI','TISSUE / OXYGEN','MATERIAL / ANATOMY','VELOCITY / FLOW'][i];
 document.querySelectorAll('[data-mode]').forEach(b=>
  b.classList.toggle('selected',['mri','oxygen','structure','flow'][i]===b.dataset.mode));
}
function bind(){
 slider('vascularity','vascularityValue',n=>n+'%',n=>settings.vascularity=n);
 slider('heterogeneity','heterogeneityValue',n=>n+'%',n=>settings.heterogeneity=n);
 slider('reach','reachValue',n=>n+'%',n=>{
  settings.reach=n;
  if(model){model.settings.reach=n;model.recomputeCoverage(true);upload();updateStats();}
 });
 slider('speed','speedValue',n=>n+'×',n=>settings.speed=n);
 slider('viscosity','viscosityValue',n=>n+'%',n=>{settings.viscosity=n;if(model)model.settings.viscosity=n});
 slider('threshold','thresholdValue',n=>(n/100).toFixed(2),n=>uniforms.uThreshold.value=n/100);
 slider('opacity','opacityValue',n=>n+'%',n=>uniforms.uOpacity.value=n/100);
 slider('slice','sliceValue',n=>n+'%',n=>uniforms.uClip.value=n/50-1);
 $('regenerate').addEventListener('click',begin);$('restart').addEventListener('click',begin);
 $('randomize').addEventListener('click',()=>{
  settings.seed=1+Math.floor(Math.random()*999998);$('seed').value=settings.seed;begin();
 });
 $('organ').addEventListener('change',()=>{settings.organ=$('organ').value;begin()});
 $('seed').addEventListener('change',()=>{
  settings.seed=clamp(Math.floor(+$('seed').value)||1,1,999999);
  $('seed').value=settings.seed;begin();
 });
 $('vascularity').addEventListener('change',begin);
 $('heterogeneity').addEventListener('change',begin);
 $('playPause').addEventListener('click',()=>{
  playing=!playing;$('playPause').textContent=playing?'Ⅱ Pause':'▷ Play';
  $('status').textContent=playing?'Simulation active':'Simulation paused';
 });
 for(let name of ['showVolume','showArteries','showVeins','showCapillaries','showTracers'])$(name).addEventListener('change',visibility);
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>modeChanged(['mri','oxygen','structure','flow'].indexOf(b.dataset.mode))));
 $('resetView').addEventListener('click',()=>{
  camera.position.set(2.8,1.22,3.3);controls.target.set(0,0,0);controls.update();
 });
 $('screenshot').addEventListener('click',()=>{
  renderer.render(scene,camera);
  const canvas=document.createElement('canvas');
  canvas.width=renderer.domElement.width;canvas.height=renderer.domElement.height;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#0b151e';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(renderer.domElement,0,0);
  const link=document.createElement('a');
  link.download='voxel-volume-'+settings.organ+'-'+settings.seed+'.png';
  link.href=canvas.toDataURL('image/png');link.click();
 });
 window.addEventListener('keydown',e=>{
  if(e.key.toLowerCase()==='g'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))begin();
 });
 modeChanged(0);visibility();
}
bind();if(setup())begin();
