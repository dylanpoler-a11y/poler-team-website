import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { createHouse, views, features, floorLevels, rooms, toWorld } from './house.js';
import { interiorStyles, disposeInteriorMaterials } from './interior-materials.js';
import { interiorRooms } from './interior-tour.js';
import { InteriorNavigation } from './interior-navigation.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { GTAOPass } from './vendor/postprocessing/GTAOPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const refData = [
  ['rendering','Garden approach','Finished design rendering: broad stepping stones, tropical planting, dark ground-level walls, full-height glazing, and a patterned upper balcony.'],
  ['rendering','Exterior stair & canopy','Finished design rendering: open stair treads with solid dark guards, slender round columns, timber slat soffits, and patterned privacy screens.'],
  ['exterior','Waterfront elevation','Construction view from the water. Two glazed upper levels stand above an open ground floor. The rear exterior stair links recessed and projecting volumes.'],
  ['interior','Corner glazing','Water-facing room with tall corner glazing and the external stair visible outside. Blue glazing includes temporary construction protection.'],
  ['exterior','Arrival elevation','Deep projecting roof, broad balconies, large glazed openings, and round white columns viewed from the approach. Temporary rails are visible.'],
  ['exterior','Side elevation & columns','View along the narrow side yard, showing the deep canopy, tall round columns, and staggered house volumes.'],
  ['exterior','Rear elevation & pool','The raised main floor and recessed right-hand wing behind the unfinished pool. The roof edge spans an open notch.'],
  ['exterior','Pool-side overview','Waterfront elevation with upper terrace, exterior stair, deep roof frame, and unfinished pool and spa in the foreground.'],
  ['interior','Stairwell landing','Open steel stair beside tall glazing with a narrow parallel landing. Interior layout beyond this view is not established.'],
  ['interior','Open steel stair','Straight open-riser steel flight beside the glazed stair hall. The broad side stringers remain exposed during construction.'],
  ['interior','Ceiling & linear slots','White recessed ceiling planes with narrow linear slots; fixtures and finishes are still being installed.'],
  ['interior','Timber vanity','Warm vertically detailed wood cabinet with a charcoal sink and top, against pale large-format wall tile.'],
  ['interior','Stair from the landing','Straight open steel stair alongside protected full-height glazing, with pale tile and broad dark plate stringers.'],
  ['interior','Vanity finish detail','Timber-fronted vanity with a dark rectangular basin and pale horizontally textured tile.'],
  ['exterior','Upper approach façade','Large dark-framed glazed openings, projecting slab edges, a deep roof, and temporary upper-level safety rails.'],
  ['interior','Guardrail base channel','Recessed metal channel follows the stair opening. It suggests a future glass guard, which is not yet installed.'],
  ['exterior','Timber soffit & columns','Deep wood-slatted canopy with recessed downlights, supported on tall slender round columns outside the balcony line.'],
  ['exterior','Side garden boundary','Narrow unfinished side yard beside a temporary privacy fence, tropical hedge, and palms.'],
  ['interior','Stair tread sample','Open steel treads and broad plate stringers with a warm wood tread-cladding sample. The recessed floor channel traces the stair opening.'],
  ['interior','Vertical service shaft','A rectangular concrete-block shaft with installed steel brackets. Its exact function and dimensions are unconfirmed.'],
  ['interior','Room under construction','White room and broad protected glazing, partly obscured by stored construction materials. Final room use is unconfirmed.'],
  ['exterior','Long covered balcony','Narrow balcony along full-height glazing, with temporary timber guards and tall round columns. The street is visible beyond.'],
  ['exterior','Pool edge & side yard','Unfinished pool and spa edge beside a narrow yard, boundary fence, and dense tropical vegetation.'],
  ['interior','Interior fit-out','Large white room containing construction materials, with broad glazing and an open ceiling service area.'],
  ['interior','Stair stringer detail','Broad dark stair stringer beside the glazed hall. Pale floor finishes remain protected during work.'],
  ['interior','Water-facing room','Workers installing finishes beside a tall glazed opening onto the waterfront balcony.'],
  ['interior','Upper stair corridor','Long stairwell opening parallel to the glazed façade, with a narrow landing and doorways on the other side.'],
  ['interior','Glazed room & ceiling','Construction supplies in a room with broad protected glazing and recessed ceiling planes.'],
  ['exterior','Approach overview','Wide-angle construction image showing three levels, broad balconies, deep roof overhang, and tall round columns. Timestamp: 31 July 2026.'],
  ['interior','Shower niche & drain','Pale stone-look shower tile, a long dark horizontal niche, and a linear drain at the rear.'],
  ['interior','Bathroom tile detail','Large pale horizontally textured wall tiles beside a narrow window and unfinished fixture locations.'],
  ['interior','Shower & vertical window','Narrow tall window in a shower lined with pale stone-look tiles. Plumbing remains exposed.'],
  ['interior','Bathroom ceiling','Tiled bathroom under construction, with ceiling fixture openings and unfinished trim.'],
  ['interior','Services installation','Electrical and low-voltage equipment being installed in a white interior room. Exact room placement is unknown.'],
  ['interior','Horizontal window','Interior work area with a long low horizontal window and white walls. Final room use is not established.'],
  ['interior','Shaft installation','View into a concrete-block vertical shaft with installed steel support hardware.'],
  ['interior','Shower under a skylight','Pale tiled walk-in shower with a long dark niche, rectangular skylight, and linear floor drain.'],
  ['interior','Room fit-out / second view','Alternate view of the room with protected glazing, boxed materials, and cement bags.'],
  ['interior','Interior materials / second view','Alternate view of the room with stored materials and an open ceiling service zone.'],
  ['interior','Stair hall & upper flight','Narrow corridor follows the glazed stairwell; a broad dark stair stringer crosses overhead.'],
  ['interior','View to the water','Tall sliding glazing opens to a narrow balcony and a broad waterway. Temporary timber guards are visible.'],
  ['interior','Continuous stair hall','Lower open-riser stair descends beside glazing, with an upper flight overhead and doorways along the parallel corridor.'],
  ['interior','Room awaiting finishes','Materials occupy a broad room with protected glazing and a recessed ceiling. Final room use is unconfirmed.'],
  ['exterior','Pool & inset spa','Unfinished pool and inset spa looking back toward the raised house. Step and basin geometry is clarified by the architectural site plan. Wide-angle image; timestamp 31 July 2026.'],
].map((r,i)=>({id:i+1,type:r[0],title:r[1],caption:r[2],src:`./assets/ref-${String(i+1).padStart(2,'0')}.jpg`}));

