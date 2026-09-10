import * as THREE from 'three';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { floorData, elevationData } from './plan-data.js';
import { buildSite } from './site-geometry.js';
import { buildCourtyardPalm } from './courtyard-palm.js';
import { createInteriorMaterials, applyInteriorStyle } from './interior-materials.js';
import { buildMainInteriors } from './interior-main.js';
import { buildUpperInteriors } from './interior-upper.js';

// All geometry is in metres. Source plan coordinates are feet, street → water on +Z.
// World Y=0 is the understory structural slab (NGVD 5′3″).
const FT=.3048, IN=.0254, X0=18.5, Z0=43;
export const toWorld = ([x,z],y=0)=>[(x-X0)*FT,y,(z-Z0)*FT];
export const floorLevels={ground:0,main:134*IN,upper:284*IN};
export const dimensions={main:floorLevels.main,upper:floorLevels.upper,roof:413*IN,parapet:425*IN,hvac:473*IN};
const levelKey={understory:'ground',first:'main',second:'upper'};
export const rooms=floorData.floors.flatMap(f=>f.rooms.filter(r=>!/A\/C|Low Voltage|WC|Hall Closet|Foyer Closet|Pool Equipment|Closet -|W\.I\.C\./.test(r.name)).map(r=>({name:r.name.replace('Bathroom #','Bath ').replace('Bedroom #','Bedroom ').replace('Entry (exterior covered walk)','Entry walk').replace('Covered Terrace - north','Covered terrace').replace('Covered Terrace - south','Covered terrace'),level:levelKey[f.id],point:toWorld(r.center_ft,floorLevels[levelKey[f.id]]+.08)})));
export const views={
 overview:{position:[-31,26,41],target:[0,3.5,1.5],caption:'A waterfront residence organized around two open courtyards.'},
 waterfront:{position:[-14,17,47],target:[0,4,7],caption:'Recessed terraces, tall glazing and a pool that extends toward the water.'},
 arrival:{position:[32,20,-42],target:[0,4,-5],caption:'An elevated entrance, shaded balconies and patterned privacy screens.'},
 aerial:{position:[-27,47,30],target:[0,1,0],caption:'The tapered site, three levels and open courtyards, reconstructed from the plans.'},
};
export const features=[
 {id:'arrival',number:'01',title:'A sheltered arrival',point:toWorld([30,21],2.2),photo:2,kicker:'ARCHITECTURAL REFERENCE',description:'The exterior concrete stair rises beside the front bedrooms to a covered entry walk. A separate interior stair and elevator connect all three levels.',view:'arrival'},
 {id:'glazing',number:'02',title:'The waterfront rooms',point:toWorld([28,88],5.3),photo:3,kicker:'ARCHITECTURAL REFERENCE',description:'The great room projects toward the waterfront. Above it, the master bedroom steps back to create a deep terrace, while the family room occupies the other wing.',view:'waterfront'},
 {id:'canopy',number:'03',title:'Open to the sky',point:toWorld([30,41],10.6),photo:17,kicker:'ARCHITECTURAL REFERENCE',description:'Two open courtyards interrupt the long building. A tall palm rises through the larger courtyard beside the stairs. The roof combines solid zones, open frame edges and decorative louvers; the model preserves these openings.',view:'aerial'},
 {id:'pool',number:'04',title:'Pool & inset spa',point:toWorld([9,99],.3),photo:44,kicker:'SITE PLAN · A100',description:'The pool runs toward the waterfront, measuring 26′11¼″ along its long axis. The inset spa is at the waterfront-left corner, with entry steps beside it.',view:'waterfront'},
];
export function createHouse({style='warm'}={}){
 const root=new THREE.Group();root.name='1015 Stillwater — Architectural Rev 8';
 root.userData={units:'metres',basis:'Architectural set Rev 8, sheets A100–A104, A200–A305 and A500–A501; 44 client photographs/renderings.',accuracy:'Annotated dimensions govern where available; other locations are scaled drawing traces. Architectural visualization, not an as-built survey or fabrication/BIM model.',datum:'Y=0: understory structural top of slab, NGVD5ft3in',unconfirmed:'Structural thicknesses and column sizes, detailed finishes, plantings and small fittings are visual approximations.'};
 const groups={};for(const k of ['site','ground','main','upper','roof','landscape','pool','water']){groups[k]=new THREE.Group();groups[k].name=k;root.add(groups[k]);}
 const mat=(name,color,opts={})=>{const m=new THREE.MeshStandardMaterial({name,color,roughness:.79,...opts});return m;};
 const materials={
  stucco:mat('Snowbound SW7004 — specified smooth stucco','#edeae5'),concrete:mat('Concrete — visual approximation','#b8b8b1'),
  stone:mat('Exterior paving — indicative finish','#cfc9b9'),floor:mat('Interior stone — indicative finish','#dfd9ca'),
  dark:mat('Acier SW9170 — specified accent stucco','#9e9991'),frame:mat('Bronze window frames — specified','#4c4539',{metalness:.55,roughness:.42}),
  wood:mat('Teak AWS1 composite — specified finish','#997657'),woodLight:mat('Wood-finished stair treads','#b3916b'),
  glass:new THREE.MeshPhysicalMaterial({name:'Clear glazing — approximate tint',color:'#b3c6c0',roughness:.14,metalness:.06,transparent:true,opacity:.29,depthWrite:false,side:THREE.DoubleSide}),
  poolTile:mat('Pool lining — indicative finish','#789d9b'),water:mat('Pool water','#619b9c',{roughness:.14,metalness:.2,transparent:true,opacity:.77}),
  channel:mat('Waterway context','#8da8a5',{roughness:.39,metalness:.18}),grass:mat('Landscape context','#929b79'),soil:mat('Planting beds','#77725b'),
  leaf:mat('Palm foliage','#637851',{side:THREE.DoubleSide}),leafLight:mat('Landscape foliage','#819268',{side:THREE.DoubleSide}),trunk:mat('Palm trunks','#95816a'),
  light:mat('Warm accent lighting','#fff0ce',{emissive:'#ffcc83',emissiveIntensity:.18}),fixture:mat('Bathroom fixtures — indicative','#f0eee8'),screen:mat('Incline Grey breeze blocks — specified','#a4a39b'),
 };
 const interiorMaterials=createInteriorMaterials(style);
 materials.floor.dispose();materials.floor=interiorMaterials.floorFinish;
 for(const [key,value]of Object.entries(interiorMaterials))if(key!=='floorFinish')materials['interior_'+key]=value;
 const interiorLights=[];
 const unitBox=new THREE.BoxGeometry(1,1,1);
 function box(g,x,y,z,w,h,d,m){if(w<=.0001||h<=.0001||d<=.0001)return;const o=new THREE.Mesh(unitBox,m);o.position.set(x,y,z);o.scale.set(w,h,d);o.castShadow=!m.transparent;o.receiveShadow=true;g.add(o);return o;}
 function fb(g,x,z,w,d,bottom,height,m){const p=toWorld([x,z],bottom+height/2);return box(g,...p,w*FT,height,d*FT,m);}
 function beam(g,a,b,w,d,m){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),dir=bv.clone().sub(av);const o=box(g,...av.clone().add(bv).multiplyScalar(.5).toArray(),w,dir.length(),d,m);if(o)o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return o;}
 function line(g,a,b,bottom,height,width,m){const aa=toWorld(a,bottom+height/2),bb=toWorld(b,bottom+height/2);const o=box(g,(aa[0]+bb[0])/2,bottom+height/2,(aa[2]+bb[2])/2,Math.hypot(bb[0]-aa[0],bb[2]-aa[2]),height,width,m);if(o)o.rotation.y=-Math.atan2(bb[2]-aa[2],bb[0]-aa[0]);return o;}
 function cylinder(g,p,bottom,r,h,m){const q=toWorld(p,bottom+h/2);const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,16),m);o.position.set(...q);o.castShadow=true;o.receiveShadow=true;g.add(o);return o;}
 function slab(g,poly,top,thick,m=materials.stucco,holes=[]){
  const points=poly.map(([x,z])=>new THREE.Vector2((x-X0)*FT,-(z-Z0)*FT));const shape=new THREE.Shape(points);
  holes.forEach(h=>shape.holes.push(new THREE.Path(h.map(([x,z])=>new THREE.Vector2((x-X0)*FT,-(z-Z0)*FT)))));
  const geo=new THREE.ExtrudeGeometry(shape,{depth:thick,bevelEnabled:false,curveSegments:1});geo.rotateX(-Math.PI/2);geo.translate(0,top-thick,0);
  const o=new THREE.Mesh(geo,m);o.castShadow=!m.transparent;o.receiveShadow=true;g.add(o);return o;
 }
 const rect=(x1,z1,x2,z2)=>[[x1,z1],[x1,z2],[x2,z2],[x2,z1]];
 function glazing(g,a,b,base,h,panes=1){
  line(g,a,b,base,h,.024,materials.glass);for(let i=0;i<=panes;i++){const p=[a[0]+(b[0]-a[0])*i/panes,a[1]+(b[1]-a[1])*i/panes];fb(g,p[0],p[1],.15,.15,base-.02,h+.04,materials.frame);}
  for(const y of [base,base+h])line(g,a,b,y-.022,.045,.075,materials.frame);
 }
 function guard(g,a,b,y,glass=false,height=42*IN){
  line(g,a,b,y+height-.025,.035,.045,materials.frame);const len=Math.hypot(b[0]-a[0],b[1]-a[1]);const n=Math.ceil(len/4);
  for(let i=0;i<=n;i++)fb(g,a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n,.13,.13,y,height,materials.frame);
  if(glass)line(g,a,b,y+.08,height-.15,.018,materials.glass);else for(let k=1;k<=9;k++)line(g,a,b,y+height*k/10,.007,.007,materials.frame);
 }
 function breeze(g,a,b,bottom,height){
  const len=Math.hypot(b[0]-a[0],b[1]-a[1])*FT,n=Math.max(1,Math.round(len/(11.4*IN))),rows=Math.max(1,Math.round(height/(11.4*IN))),s=len/n,h=height/rows;
  const assembly=new THREE.Group(),p=toWorld(a,bottom);assembly.position.set(...p);assembly.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);g.add(assembly);
  for(let i=0;i<=n;i++)box(assembly,i*s,height/2,0,.034,height,3.5*IN,materials.screen);
  for(let j=0;j<=rows;j++)box(assembly,len/2,j*h,0,len,.034,3.5*IN,materials.screen);
  for(let i=0;i<n;i++)for(let j=0;j<rows;j++)beam(assembly,[i*s+.025,j*h+.025,0],[(i+1)*s-.025,(j+1)*h-.025,0],.038,3.5*IN,materials.screen);
 }
 function stair(g,a,b,bottom,top,width,count,material=materials.woodLight){
  const outside=material===materials.concrete,guardH=outside?42*IN:36*IN;
  const start=new THREE.Vector3(...toWorld(a,bottom)),end=new THREE.Vector3(...toWorld(b,top)),dir=end.clone().sub(start),len=Math.hypot(dir.x,dir.z),side=new THREE.Vector3(dir.z,0,-dir.x).normalize();
  for(let i=0;i<count;i++){const p=start.clone().lerp(end,(i+.5)/count);const o=box(g,p.x,bottom+(top-bottom)*(i+1)/count-.035,p.z,width*FT,.07,len/count+.012,material);o.rotation.y=Math.atan2(dir.x,dir.z);}
  for(const sign of [-1,1]){const off=side.clone().multiplyScalar(sign*(width*FT/2-.06));beam(g,start.clone().add(off).add(new THREE.Vector3(0,-.09,0)).toArray(),end.clone().add(off).add(new THREE.Vector3(0,-.09,0)).toArray(),.05,.20,outside?materials.concrete:materials.frame);
   if(!outside){const pa=start.clone().add(off),pb=end.clone().add(off),pc=pb.clone().add(new THREE.Vector3(0,guardH,0)),pd=pa.clone().add(new THREE.Vector3(0,guardH,0)),geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([...pa.toArray(),...pb.toArray(),...pc.toArray(),...pa.toArray(),...pc.toArray(),...pd.toArray()],3));geo.computeVertexNormals();g.add(new THREE.Mesh(geo,materials.glass));}
   else for(let k=1;k<9;k++)beam(g,start.clone().add(off).add(new THREE.Vector3(0,guardH*k/9,0)).toArray(),end.clone().add(off).add(new THREE.Vector3(0,guardH*k/9,0)).toArray(),.007,.007,materials.frame);
   beam(g,start.clone().add(off).add(new THREE.Vector3(0,guardH,0)).toArray(),end.clone().add(off).add(new THREE.Vector3(0,guardH,0)).toArray(),.03,.035,materials.frame);
   for(let i=0;i<=4;i++){const p=start.clone().lerp(end,i/4).add(off);beam(g,p.toArray(),p.clone().add(new THREE.Vector3(0,guardH,0)).toArray(),.025,.025,materials.frame);}}
 }
 const schedule=Object.fromEntries(elevationData.windows.map(w=>[w.mark,w]));
 // Wall openings are located in plan; scheduled widths and heights preserve drawing dimensions.
 function perimeter(g,poly,y,height,openings=[]){
  for(let i=0;i<poly.length;i++){
   const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.02)continue;
   const mapped=openings.map(o=>{const center=o.center_ft||(o.a_ft&&o.b_ft?[(o.a_ft[0]+o.b_ft[0])/2,(o.a_ft[1]+o.b_ft[1])/2]:null);if(!center)return null;
    const t=((center[0]-a[0])*dx+(center[1]-a[1])*dz)/(len*len),dist=Math.abs((center[0]-a[0])*dz-(center[1]-a[1])*dx)/len;
    if(dist>.8||t<0||t>1)return null;const spec=schedule[o.mark]||{};const width=o.width_ft||spec.width_feet||(o.a_ft?Math.hypot(o.a_ft[0]-o.b_ft[0],o.a_ft[1]-o.b_ft[1]):3);
    const base=o.sill_ft!==undefined?y+o.sill_ft*FT:spec.base_y_inches!==null&&spec.base_y_inches!==undefined?(spec.base_y_inches+134)*IN:o.mark==='N'?y+1.1:y;
    return{start:Math.max(0,t*len-width/2),end:Math.min(len,t*len+width/2),base,h:(o.height_ft||spec.height_feet||8)*FT,panes:spec.panes_drawn||o.panes||1,door:o.kind==='door',opaque:o.opaque||o.mark==='000'||o.mark==='204',opaqueMaterial:o.mark==='000'?materials.dark:materials.wood};
   }).filter(Boolean).sort((a,b)=>a.start-b.start);
   const at=d=>[a[0]+dx*d/len,a[1]+dz*d/len];
   const cuts=[...new Set([0,len,...mapped.flatMap(op=>[op.start,op.end])])].sort((a,b)=>a-b);
   for(let n=0;n<cuts.length-1;n++){
    const lo=cuts[n],hi=cuts[n+1],mid=(lo+hi)/2;
    const active=mapped.filter(op=>op.start<mid&&op.end>mid).map(op=>[Math.max(y,op.base),Math.min(y+height,op.base+op.h)]).sort((a,b)=>a[0]-b[0]);
    let bottom=y;
    for(const [low,high]of active){if(low>bottom)line(g,at(lo),at(hi),bottom,low-bottom,.23,materials.stucco);bottom=Math.max(bottom,high);}
    if(bottom<y+height)line(g,at(lo),at(hi),bottom,y+height-bottom,.23,materials.stucco);
   }
   for(const op of mapped){const head=Math.min(y+height,op.base+op.h);if(op.opaque)line(g,at(op.start),at(op.end),op.base,head-op.base,.08,op.opaqueMaterial);else glazing(g,at(op.start),at(op.end),op.base,head-op.base,op.panes);}

  }
 }
 const mainY=floorLevels.main,upperY=floorLevels.upper;
 for(const f of floorData.floors){
  const key=levelKey[f.id],g=groups[key],y=floorLevels[key],next=key==='ground'?mainY:key==='main'?upperY:dimensions.roof,height=next-y-.25;
  const stairHole=key==='ground'?null:rect(14.98,30.95,18.98,key==='main'?48.35:52.77);
  const elevatorHole=f.elevator.inner_clear_rectangle_ft;
  for(const region of f.enclosed_regions){
   const holes=[];
   if(region.id.includes('conditioned'))holes.push(stairHole,elevatorHole);
   slab(g,region.polygon_ft,y,.25,materials.stucco,holes);
   slab(g,region.polygon_ft,y+.045,.04,materials.floor,holes);
   let openings=f.exterior_openings||[];
   if(key==='ground'&&region.id==='garage'&&!openings.some(o=>o.mark==='000'))openings=[...openings,{center_ft:[10.75,3.33],width_ft:18,height_ft:9,opaque:true}];
   perimeter(g,region.polygon_ft,y,height,openings);
  }
  for(const region of f.outdoor_regions){const finish=region.id==='front-covered-terrace'?(key==='main'?mainY-5*IN:key==='upper'?upperY-12*IN:y):region.id==='master-terrace'?upperY-4*IN:y;slab(g,region.polygon_ft,finish-.025,.23,materials.stucco);slab(g,region.polygon_ft,finish,.025,materials.stone);}
  for(const wall of f.interior_wall_segments){
   if(wall.id==='master-hall-door')continue;
   const a=wall.a_ft,b=wall.b_ft,dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),at=t=>[a[0]+dx*t,b? a[1]+dz*t:0];
   const wm=wall.material==='glass'?materials.glass:materials.stucco,wt=wall.material==='glass'?.018:wall.thickness_ft*FT;
   const openings=wall.openings||[];let prev=0;
   for(const op of openings.sort((a,b)=>(a.start_ft??0)-(b.start_ft??0))){const lo=Math.max(prev,op.start_ft/len),hi=Math.min(1,op.end_ft/len);if(lo>prev)line(g,at(prev),at(lo),y,height,wt,wm);const doorH=(op.height_ft||8)*FT;line(g,at(lo),at(hi),y+doorH,Math.max(.01,height-doorH),wt,wm);prev=hi;}
   if(prev<1)line(g,at(prev),b,y,height,wt,wm);
  }
  // The separate elevator shaft is open at each slab, with a door facing the hallway.
  const shaft=f.elevator.shaft_envelope_ft;
  perimeter(g,shaft,y,height,[{center_ft:f.elevator.door_center_ft,width_ft:3.3333,height_ft:7,opaque:true}]);
  if(key==='ground')slab(g,f.elevator.inner_clear_rectangle_ft,y+.025,.025,materials.dark);
  if(stairHole){guard(g,[14.92,30.95],[14.92,key==='main'?48.35:52.77],y,true,36*IN);}
 }
 // Main stair: two stacked straight runs ascending toward the street; upper run has a mid-landing.
 stair(groups.ground,[16.857,48.353],[16.857,30.947],2*IN,mainY+2*IN,41/12,20);
 stair(groups.main,[16.857,52.767],[16.857,43.607],mainY+2*IN,mainY+77*IN,41/12,11);
 slab(groups.main,rect(15.149,40.113,18.565,43.607),mainY+77*IN,.08,materials.woodLight);
 stair(groups.main,[16.857,40.113],[16.857,30.953],mainY+77*IN,upperY+2*IN,41/12,11);
 // Exterior stair turns twice beneath the front wing; landing levels follow A305.
 stair(groups.ground,[29.387,10.817],[32.133,10.817],0,26*IN,4,4,materials.concrete);
 slab(groups.ground,rect(32.133,8.647,36.460,12.980),26*IN,.15,materials.concrete);
 stair(groups.ground,[34.297,12.980],[34.297,21.227],26*IN,91*IN,4,10,materials.concrete);
 slab(groups.ground,rect(32.133,21.227,36.460,25.553),91*IN,.15,materials.concrete);
 stair(groups.ground,[32.133,23.390],[27.553,23.390],91*IN,129*IN,4,6,materials.concrete);
 slab(groups.main,rect(24.47,21.23,27.553,25.55),129*IN,.16,materials.stucco);
 // Lower columns come directly from traced plan circles. Upper exterior columns follow the balcony structure.
 for(const c of floorData.columns||[]){
  cylinder(groups.ground,c.center_ft,0,c.drawn_diameter_ft*FT/2,mainY-.25,materials.stucco);
 }
 for(const c of floorData.upper_columns||[]){
  for(const key of c.levels){const bottom=floorLevels[key],top=key==='main'?upperY:dimensions.roof-.2;cylinder(groups[key],c.center_ft,bottom,c.drawn_diameter_ft*FT/2,top-bottom,materials.stucco);}
 }
 for(const c of floorData.metal_column_center_traces||[]){const key=c.source_page===10?'upper':'main',bottom=floorLevels[key],top=key==='main'?upperY:dimensions.roof;fb(groups[key],c.center_ft[0],c.center_ft[1],.5,.5,bottom,top-bottom,materials.frame);}
 // Front breeze-block screen and upper terrace guard follow the elevation material legend.
 breeze(groups.main,[.45,-3.4],[26.43,-3.4],mainY-5*IN,9.9*FT);
 breeze(groups.upper,[.45,-3.4],[26.43,-3.4],upperY-12*IN,48*IN);
 breeze(groups.main,[24.4,28],[24.4,49.9],mainY,42*IN);
 // Balcony cable guards and the recessed master terrace.
 guard(groups.main,[-.6,81.1],[16.7,81.1],mainY);guard(groups.main,[-.6,72],[-.6,81.1],mainY);
 guard(groups.main,[16.8,81.1],[16.8,89.8],mainY);guard(groups.main,[16.8,89.8],[36.6,89.8],mainY);
 guard(groups.upper,[19.2,87.7],[35.2,87.7],upperY-4*IN);guard(groups.upper,[19.2,76.2],[19.2,87.7],upperY-4*IN);guard(groups.upper,[35.2,87.7],[36,76.2],upperY-4*IN);
 // Finished interior staging is independent of the measured architectural shell.
 const interiorResults=[];
 for(const [key,builder]of [['main',buildMainInteriors],['upper',buildUpperInteriors]]){
  const g=groups[key],floorY=floorLevels[key];
  interiorResults.push(builder({THREE,group:g,materials:interiorMaterials,toWorld,floorY}));
  const f=floorData.floors.find(f=>levelKey[f.id]===key);
  for(const region of f.enclosed_regions){
   const holes=[rect(14.98,30.95,18.98,52.77),f.elevator.inner_clear_rectangle_ft];
   slab(g,region.polygon_ft,floorY+(key==='main'?3.16:2.86),.06,interiorMaterials.plaster,holes);
  }
 }
 for(const item of interiorResults)for(const light of item?.lights||[]){light.userData.baseIntensity=light.intensity;interiorLights.push(light);}
 buildSite({groups,materials,slab,line,fb,cylinder,breeze,FT,IN,toWorld,rect,dimensions});
 // Planting is a restrained context layer; species/positions are illustrative.
 let seed=17;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 function palm(x,z,h,size){const [wx,,wz]=toWorld([x,z]);beam(groups.landscape,[wx,0,wz],[wx+.2,h,wz+.1],.16,.16,materials.trunk);
  for(let fr=0;fr<9;fr++){const theta=fr*Math.PI*2/9+rand()*.25,dir=new THREE.Vector3(Math.cos(theta),0,Math.sin(theta)),perp=new THREE.Vector3(-dir.z,0,dir.x),center=new THREE.Vector3(wx+.2,h,wz+.1),verts=[];
   for(let n=1;n<14;n++){const t=n/14,p=center.clone().addScaledVector(dir,size*t).add(new THREE.Vector3(0,Math.sin(t*Math.PI)*.6-t*.8,0));for(const sign of [-1,1]){const tip=p.clone().addScaledVector(perp,Math.sin(t*Math.PI)*size*.23*sign).addScaledVector(dir,size*.1);verts.push(...p.clone().addScaledVector(dir,-.075).toArray(),...tip.toArray(),...p.clone().addScaledVector(dir,.075).toArray());}}
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,materials.leaf);mesh.castShadow=true;groups.landscape.add(mesh);}
 }
 for(const p of [[-7,-10,5,2],[-6,21,4.9,2],[-5,56,5.4,2.2],[-4,100,4.8,2],[45,10,5.9,2.3],[42,60,5.8,2.4],[38,108,4.6,2]])palm(...p);
 materials.leafLight.side=THREE.DoubleSide;
 root.userData.courtyardPalm=buildCourtyardPalm({group:groups.landscape,materials,toWorld,position:[31.5,39],trunkHeight:9.2,spread:1.85});
 const shrubGeo=new THREE.IcosahedronGeometry(1,1);
 for(let i=0;i<100;i++){const z=-15+rand()*126,x=i%2?46-(z+15)*.044:-9+(z+15)*.04,p=toWorld([x,z],.22+rand()*.22);const o=new THREE.Mesh(shrubGeo,materials.leafLight);o.position.set(...p);o.scale.set(.28+rand()*.18,.28+rand()*.22,.32+rand()*.2);o.castShadow=true;groups.landscape.add(o);}
 for(const f of floorData.floors.filter(f=>f.id==='understory'))for(const c of f.voids.filter(v=>v.id.includes('court'))){slab(groups.landscape,c.polygon_ft,-.02,.08,materials.soil);}
 // One mesh per material per floor keeps orbiting and section views fast on mobile.
 for(const group of Object.values(groups)){
  group.updateMatrixWorld(true);const batches=new Map();const retained=[];group.traverse(o=>{if(o.isLight){o.updateWorldMatrix(true,false);const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();o.matrixWorld.decompose(position,quaternion,scale);retained.push({object:o,position,quaternion});}});group.traverse(o=>{if(!o.isMesh)return;const key=o.material.uuid;if(!batches.has(key))batches.set(key,{material:o.material,geometries:[]});let geo=o.geometry.clone();geo.applyMatrix4(o.matrixWorld);if(geo.index)geo=geo.toNonIndexed();if(!geo.getAttribute('uv'))geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count*2),2));for(const key of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(key))geo.deleteAttribute(key);batches.get(key).geometries.push(geo);});group.clear();for(const r of retained){r.object.position.copy(r.position);r.object.quaternion.copy(r.quaternion);group.add(r.object);}
  for(const {material,geometries}of batches.values()){const geo=mergeGeometries(geometries,false);const mesh=new THREE.Mesh(geo,material);mesh.name=`${group.name} / ${material.name}`;mesh.castShadow=!material.transparent&&group.name!=='water';mesh.receiveShadow=true;group.add(mesh);geometries.forEach(g=>g.dispose());}
 }
 const setInteriorStyle=id=>{applyInteriorStyle(interiorMaterials,id);root.userData.interiorStyle=id;};
 setInteriorStyle(style);root.userData.staging='Proposed finished interiors. Reference-supported vanity, stone and wood appearances; three optional furnishing/finish schemes are design concepts.';
 return{root,groups,materials,interiorMaterials,interiorLights,interiorResults,setInteriorStyle};
}
