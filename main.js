import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GRID} from './simulation.js?v=curved-perfusion-20261115-r2';
const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=$('canvasWrap');
const settings={organ:'kidney',seed:38127,vascularity:72,heterogeneity:58,reach:65,speed:2,viscosity:40};
let snapshot=null,worker=null,renderer=null,scene=null,camera=null,controls=null,mesh=null;
let fieldTex=null,classTex=null,flowTex=null,layerTex=null,smoothVesselTex=null;
let playing=true,generation=0;
const vertexShader="out vec3 vPosition;\nvoid main(){\n vPosition=position;\n gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);\n}";
const fragmentShader="precision highp float;\nprecision highp sampler3D;\nin vec3 vPosition;\nout vec4 fragColor;\nuniform sampler3D uField;\nuniform sampler3D uClasses;\nuniform sampler3D uFlow;\nuniform sampler3D uLayers;\nuniform sampler3D uSmoothVessel;\nuniform float uIsolateZone;\nuniform vec3 uEye;\nuniform float uThreshold;\nuniform float uOpacity;\nuniform float uClip;\nuniform int uMode;\nuniform bool uShowTissue;\nuniform bool uShowArtery;\nuniform bool uShowVein;\nuniform bool uShowCapillary;\nuniform bool uShowDye;\nvoid main(){\n vec3 direction=normalize(vPosition-uEye);\n vec3 inv=1.0/direction;\n vec3 t0=(-vec3(1.0)-uEye)*inv;\n vec3 t1=(vec3(1.0)-uEye)*inv;\n vec3 nearT=min(t0,t1),farT=max(t0,t1);\n float entry=max(0.0,max(max(nearT.x,nearT.y),nearT.z));\n float exitT=min(min(farT.x,farT.y),farT.z);\n if(exitT<=entry)discard;\n vec4 accum=vec4(0.0);\n float stepLength=0.0205;\n float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);\n float t=entry+stepLength*jitter;\n for(int k=0;k<148;k++){\n  if(t>exitT||accum.a>.992)break;\n  vec3 p=uEye+t*direction;\n  t+=stepLength;\n  if(p.z>uClip)continue;\n  vec3 uv=clamp((p+1.0)*.5,vec3(.002),vec3(.998));\n  float material=floor(texture(uClasses,uv).r*255.0+.5);\n  vec4 vesselMask=texture(uSmoothVessel,uv);\n  float smoothArtery=uShowArtery?vesselMask.r:0.0;\n  float smoothVein=uShowVein?vesselMask.g:0.0;\n  float smoothCapillary=uShowCapillary?vesselMask.b:0.0;\n  float smoothed=max(smoothArtery,max(smoothVein,smoothCapillary));\n  bool actualFluid=material>2.5&&material<5.5;\n  // Smooth the visual vessel silhouettes via trilinear voxel occupancy.\n  // The physical lumen and all fluid calculations remain discrete.\n  bool softFluid=!actualFluid&&material<3.0&&smoothed>.12;\n  if(material<.5&&!softFluid)continue;\n  float zone=floor(texture(uLayers,uv).r*255.0+.5);\n  if(uIsolateZone>.5&&abs(zone-uIsolateZone)>.5)continue;\n  float visibleKind=material;\n  if(softFluid){\n    visibleKind=smoothArtery>=smoothVein&&smoothArtery>=smoothCapillary?3.0:\n      smoothVein>=smoothCapillary?4.0:5.0;\n  }\n  bool fluid=actualFluid||softFluid;\n  if(fluid&&((visibleKind<3.5&&!uShowArtery)||\n     (visibleKind>3.5&&visibleKind<4.5&&!uShowVein)||\n     (visibleKind>4.5&&!uShowCapillary)))continue;\n  if(!fluid&&!uShowTissue)continue;\n  vec4 f=texture(uField,uv);\n  float density=softFluid?max(f.r,.72):f.r;\n  float threshold=smoothstep(uThreshold-.018,uThreshold+.045,density);\n  if(threshold<.008)continue;\n  vec4 flow=vec4(.5,.5,.5,.5);\n  if(actualFluid)flow=texture(uFlow,uv);\n  float o2=f.g,dye=f.a,pressure=flow.a;\n  vec3 velocity=flow.rgb*2.0-1.0;\n  float speed=length(velocity);\n  float alpha=.014+.032*density;\n  vec3 color=vec3(.38,.49,.50)+density*vec3(.39,.37,.32);\n  if(material>1.5&&material<2.5)color+=vec3(.10,.08,.07);\n  if(material>5.5){color=vec3(.84,.77,.68);alpha*=1.28;}\n  if(fluid){\n   alpha=.21*(softFluid?smoothstep(.12,.57,smoothed):1.0);\n   color=visibleKind<3.5?vec3(.94,.38,.29):\n        visibleKind<4.5?vec3(.28,.63,.86):vec3(1.0,.75,.52);\n   color*=.68+.26*o2;\n  }\n  if(uMode==0){\n   if(!fluid)color=mix(vec3(.23,.34,.40),vec3(.95,.96,.90),density);\n   else color=mix(vec3(.64,.72,.73),color,.63);\n   if(material>5.5)color=vec3(.95,.93,.86);\n  } else if(uMode==1){\n   float viability=smoothstep(.10,.80,o2);\n   color=mix(vec3(.95,.29,.23),vec3(.26,.95,.65),viability);\n   if(fluid)color=mix(color,vec3(.88,.98,.82),.26);\n  } else if(uMode==2){\n   if(!fluid){\n    color=mix(vec3(.40,.28,.31),vec3(.95,.74,.64),density);\n    if(material>5.5)color=vec3(.92,.67,.51);\n   }\n  } else if(uMode==3){\n   if(!fluid){\n    color=mix(vec3(.16,.27,.31),vec3(.43,.57,.54),density);\n    alpha*=.40;\n   }else{\n    color=mix(vec3(.27,.70,1.0),vec3(1.0,.45,.28),pressure);\n    color=mix(color,vec3(1.0,.98,.70),clamp(dye*.82,0.0,.82));\n    color+=vec3(.16,.33,.25)*min(speed*2.0,.8);\n    alpha=.24;\n   }\n  } else {\n   if(zone<1.5)color=vec3(.91,.90,.75);        // capsule\n   else if(zone<2.5)color=vec3(.95,.55,.38);   // cortex\n   else if(zone<3.5)color=vec3(.48,.58,.88);   // medullary pyramids\n   else if(zone<4.5)color=vec3(.80,.68,.50);   // renal columns\n   else if(zone<5.5)color=vec3(.78,.43,.49);   // hepatocytes\n   else if(zone<6.5)color=vec3(.97,.73,.39);   // portal triads\n   else if(zone<7.5)color=vec3(.41,.77,.86);   // central venous\n   else if(zone<8.5)color=vec3(.80,.69,.90);   // pleura\n   else if(zone<9.5)color=vec3(.97,.70,.45);   // bronchial\n   else if(zone<10.5)color=vec3(.46,.87,.78); // alveolar\n   else if(zone<11.5)color=vec3(.94,.79,.45); // epicardium\n   else if(zone<12.5)color=vec3(.95,.42,.46); // myocardium\n   else if(zone<13.5)color=vec3(.45,.70,.91); // endocardium\n   else if(zone<14.5)color=vec3(.64,.93,.60); // proliferative rim\n   else if(zone<15.5)color=vec3(.61,.49,.70); // hypoxic core\n   else color=vec3(.51,.81,.74);\n   if(fluid)color=mix(color,vec3(1.0,.97,.86),.27);\n   alpha=fluid?.19:.065;\n  }\n  if(fluid&&uShowDye){\n   float flash=smoothstep(.23,.9,dye);\n   color=mix(color,vec3(1.0,.91,.64),flash*(uMode==3?.47:.25));\n   alpha+=flash*.055;\n  }\n  if(!fluid)alpha*=uOpacity*.90;\n  alpha*=threshold;\n  alpha=clamp(alpha,0.0,.36);\n  accum.rgb+=(1.0-accum.a)*color*alpha;\n  accum.a+=(1.0-accum.a)*alpha;\n }\n if(accum.a<.003)discard;\n fragColor=vec4(accum.rgb/max(accum.a,.001),accum.a);\n}";
const uniforms={
 uField:{value:null},uClasses:{value:null},uFlow:{value:null},
 uLayers:{value:null},uSmoothVessel:{value:null},uIsolateZone:{value:0},
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
function upload(message){
 if(!message)return;
 const field=message.field,material=message.material,flow=message.flow,layers=message.layers,vessel=message.vessel;
 if(!fieldTex){
  fieldTex=data3d(field,4);
  classTex=data3d(material,1,THREE.NearestFilter);
  flowTex=data3d(flow,4);
  layerTex=data3d(layers,1,THREE.NearestFilter);
  smoothVesselTex=data3d(vessel||new Uint8Array(GRID*GRID*GRID*4),4);
  uniforms.uField.value=fieldTex;uniforms.uClasses.value=classTex;uniforms.uFlow.value=flowTex;uniforms.uLayers.value=layerTex;uniforms.uSmoothVessel.value=smoothVesselTex;
 }else{
  fieldTex.image.data=field;classTex.image.data=material;flowTex.image.data=flow;layerTex.image.data=layers;
  fieldTex.needsUpdate=true;classTex.needsUpdate=true;flowTex.needsUpdate=true;layerTex.needsUpdate=true;
  if(vessel){smoothVesselTex.image.data=vessel;smoothVesselTex.needsUpdate=true;}
 }
}
function updateLayerControls(metrics){
 const select=$('zoneSelect'),current=select.value;
 const signature=metrics.map(m=>m.id+':'+m.name).join('|');
 if(select.dataset.signature!==signature){
  select.replaceChildren();
  const all=new Option('All tissue compartments','0');select.add(all);
  for(const m of metrics)select.add(new Option(m.name,String(m.id)));
  select.dataset.signature=signature;
  select.value=[...select.options].some(o=>o.value===current)?current:'0';
  uniforms.uIsolateZone.value=+select.value;
 }
 const regionList=$('regionList');
 // Reuse the existing elements rather than recreating the DOM every snapshot.
 if(regionList.children.length!==metrics.length||regionList.dataset.signature!==signature){
  regionList.replaceChildren();
  for(const region of metrics){
   const row=document.createElement('div');row.className='region-row';
   const top=document.createElement('div');top.className='region-row-top';
   const label=document.createElement('span');label.className='region-name';label.textContent=region.name;
   const percent=document.createElement('strong');percent.className='region-percent';
   top.append(label,percent);
   const bar=document.createElement('div');bar.className='region-bar';
   const fill=document.createElement('div');bar.append(fill);
   const sub=document.createElement('small');sub.className='region-sub';
   row.append(top,bar,sub);
   regionList.append(row);
  }
  regionList.dataset.signature=signature;
 }
 metrics.forEach((r,i)=>{
  const row=regionList.children[i],pct=clamp(r.coverage,0,100);
  row.querySelector('.region-percent').textContent=pct.toFixed(0)+'%';
  row.querySelector('.region-bar div').style.width=pct+'%';
  row.querySelector('.region-sub').textContent=r.count.toLocaleString('en-US')+' tissue voxels · '+r.lumen.toLocaleString('en-US')+' lumen voxels';
  row.dataset.zone=String(r.id);
 });
}
function updateStats(){
 if(!snapshot)return;
 if(snapshot.regionMetrics)updateLayerControls(snapshot.regionMetrics);
 $('coverage').textContent=snapshot.coverage.toFixed(1);
 $('coverageFill').style.width=clamp(snapshot.coverage,0,100)+'%';
 $('coverageState').textContent=snapshot.coverage>85?'WELL SUPPLIED':snapshot.coverage>60?'PATCHY':'OXYGEN DEFICIT';
 $('segments').textContent=snapshot.lumenCount.toLocaleString('en-US');
 $('connections').textContent=snapshot.capillaryCount.toLocaleString('en-US');
 $('flowloops').textContent=snapshot.finished?snapshot.flowingVoxels.toLocaleString('en-US'):'—';
 $('diagonalVeins').textContent=snapshot.diagonalVeinSteps.toLocaleString('en-US');
 $('diagonalArteries').textContent=snapshot.diagonalArterySteps.toLocaleString('en-US');
 $('perfused').textContent=snapshot.perfused.toFixed(0)+'%';
 $('growthPercent').textContent=Math.round(snapshot.iteration/snapshot.maxIterations*100)+'%';
 $('growthFill').style.width=Math.round(snapshot.iteration/snapshot.maxIterations*100)+'%';
 if(snapshot.finished){
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
 playing=true;$('playPause').textContent='Ⅱ Pause';
 $('loadingTitle').textContent='Seeding matter voxels';
 $('loadingText').textContent='Allocating tissue, plasma and vessel-wall materials in 3D';
 $('loading').classList.remove('hidden');
 $('regenerate').disabled=true;
 if(worker)worker.terminate();
 worker=new Worker(new URL('./worker.js?v=curved-perfusion-20261115-r2',import.meta.url),{type:'module'});
 snapshot=null;
 $('specimenName').textContent=settings.organ.toUpperCase()+' / VOXEL SPECIMEN '+settings.seed;
 $('resLabel').textContent=GRID+'³ VOXEL FIELD';
 worker.onmessage=({data})=>{
  if(request!==generation)return;
  if(data.kind==='error'){showError(data.message);$('regenerate').disabled=false;return;}
  if(data.kind==='phase'){$('status').textContent=data.text;return;}
  if(data.kind!=='snapshot')return;
  snapshot=data.stats;upload(data);updateStats();
  $('loading').classList.add('hidden');$('regenerate').disabled=false;
 };
 worker.onerror=err=>{
  if(request!==generation)return;
  showError('Voxel simulation worker failed: '+err.message);
  $('regenerate').disabled=false;
 };
 worker.postMessage({kind:'start',settings:{...settings}});
}
function animate(){
 requestAnimationFrame(animate);
 if(!renderer)return;
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
 $('renderMode').textContent=['DENSITY / MRI','TISSUE / OXYGEN','MATERIAL / ANATOMY','VELOCITY / FLOW','ANATOMICAL ZONES'][i];
 document.querySelectorAll('[data-mode]').forEach(b=>
  b.classList.toggle('selected',['mri','oxygen','structure','flow','layers'][i]===b.dataset.mode));
}
function bind(){
 slider('vascularity','vascularityValue',n=>n+'%',n=>settings.vascularity=n);
 slider('heterogeneity','heterogeneityValue',n=>n+'%',n=>settings.heterogeneity=n);
 slider('reach','reachValue',n=>n+'%',n=>{
  settings.reach=n;
  if(worker)worker.postMessage({kind:'reach',value:n});
 });
 slider('speed','speedValue',n=>n+'×',n=>{settings.speed=n;if(worker)worker.postMessage({kind:'speed',speed:n})});
 slider('viscosity','viscosityValue',n=>n+'%',n=>{settings.viscosity=n;if(worker)worker.postMessage({kind:'viscosity',value:n})});
 slider('threshold','thresholdValue',n=>(n/100).toFixed(2),n=>uniforms.uThreshold.value=n/100);
 slider('opacity','opacityValue',n=>n+'%',n=>uniforms.uOpacity.value=n/100);
 slider('slice','sliceValue',n=>n+'%',n=>uniforms.uClip.value=n/50-1);
 $('zoneSelect').addEventListener('change',()=>{uniforms.uIsolateZone.value=+$('zoneSelect').value;});
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
  if(worker)worker.postMessage({kind:'pause',playing});
  $('status').textContent=playing?'Simulation active':'Simulation paused';
 });
 for(let name of ['showVolume','showArteries','showVeins','showCapillaries','showTracers'])$(name).addEventListener('change',visibility);
 document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>modeChanged(['mri','oxygen','structure','flow','layers'].indexOf(b.dataset.mode))));
 const preset=(veinsOnly)=>{
  $('showVolume').checked=!veinsOnly;
  $('showArteries').checked=!veinsOnly;
  $('showVeins').checked=true;
  $('showCapillaries').checked=!veinsOnly;
  $('showTracers').checked=!veinsOnly;
  visibility();
  $('veinsOnly').classList.toggle('active',veinsOnly);
  $('allSystems').classList.toggle('active',!veinsOnly);
  modeChanged(veinsOnly?2:0);
 };
 $('veinsOnly').addEventListener('click',()=>preset(true));
 $('allSystems').addEventListener('click',()=>preset(false));
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