let photoIndex=1, activeFeature='arrival', toastTimer;
const state={room:null,style:'warm',view:'overview',floor:'all',roof:true,landscape:true,markers:true,material:'natural',light:15,orbit:false};
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),2400);}
function openPhoto(id){
  const ref=refData[id-1];photoIndex=id-1;
  $('#lightbox-image').src=ref.src;$('#lightbox-image').alt=ref.caption;
  $('#lightbox-number').textContent=`${ref.type==='rendering'?'DESIGN RENDERING':'CONSTRUCTION PHOTO'} · ${String(id).padStart(2,'0')} / 44`;
  $('#lightbox-title').textContent=ref.title;$('#lightbox-caption').textContent=ref.caption;$('#original-link').href=ref.src;
  if(!$('#lightbox').open)$('#lightbox').showModal();
}
function renderGallery(filter='all'){
  const grid=$('#gallery-grid');grid.replaceChildren();
  refData.filter(r=>filter==='all'||r.type===filter).forEach(ref=>{
    const button=document.createElement('button');button.className='gallery-card';button.setAttribute('aria-label',`Open reference ${ref.id}: ${ref.title}`);
    const img=document.createElement('img');img.src=ref.src;img.alt=ref.title;img.loading='lazy';img.width=320;img.height=256;
    const kicker=document.createElement('span');kicker.className='eyebrow';kicker.textContent=`${String(ref.id).padStart(2,'0')} / ${ref.type==='rendering'?'DESIGN RENDERING':ref.type==='exterior'?'EXTERIOR':'INTERIOR & DETAIL'}`;
    const title=document.createElement('strong');title.textContent=ref.title;button.append(img,kicker,title);button.addEventListener('click',()=>openPhoto(ref.id));grid.append(button);
  });
}
function openGallery(){if(!$('#gallery').open)$('#gallery').showModal();}
for(const selector of ['#gallery-open','#all-references'])$(selector).addEventListener('click',openGallery);
for(const selector of ['#notes-open','#model-note'])$(selector).addEventListener('click',()=>$('#notes').showModal());
$$('[data-close]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.close).close()));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
$$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{$$('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderGallery(b.dataset.filter);}));
$('#photo-prev').addEventListener('click',()=>openPhoto((photoIndex+43)%44+1));
$('#photo-next').addEventListener('click',()=>openPhoto((photoIndex+1)%44+1));
$('#lightbox').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();$('#photo-prev').click();}if(e.key==='ArrowRight'){e.preventDefault();$('#photo-next').click();}});
$('#feature-image-open').addEventListener('click',()=>openPhoto(features.find(f=>f.id===activeFeature).photo));
renderGallery();

let renderer,scene,camera,controls,house,sun,hemi,interiorNavigation,composer,aoPass,transition=null,resizeRevision=0;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const host=$('#canvas-host');
const sectionPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),0);
function setFloor(level){
  if(!house||!['all','ground','main','upper'].includes(level))return;
  leaveInterior();state.floor=level;$('#floor-select').value=level;
  for(const name of ['ground','main','upper'])house.groups[name].visible=level==='all'||name===level;
  house.groups.roof.visible=level==='all'&&state.roof;
  house.groups.landscape.visible=level==='all'&&state.landscape;
  $('#roof-toggle').disabled=level!=='all';
  const clips=level==='all'?[]:[sectionPlane];
  if(level!=='all')sectionPlane.constant=floorLevels[level]+1.15;
  for(const m of [...Object.values(house.materials),clay,clayGlass]){m.clippingPlanes=clips;m.clipShadows=true;m.needsUpdate=true;}
  $('#floor-caption').textContent=level==='all'?'Complete exterior and site.':`${{ground:'Understory',main:'First floor',upper:'Second floor'}[level]} · walls cut down to show the layout.`;
  document.querySelector('.view-heading h1').textContent=level==='all'?'At the water’s edge.':{ground:'The understory.',main:'The first floor.',upper:'The second floor.'}[level];
  if(level==='all')setView('overview');
  else {const small=camera.aspect<.95;setView('aerial');transition={start:performance.now(),from:camera.position.clone(),to:new THREE.Vector3(0,small?68:57,small?0:3),targetFrom:controls.target.clone(),targetTo:new THREE.Vector3(0,floorLevels[level],small?-3:0)};$('#view-caption').textContent='A sectional view of the layout. Drag to explore; use Whole home to return.';}
}
function setView(name,immediate=false){
  const view=views[name];if(!view||!camera)return;
  if(state.room)leaveInterior();state.view=name;controls.autoRotate=false;state.orbit=false;$('#rotate').setAttribute('aria-pressed','false');
  const target=new THREE.Vector3(...view.target),pos=new THREE.Vector3(...view.position);
  const factor=camera.aspect<.95?.95/camera.aspect:1;pos.sub(target).multiplyScalar(factor).add(target);
  if(immediate||reduceMotion){camera.position.copy(pos);controls.target.copy(target);controls.update();transition=null;}
  else transition={start:performance.now(),from:camera.position.clone(),to:pos,targetFrom:controls.target.clone(),targetTo:target};
  $$('[data-view]').forEach(b=>{b.classList.toggle('selected',b.dataset.view===name);b.setAttribute('aria-pressed',String(b.dataset.view===name));});
  $('#view-caption').textContent=view.caption;
}
function selectFeature(id,move=true){
  const feature=features.find(f=>f.id===id);if(!feature)return;activeFeature=id;
  $('#feature-image').src=refData[feature.photo-1].src;$('#feature-image').alt=refData[feature.photo-1].caption;
  $('#feature-kicker').textContent=`${feature.kicker} · ${String(feature.photo).padStart(2,'0')} / 44`;
  $('#feature-title').textContent=feature.title;$('#feature-copy').textContent=feature.description;
  $$('.hotspot').forEach(b=>{b.classList.toggle('active',b.dataset.feature===id);b.setAttribute('aria-pressed',String(b.dataset.feature===id));});
  if(move)setView(feature.view);
}
function setMaterial(mode){
  if(!house||!['natural','clay'].includes(mode))return;state.material=mode;
  house.root.traverse(o=>{if(o.isMesh)o.material=mode==='clay'&& !['water','site','landscape'].includes(o.parent.name)?(o.userData.originalMaterial.transparent?clayGlass:clay):o.userData.originalMaterial;});
  $$('[data-material]').forEach(b=>{b.classList.toggle('active',b.dataset.material===mode);b.setAttribute('aria-pressed',String(b.dataset.material===mode));});
}
function setLight(value){
  if(!sun)return;state.light=Number(value);const t=state.light/100;
  sun.position.set(-18+12*t,25-21*t,8+8*t);sun.color.set('#fff8df').lerp(new THREE.Color('#ffa867'),t);
  sun.intensity=2.8-1.6*t;hemi.intensity=1.65-1.05*t;renderer.toneMappingExposure=.97-t*.06;
  scene.background.set('#eeede6').lerp(new THREE.Color('#b0b3b0'),t*.85);
  house.materials.light.emissiveIntensity=.18+t*5;
  updateInteriorLighting();
  $('#light-label').textContent=t<.35?'Daylight':t<.73?'Golden hour':'Dusk';
}
function updateInteriorLighting(){
  if(!house)return;
  const inside=!!state.room,t=state.light/100;
  if(inside){sun.intensity=1.7-t*1.0;hemi.intensity=.58-t*.20;scene.environmentIntensity=.48;renderer.toneMappingExposure=state.style==='dramatic'?1.0:.96;}
  else scene.environmentIntensity=.32;
  house.materials.glass.opacity=inside?.09:.29;
  const sorted=house.interiorLights.map(light=>({light,d:camera.position.distanceTo(light.position)})).filter(x=>Math.abs(x.light.position.y-camera.position.y)<2.2).sort((a,b)=>a.d-b.d);
  const selected=new Set(inside?sorted.slice(0,8).map(x=>x.light):[]);
  for(const light of house.interiorLights){light.visible=selected.has(light);light.intensity=light.userData.baseIntensity*(inside?.65+t*.5:0);light.color.copy(house.interiorMaterials.emissive.emissive);}
}
function leaveInterior(){
  if(!state.room)return;
  state.room=null;house.groups.roof.visible=state.floor==='all'&&state.roof;$('.view-heading h1').textContent='At the water’s edge.';interiorNavigation?.exit();controls.enabled=true;controls.minDistance=7;controls.maxDistance=110;
  document.body.classList.remove('is-inside');$('#viewport').classList.remove('is-interior');$('#interior-toolbar').hidden=true;
  $('#interior-start').innerHTML='Explore the interiors <span>→</span>';
  $('.model-tag>span:nth-child(2)').textContent='Architectural plans · Rev 8';
  selectFeature(activeFeature,false);setLight(state.light);
}
function setInteriorStyle(id,enter=false){
  if(!interiorStyles.some(s=>s.id===id)||!house)return;
  state.style=id;house.setInteriorStyle(id);if(state.material==='clay')setMaterial('natural');
  $$('[data-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.style===id)));
  if(enter&&!state.room)setRoom('living');else updateInteriorLighting();
  if(state.room)$('.model-tag>span:nth-child(2)').textContent='INTERIOR CONCEPT · '+interiorStyles.find(s=>s.id===id).label;
}
function setRoom(id){
  const room=interiorRooms.find(r=>r.id===id);if(!room||!house)return;
  if(state.room)leaveInterior();
  setFloor('all');transition=null;state.room=id;state.floor='all';controls.enabled=false;controls.autoRotate=false;state.orbit=false;setMaterial('natural');
  house.groups.roof.visible=true;for(const k of ['ground','main','upper'])house.groups[k].visible=true;
  document.body.classList.add('is-inside');$('#viewport').classList.add('is-interior');$('#interior-toolbar').hidden=false;
  $('#room-select').value=id;$('#interior-start').innerHTML='Return to exterior <span>↗</span>';
  $('.view-heading h1').textContent=room.label+'.';$('#view-caption').textContent='A finished interior concept. Explore the room and compare the three schemes.';
  $('.model-tag>span:nth-child(2)').textContent='INTERIOR CONCEPT · '+interiorStyles.find(s=>s.id===state.style).label;
  $('#feature-kicker').textContent='PROPOSED INTERIOR · '+room.level.toUpperCase();$('#feature-title').textContent=room.label;$('#feature-copy').textContent=room.description;
  const floorY=floorLevels[room.level];interiorNavigation.enter(room,new THREE.Vector3(...toWorld(room.position,floorY+room.eye)),new THREE.Vector3(...toWorld(room.target,floorY+room.focus)));
  setLight(state.light);if(matchMedia('(max-width:850px)').matches)$('#viewport').scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'start'});
}
for(const container of [$('#sidebar-finishes'),$('#viewport-finishes')])for(const style of interiorStyles){
 const button=document.createElement('button');button.className='finish-option';button.dataset.style=style.id;button.setAttribute('aria-pressed',String(style.id===state.style));button.title=style.description;
 const swatches=document.createElement('span');swatches.className='finish-swatches';swatches.setAttribute('aria-hidden','true');for(const color of style.swatches){const i=document.createElement('i');i.style.background=color;swatches.append(i);}
 const label=document.createElement('span');label.textContent={warm:'Warm',coastal:'Coastal',dramatic:'Dramatic'}[style.id];button.append(swatches,label);button.addEventListener('click',()=>setInteriorStyle(style.id,true));container.append(button);
}
for(const room of interiorRooms){const o=document.createElement('option');o.value=room.id;o.textContent=room.label;$('#room-select').append(o);}
$('#room-select').addEventListener('change',e=>setRoom(e.target.value));
for(const [id,step]of [['#room-prev',-1],['#room-next',1]])$(id).addEventListener('click',()=>{const i=interiorRooms.findIndex(r=>r.id===state.room);setRoom(interiorRooms[(i+step+interiorRooms.length)%interiorRooms.length].id);});
$('#interior-open').addEventListener('click',()=>setRoom('living'));$('#interior-start').addEventListener('click',()=>state.room?setFloor('all'):setRoom('living'));$('#interior-exit').addEventListener('click',()=>setFloor('all'));
const clay=new THREE.MeshStandardMaterial({color:'#dfd6bf',roughness:.85});
const clayGlass=new THREE.MeshStandardMaterial({color:'#a4a799',roughness:.68,transparent:true,opacity:.6,depthWrite:false,side:THREE.DoubleSide});

try{
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.localClippingEnabled=true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setSize(host.clientWidth,host.clientHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
  host.append(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Interactive house. Drag to orbit, scroll to zoom, right-drag to pan. Arrow keys pan. Use the numbered view buttons for alternative angles.');
  scene=new THREE.Scene();scene.background=new THREE.Color('#eeede6');
  camera=new THREE.PerspectiveCamera(38,host.clientWidth/host.clientHeight,.1,300);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=7;controls.maxDistance=110;controls.maxPolarAngle=Math.PI*.48;controls.minPolarAngle=.06;controls.target.set(0,3,3);controls.autoRotateSpeed=.45;controls.enablePan=true;
  controls.listenToKeyEvents(renderer.domElement);controls.addEventListener('start',()=>{transition=null;controls.autoRotate=false;state.orbit=false;$('#rotate').setAttribute('aria-pressed','false');});
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  const environment=pmrem.fromScene(room,.08);scene.environment=environment.texture;scene.environmentIntensity=.32;room.dispose();pmrem.dispose();
  hemi=new THREE.HemisphereLight('#f9fbef','#96987e',2.2);scene.add(hemi);
  sun=new THREE.DirectionalLight('#fff4d7',3.4);sun.position.set(-18,25,8);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=32;sun.shadow.camera.bottom=-32;sun.shadow.camera.near=.5;sun.shadow.camera.far=90;sun.shadow.bias=-.00015;sun.shadow.normalBias=.045;sun.shadow.radius=3;scene.add(sun);
  house=createHouse();scene.add(house.root);
  interiorNavigation=new InteriorNavigation(camera,renderer.domElement,()=>house.groups[interiorRooms.find(r=>r.id===state.room)?.level||'main'].children,toWorld);
  const renderTarget=new THREE.WebGLRenderTarget(host.clientWidth,host.clientHeight,{type:THREE.HalfFloatType,samples:4});
  composer=new EffectComposer(renderer,renderTarget);composer.setPixelRatio(Math.min(devicePixelRatio,1.35));composer.addPass(new RenderPass(scene,camera));aoPass=new GTAOPass(scene,camera,host.clientWidth,host.clientHeight);aoPass.updateGtaoMaterial({radius:.32,thickness:.5,scale:1.0,distanceFallOff:1});aoPass.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:4});aoPass.blendIntensity=.65;composer.addPass(aoPass);composer.addPass(new OutputPass());
  house.root.traverse(o=>{if(o.isMesh)o.userData.originalMaterial=o.material;});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(400,400),new THREE.MeshStandardMaterial({color:'#eeede6',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-1.05;floor.receiveShadow=true;scene.add(floor);
  const roomMarkers=rooms.map(r=>{const label=document.createElement('span');label.className='room-label';label.textContent=r.name;label.hidden=true;$('#room-labels').append(label);return{...r,label,point:new THREE.Vector3(...r.point)};});
  const markers=features.map(f=>{const button=document.createElement('button');button.className='hotspot';button.textContent=f.number;button.dataset.feature=f.id;button.setAttribute('aria-label',f.title);button.addEventListener('click',()=>selectFeature(f.id));$('#hotspots').append(button);return{feature:f,button,point:new THREE.Vector3(...f.point)};});
  const raycaster=new THREE.Raycaster(),projected=new THREE.Vector3();
  function updateMarkers(){
    const w=host.clientWidth,h=host.clientHeight;
    for(const {feature,button,point}of markers){
      projected.copy(point).project(camera);const x=(projected.x*.5+.5)*w,y=(-projected.y*.5+.5)*h;
      let visible=!state.room&&state.floor==='all'&&state.markers&&projected.z<1&&projected.z>-1&&x>58&&x<w-28&&y>185&&y<h-104;
      if(feature.id==='canopy'&&!state.roof)visible=false;
      if(visible){raycaster.set(camera.position,point.clone().sub(camera.position).normalize());const hits=raycaster.intersectObjects(house.root.children,true);const first=hits.find(hit=>!hit.object.material.transparent&&hit.object.parent.name!=='landscape'&&hit.object.parent.visible);if(first&&first.distance<camera.position.distanceTo(point)-.9)visible=false;}
      button.hidden=!visible;button.style.left=`${x}px`;button.style.top=`${y}px`;
    }
    for(const room of roomMarkers){projected.copy(room.point).project(camera);const x=(projected.x*.5+.5)*w,y=(-projected.y*.5+.5)*h;room.label.hidden=room.level!==state.floor||projected.z>1||x<45||x>w-45||y<170||y>h-90;room.label.style.left=`${x}px`;room.label.style.top=`${y}px`;}
    const azimuth=controls.getAzimuthalAngle();$('#orientation-arrow').style.transform=`rotate(${azimuth*180/Math.PI+180}deg)`;
  }
  setView('overview',true);setLight(15);selectFeature('arrival',false);
  let last=0,lastFrame='',lastScene='',lastLightPosition='';renderer.shadowMap.autoUpdate=false;
  renderer.setAnimationLoop(now=>{
    if(document.hidden)return;
    if(transition){const p=Math.min(1,(now-transition.start)/1000),ease=1-Math.pow(1-p,3);camera.position.lerpVectors(transition.from,transition.to,ease);controls.target.lerpVectors(transition.targetFrom,transition.targetTo,ease);if(p===1)transition=null;}
    if(!state.room)controls.update();
    const lightPosition=camera.position.toArray().join('|');
    if(state.room&&lightPosition!==lastLightPosition){updateInteriorLighting();lastLightPosition=lightPosition;}
    const sceneKey=[state.room,state.style,state.floor,state.roof,state.landscape,state.material,state.light].join('|');
    const frameKey=[sceneKey,resizeRevision,...camera.position.toArray(),...camera.quaternion.toArray(),camera.fov].join('|');
    if(frameKey!==lastFrame){
      if(sceneKey!==lastScene){renderer.shadowMap.needsUpdate=true;lastScene=sceneKey;}
      if(state.room)composer.render();else renderer.render(scene,camera);
      lastFrame=frameKey;
    }
    if(now-last>80){updateMarkers();last=now;}
  });
  new ResizeObserver(()=>{if(!host.clientWidth||!host.clientHeight)return;resizeRevision++;const before=camera.aspect;camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);composer?.setSize(host.clientWidth,host.clientHeight);if(state.room){camera.updateProjectionMatrix();interiorNavigation.look();}else if((before<.95)!==(camera.aspect<.95))setView(state.view,true);}).observe(host);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();$('#loading').hidden=false;$('#loading').classList.add('error');$('#loading').textContent='The 3D view was interrupted. Reload the page to restore it. Your reference collection remains available.';});
  $('#loading').hidden=true;
}catch(error){console.error('Unable to start the residence viewer',error);$('#loading').classList.add('error');$('#loading').textContent='The 3D view could not start. Try a browser with hardware acceleration enabled. You can still explore all 44 reference images.';$('#export-model').disabled=true;}

$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(state.floor!=='all')setFloor('all');setView(b.dataset.view);}));
$('#reset').addEventListener('click',()=>state.room?setRoom(state.room):setFloor('all'));
$('#model-tab').addEventListener('click',()=>{$$('dialog[open]').forEach(d=>d.close());setFloor('all');});
function zoom(multiplier){if(!camera)return;if(state.room){interiorNavigation.zoom(multiplier);return;}transition=null;const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*multiplier,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();}
$('#zoom-in').addEventListener('click',()=>zoom(.84));$('#zoom-out').addEventListener('click',()=>zoom(1.19));
$('#rotate').addEventListener('click',()=>{if(!controls)return;transition=null;state.orbit=!state.orbit;controls.autoRotate=state.orbit;$('#rotate').setAttribute('aria-pressed',String(state.orbit));});
$('#floor-select').addEventListener('change',e=>{setFloor(e.target.value);if(matchMedia('(max-width: 760px)').matches)$('#viewport').scrollIntoView({behavior:reduceMotion?'instant':'smooth',block:'start'});});
$('#roof-toggle').addEventListener('change',e=>{state.roof=e.target.checked;if(house)house.groups.roof.visible=state.floor==='all'&&state.roof;});
$('#landscape-toggle').addEventListener('change',e=>{state.landscape=e.target.checked;if(house)house.groups.landscape.visible=state.floor==='all'&&state.landscape;});
$('#hotspot-toggle').addEventListener('change',e=>{state.markers=e.target.checked;});
$$('[data-material]').forEach(b=>b.addEventListener('click',()=>setMaterial(b.dataset.material)));
$('#light').addEventListener('input',e=>setLight(e.target.value));
$('#export-model').addEventListener('click',async()=>{
  if(!house)return;const button=$('#export-model');button.disabled=true;$('#export-status').textContent='Preparing the complete model…';
  let fresh,restore;const exportStyle=state.style;
  try{
    const {GLTFExporter}=await import('./vendor/GLTFExporter.js');
    // Export a fresh full model so toggles never remove part of the delivered asset.
    fresh=createHouse({style:exportStyle});
    const {prepareInteriorExport}=await import('./interior-export.js');
    restore=prepareInteriorExport(fresh.root);
    const data=await new GLTFExporter().parseAsync(fresh.root,{binary:true,onlyVisible:false});
    restore();restore=null;
    const url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));
    const a=document.createElement('a');a.href=url;a.download=`1015-stillwater-${exportStyle}-interiors.glb`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    $('#export-status').textContent='Complete furnished model downloaded with the selected interior scheme.';
  }catch(error){console.error(error);$('#export-status').textContent='The model could not be exported. Please try again.';}
  finally{restore?.();if(fresh){fresh.root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});disposeInteriorMaterials(fresh.interiorMaterials);Object.values(fresh.materials).forEach(m=>m.dispose());}button.disabled=false;}
});

// Structured local integration; no remote requests, uploads or stored client data.
export const viewerAPI={
  getState:()=>({...state,feature:activeFeature}),
  setRoom:(id)=>{if(!interiorRooms.some(r=>r.id===id))throw new Error('Unknown room');setRoom(id);return {...state};},
  setInteriorStyle:(id)=>{if(!interiorStyles.some(s=>s.id===id))throw new Error('Unknown scheme');setInteriorStyle(id);return {...state};},
  setFloor:(floor)=>{if(!['all','ground','main','upper'].includes(floor))throw new Error('Unknown floor');setFloor(floor);return {...state};},
  setView:(view)=>{if(!views[view])throw new Error('Unknown view');setView(view);return {...state};},
  showFeature:(feature)=>{if(!features.some(f=>f.id===feature))throw new Error('Unknown feature');selectFeature(feature);return {...state,feature};},
  showReference:(id)=>{if(!Number.isInteger(id)||id<1||id>44)throw new Error('Reference must be 1–44');openPhoto(id);return refData[id-1];},
};
window.residenceViewer=viewerAPI;
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  const tool={name:'explore_residence',title:'Explore the residence',description:'Move the visible house to a named camera view, optionally opening one client reference image.',inputSchema:{type:'object',properties:{view:{type:'string',enum:Object.keys(views)},reference:{type:'integer',minimum:1,maximum:44}},required:['view'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},async execute(input){
    if(!input||!views[input.view]||Object.keys(input).some(k=>!['view','reference'].includes(k))||(input.reference!==undefined&&(!Number.isInteger(input.reference)||input.reference<1||input.reference>44)))throw new Error('Provide a valid view and optional reference number 1–44.');
    if(!camera)throw new Error('The 3D viewer is unavailable.');
    setView(input.view,true);if(input.reference!==undefined)openPhoto(input.reference);
    return{view:state.view,reference:input.reference??null,modelBasis:'Architectural Revision 8; annotated dimensions and scaled drawing traces'};
  }};
  try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
}
