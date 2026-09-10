// Furniture and lighting are proposed staging within the A102 floor boundaries.
// Kitchen materials follow the confirmed lighter direction; exact products remain approximations.
export function buildMainInteriors({THREE,group,materials:m,toWorld,floorY}) {
 const FT=.3048, F=floorY+2*.0254, ceiling=3.10-2*.0254, lights=[], rooms=[], cache=new Map();
 const stats={meshes:0,triangles:0,lights:0,uniqueMaterials:0,design:'Proposed contemporary furnishing palettes with a fixed light kitchen finish interpretation'};
 const used=new Set(), accentFabric=m.accentFabric||m.rug;
 function mesh(g,geometry,material,x=0,y=0,z=0,rx=0,ry=0,rz=0){
  const o=new THREE.Mesh(geometry,material);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);
  o.castShadow=!material.transparent;o.receiveShadow=true;g.add(o);stats.meshes++;
  stats.triangles+=(geometry.index?geometry.index.count:geometry.attributes.position.count)/3;used.add(material);return o;
 }
 function node(x,z,ry=0,name=''){const g=new THREE.Group();g.name=name;g.position.set(...toWorld([x,z],F));g.rotation.y=ry;group.add(g);return g;}
 function nested(parent,x,y,z,ry=0){const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=ry;parent.add(g);return g;}
 const boxGeo=new THREE.BoxGeometry(1,1,1);
 function box(g,w,h,d,x,y,z,mat=m.oak,ry=0){const o=mesh(g,boxGeo,mat,x,y,z,0,ry);o.scale.set(w,h,d);return o;}
 function roundGeo(w,h,d,r){
  const key=[w,h,d,r].join(':');if(cache.has(key))return cache.get(key);
  r=Math.min(r,w*.49,h*.49,d*.49);const pos=[],uv=[],ids=[];
  const coords=size=>[-size/2,-size/2+r*(1-Math.cos(Math.PI/6)),-size/2+r*.5,-size/2+r,size/2-r,size/2-r*.5,size/2-r*(1-Math.cos(Math.PI/6)),size/2];
  const c=[coords(w),coords(h),coords(d)],half=[w/2,h/2,d/2];
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
   const a=(axis+1)%3,b=(axis+2)%3,start=pos.length/3;
   for(let i=0;i<8;i++)for(let j=0;j<8;j++){
    const p=[0,0,0];p[axis]=half[axis]*sign;p[a]=c[a][i];p[b]=c[b][j];
    const core=p.map((v,k)=>Math.max(-half[k]+r,Math.min(half[k]-r,v)));
    const delta=p.map((v,k)=>v-core[k]),len=Math.hypot(...delta);
    pos.push(...p.map((v,k)=>core[k]+delta[k]*r/len));uv.push(i/7,j/7);
   }
   for(let i=0;i<7;i++)for(let j=0;j<7;j++){
    const q=start+i*8+j;if(sign>0)ids.push(q,q+8,q+9,q,q+9,q+1);else ids.push(q,q+9,q+8,q,q+1,q+9);
   }
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(ids);geo.computeVertexNormals();cache.set(key,geo);return geo;
 }
 function soft(g,w,h,d,r,x,y,z,mat=m.linen,ry=0,rx=0,rz=0){return mesh(g,roundGeo(w,h,d,r),mat,x,y,z,rx,ry,rz);}
 // Soft convex faces keep scatter cushions from reading as framed rectangular panels.
 function pillow(g,w,h,d,x,y,z,mat=accentFabric,rx=-.12,rz=0){
  const geo=roundGeo(w,h,d,.055).clone(),a=geo.attributes.position;
  for(let i=0;i<a.count;i++){
   const px=a.getX(i),py=a.getY(i),pz=a.getZ(i);
   const bulge=.034*Math.cos(Math.min(1,Math.abs(px)/(w/2))*Math.PI/2)*Math.cos(Math.min(1,Math.abs(py)/(h/2))*Math.PI/2);
   a.setZ(i,pz+Math.sign(pz)*bulge);
  }
  geo.computeVertexNormals();return mesh(g,geo,mat,x,y,z,rx,0,rz);
 }
 // A continuous curved textile section folds naturally around the mattress edges.
 function bedThrow(g,width){
  const top=[],n=34;
  for(let i=0;i<=n;i++){
   const t=i/n,x=-width/2-.024+t*(width+.048);
   const edge=Math.max(0,(Math.abs(x)-(width/2-.035))/.059);
   const y=.742-.265*edge*edge+.004*Math.sin(t*Math.PI*8)*(1-edge);
   top.push([x,y]);
  }
  const shape=new THREE.Shape();shape.moveTo(...top[0]);top.slice(1).forEach(p=>shape.lineTo(...p));
  [...top].reverse().forEach(([x,y])=>shape.lineTo(x,y-.006));shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:.54,bevelEnabled:false,curveSegments:1});
  mesh(g,geo,accentFabric,0,0,-.87);
 }
 function cyl(g,rt,rb,h,x,y,z,mat=m.oak,segments=24){return mesh(g,new THREE.CylinderGeometry(rt,rb,h,segments),mat,x,y,z);}
 function sphere(g,r,x,y,z,mat=m.ceramic,sx=1,sy=1,sz=1){const o=mesh(g,new THREE.SphereGeometry(r,16,10),mat,x,y,z);o.scale.set(sx,sy,sz);return o;}
 function rod(g,a,b,r,mat=m.bronze){const aa=new THREE.Vector3(...a),bb=new THREE.Vector3(...b),v=bb.clone().sub(aa);const o=cyl(g,r,r,v.length(),...aa.clone().add(bb).multiplyScalar(.5).toArray(),mat,10);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;}
 function tube(g,points,r,mat=m.bronze,segments=24){return mesh(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),segments,r,8,false),mat);}
 function lathe(g,profile,x,y,z,mat=m.ceramic,scale=1){const geo=new THREE.LatheGeometry(profile.map(([r,h])=>new THREE.Vector2(r*scale,h*scale)),24);return mesh(g,geo,mat,x,y,z);}
 function tray(g,x,y,z,scale=1){lathe(g,[[.005,0],[.20,0],[.24,.025],[.24,.045],[.215,.04],[.19,.015],[.005,.015]],x,y,z,m.stone,scale);}
 function vase(g,x,y,z,scale=1,mat=m.ceramic){lathe(g,[[.01,0],[.10,0],[.13,.04],[.15,.17],[.11,.28],[.065,.34],[.065,.37],[.05,.37],[.05,.335],[.095,.275],[.13,.17],[.11,.05],[.01,.02]],x,y,z,mat,scale);}
 function book(g,x,y,z,w=.25,d=.31,h=.035,cover=m.art,angle=.1){const n=nested(g,x,y,z,angle);box(n,w,.005,d,0,.0025,0,cover);box(n,w-.009,h-.01,d-.012,0,h/2,0,m.linen);box(n,w,.005,d,0,h-.0025,0,cover);box(n,.006,h,d,-w/2,h/2,0,cover);return n;}
 function plant(g,x,y,z,scale=1){
  lathe(g,[[.01,0],[.14,0],[.20,.30],[.19,.33],[.17,.33],[.17,.29],[.13,.03],[.01,.02]],x,y,z,m.ceramic,scale);
  cyl(g,.167*scale,.167*scale,.018*scale,x,y+.29*scale,z,m.dark,20);
  for(let i=0;i<11;i++){
   const a=i*2.39996,h=(.43+(i%4)*.14)*scale,ex=x+Math.cos(a)*(.20+(i%3)*.055)*scale,ez=z+Math.sin(a)*(.20+(i%3)*.055)*scale;
   rod(g,[x,y+.26*scale,z],[ex,y+h,ez],.005*scale,m.leaf);
   const positions=[],uv=[],indices=[],len=.30*scale,width=.09*scale;
   for(let k=0;k<=7;k++){
    const t=k/7,spread=Math.sin(Math.PI*t)*width,bend=Math.sin(Math.PI*t)*.045*scale;
    positions.push(-spread,bend,t*len,spread,bend,t*len);uv.push(0,t,1,t);
    if(k<7){const b=2*k;indices.push(b,b+1,b+2,b+1,b+3,b+2,b+2,b+1,b,b+2,b+3,b+1);}
   }
   const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
   mesh(g,geo,m.leaf,ex,y+h,ez,-.5-(i%3)*.16,a,0);
  }
 }
 function rug(x,z,w,d){const g=node(x,z,0,'Woven rug');soft(g,w,.014,d,.03,0,.010,0,m.rug);return g;}
 function lamp(g,x,y,z,scale=.8){cyl(g,.12*scale,.15*scale,.055*scale,x,y+.03*scale,z,m.stone);rod(g,[x,y+.05*scale,z],[x,y+.47*scale,z],.018*scale,m.bronze);lathe(g,[[.24,.0],[.18,.27],[.175,.27],[.23,.0]],x,y+.33*scale,z,m.linen,scale);cyl(g,.09*scale,.09*scale,.012,x,y+.49*scale,z,m.emissive,16);}
 function sideTable(g,x,z,r=.28,h=.48){cyl(g,r,r,.045,x,h-.022,z,m.marble);cyl(g,r*.43,r*.5,h-.055,x,(h-.055)/2,z,m.walnut);return h;}
 function sofa(x,z,w=2.75,ry=0){
  const g=node(x,z,ry,'Tailored upholstered sofa');
  for(const a of [-1,1])for(const b of [-1,1])cyl(g,.025,.031,.12,a*(w/2-.17),.06,b*.32,m.bronze,12);
  soft(g,w-.12,.20,.84,.06,0,.23,0,m.boucle);
  const cw=(w-.38)/3;
  for(let i=0;i<3;i++){
   soft(g,cw-.018,.18,.68,.065,(i-1)*cw,.425,.09,m.linen);
   soft(g,cw-.018,.45,.20,.073,(i-1)*cw,.69,-.31,m.boucle,0,-.10);
  }
  soft(g,.18,.57,.96,.06,-w/2+.09,.425,0,m.boucle);soft(g,.18,.57,.96,.06,w/2-.09,.425,0,m.boucle);
  pillow(g,.40,.40,.145,-w*.30,.72,-.16,accentFabric,-.12,-.13);
  pillow(g,.45,.43,.16,w*.30,.72,-.16,m.linen,-.15,.16);
  // Folded wool throw has a draped vertical end and separate rolled edge.
  soft(g,.44,.016,.64,.008,w*.30,.523,.16,accentFabric);soft(g,.44,.26,.016,.008,w*.30,.39,.473,accentFabric);
  return g;
 }
 function upholsteredChair(x,z,ry=0,scale=1,high=false){
  const g=node(x,z,ry,high?'Counter stool':'Upholstered dining chair');g.scale.setScalar(scale);
  const sh=high?.66:.45;
  for(const a of [-1,1])for(const b of [-1,1])rod(g,[a*.23,.035,b*.225],[a*.18,sh-.055,b*.17],.025,m.walnut);
  soft(g,.54,.13,.54,.065,0,sh,0,m.linen);
  // Curved upholstered shell is a closed C-shaped annulus, rather than a flat panel.
  const shape=new THREE.Shape(),r=.305,inner=.255;
  shape.absarc(0,.045,r,0,Math.PI,false);shape.lineTo(-inner,.045);
  shape.absarc(0,.045,inner,Math.PI,0,true);shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:.36,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.018,bevelThickness:.018,curveSegments:12});
  geo.rotateX(-Math.PI/2);mesh(g,geo,m.boucle,0,sh+.055,-.02);
  if(high)rod(g,[-.22,.24,.19],[.22,.24,.19],.016,m.bronze);
  return g;
 }
 function loungeChair(x,z,ry=0){
  const g=node(x,z,ry,'Sculptural lounge chair');cyl(g,.25,.29,.10,0,.075,0,m.walnut);
  soft(g,.81,.24,.83,.11,0,.27,0,m.boucle);
  soft(g,.69,.48,.18,.075,0,.58,-.31,m.boucle,0,-.14);
  soft(g,.14,.38,.79,.065,-.365,.40,.02,m.boucle);soft(g,.14,.38,.79,.065,.365,.40,.02,m.boucle);
  soft(g,.52,.16,.61,.07,0,.41,.09,m.linen);
  return g;
 }
 function point(g,x,y,z,intensity=22,distance=6,zone='main'){const lightColor=m.emissive.emissive?.getHex()?m.emissive.emissive:m.emissive.color;const l=new THREE.PointLight(lightColor,intensity,distance,2);l.position.set(x,y,z);l.castShadow=false;l.userData={interior:true,zone,paletteMaterial:'emissive'};g.add(l);lights.push(l);return l;}
 function recessed(x,z,zone='main',lit=false){const g=node(x,z,0,'Recessed ceiling light');cyl(g,.069,.069,.018,0,ceiling-.018,0,m.bronze,20);cyl(g,.048,.048,.020,0,ceiling-.032,0,m.emissive,20);if(lit)point(g,0,ceiling-.12,0,16,6,zone);}
 function pendant(g,x,z,y=2.38,kind='globe'){
  cyl(g,.065,.065,.035,x,ceiling-.07,z,m.bronze,16);rod(g,[x,ceiling-.085,z],[x,y+.10,z],.007,m.bronze);
  if(kind==='cone'){lathe(g,[[.18,0],[.055,.18],[.045,.18],[.168,0]],x,y,z,m.ceramic);cyl(g,.125,.125,.014,x,y-.005,z,m.emissive,20);}
  else{sphere(g,.12,x,y,z,m.emissive);cyl(g,.045,.045,.06,x,y+.11,z,m.bronze,12);}
 }
 function abstractArt(x,z,ry,w=1.45,h=.85){
  const g=node(x,z,ry,'Framed abstract relief');box(g,w+.045,h+.045,.06,0,1.68,0,m.walnut);box(g,w,h,.018,0,1.68,.039,m.plaster);
  const a=sphere(g,.23,-w*.17,1.65,.07,m.art,1.5,1.15,.09);a.rotation.z=.35;
  sphere(g,.20,w*.18,1.77,.07,m.stone,.8,1.35,.12);
  rod(g,[-w*.34,1.4,.09],[w*.34,1.91,.09],.012,m.bronze);
  return g;
 }

 // Great room: eight-seat dining toward the foyer; lower seating faces the water.
 rug(28.25,65.55,3.25,3.72);
 const dining=node(28.25,65.55,0,'Eight-seat oak and marble dining table');
 soft(dining,1.09,.065,2.62,.23,0,.76,0,m.marble);
 for(const z of [-.75,.75]){soft(dining,.58,.65,.35,.13,0,.365,z,m.oak);box(dining,.50,.025,.28,0,.026,z,m.bronze);}
 for(const z of [62.55,65.55,68.55]){upholsteredChair(25.43,z,Math.PI/2);upholsteredChair(31.07,z,-Math.PI/2);}
 upholsteredChair(28.25,60.66,0);upholsteredChair(28.25,70.44,Math.PI);
 tray(dining,0,.795,0,.65);vase(dining,0,.808,-.13,.62,m.ceramic);sphere(dining,.06,.10,.835,.11,m.art);sphere(dining,.055,-.065,.84,.16,m.art);
 // Suspended branching chandelier stays below the main ceiling; warm bulbs are modeled.
 rod(dining,[-.30,2.38,-.88],[.30,2.38,.88],.018,m.bronze);
 for(let i=0;i<6;i++){
  const z=-.86+i*.344,x=(i%2?1:-1)*.34;
  rod(dining,[z*.35,2.38,z],[x,2.26+(i%2)*.14,z],.011,m.bronze);
  sphere(dining,.095,x,2.26+(i%2)*.14,z,m.emissive);
 }
 rod(dining,[0,ceiling-.06,0],[0,2.39,0],.011,m.bronze);cyl(dining,.1,.1,.035,0,ceiling-.045,0,m.bronze);point(dining,0,2.30,0,30,6,'great-room');
 rug(27.8,80.4,3.95,3.50);
 sofa(27.65,76.5,2.78,0);
 loungeChair(24.0,82.70,Math.PI*.84);loungeChair(32.10,82.45,-Math.PI*.83);
 const coffee=node(27.7,80.05,0,'Rounded nesting coffee tables');
 soft(coffee,1.25,.065,.76,.29,0,.355,0,m.stone);cyl(coffee,.25,.27,.30,0,.17,0,m.oak);
 cyl(coffee,.32,.32,.045,.57,.475,.31,m.walnut);cyl(coffee,.12,.16,.435,.57,.24,.31,m.walnut);
 book(coffee,-.14,.391,.01,.27,.34,.038,m.art,-.16);book(coffee,-.14,.430,.01,.23,.29,.027,m.oak,.06);vase(coffee,.27,.392,-.12,.56);tray(coffee,.56,.50,.31,.62);
 const side=node(33.10,77.60,0,'Stone side table and reading lamp');sideTable(side,0,0,.27,.51);lamp(side,0,.512,0,.78);
 const cred=node(34.65,72.8,-Math.PI/2,'Walnut sideboard');
 soft(cred,2.20,.49,.43,.035,0,.355,0,m.walnut);
 for(const x of [-.97,.97])for(const z of [-.14,.14])cyl(cred,.018,.024,.10,x,.065,z,m.bronze,10);
 for(let i=0;i<4;i++){box(cred,.526,.40,.020,-.819+i*.546,.363,.227,m.oak);cyl(cred,.012,.012,.025,-.82+i*.546,.38,.248,m.bronze,10).rotation.x=Math.PI/2;}
 box(cred,2.22,.032,.45,0,.619,0,m.stone);book(cred,-.62,.637,0,.26,.29,.04,m.art);vase(cred,.65,.636,0,.87);vase(cred,.30,.636,.04,.5,m.stone);
 abstractArt(35.81,72.8,-Math.PI/2-Math.atan(1.95/28.73),1.8,.98);
 const greenery=node(33.2,85.5,0,'Waterfront indoor planting');plant(greenery,0,0,0,1.20);
 for(const [x,z] of [[22.1,62.0],[34.3,63.0],[22.1,73],[34.1,72.8],[22.0,85.4],[33.1,85.3]])recessed(x,z,'great-room',z===73||z===85.3);

 // Light kitchen interpretation: dedicated cabinet/counter keys remain fixed across palettes.
 // Cabinet depth is 650mm; appliance faces, hardware and staging retain their own materials.
 const run=node(-.85,47.15,0,'Kitchen window cabinetry');
 box(run,.58,.10,3.85,-.018,.06,0,m.dark);box(run,.64,.73,3.85,0,.465,0,m.kitchenCabinet);
 for(let i=0;i<8;i++){
  const z=-1.675+i*.4786;
  box(run,.022,.684,.46,.331,.47,z,m.kitchenCabinet);
  if(i<3){for(const y of [.365,.59])box(run,.025,.007,.46,.345,y,z,m.dark);}
  rod(run,[.355,.66,z-.13],[.355,.66,z+.13],.006,m.bronze);
 }
 // The countertop has a real aperture for the inset basin.
 const topShape=new THREE.Shape();topShape.moveTo(-.35,-1.98);topShape.lineTo(.35,-1.98);topShape.lineTo(.35,1.98);topShape.lineTo(-.35,1.98);topShape.closePath();
 const hole=new THREE.Path();hole.moveTo(-.24,-.39);hole.lineTo(.24,-.39);hole.lineTo(.24,.22);hole.lineTo(-.24,.22);hole.closePath();topShape.holes.push(hole);
 const tg=new THREE.ExtrudeGeometry(topShape,{depth:.045,bevelEnabled:false});tg.rotateX(-Math.PI/2);mesh(run,tg,m.kitchenCounter,0,.83,0);
 // The plan projection flips Z after extrusion; the sink remains centered in the aperture.
 box(run,.46,.035,.585,0,.685,.085,m.dark);
 for(const x of [-.245,.245])box(run,.018,.16,.62,x,.768,.085,m.bronze);
 for(const z of [-.225,.395])box(run,.49,.16,.018,0,.768,z,m.bronze);
 tube(run,[[-.265,.88,.09],[-.265,1.18,.09],[-.14,1.30,.09],[.095,1.28,.09],[.125,1.08,.09]],.012,m.bronze,28);
 rod(run,[-.27,.88,.27],[-.27,.98,.27],.018,m.bronze);
 box(run,.025,.14,3.88,-.335,.92,0,m.kitchenCounter);
 box(run,.018,.010,3.70,.34,.125,0,m.emissive);
 const tall=node(-.25,39.55,0,'Integrated refrigerator');box(tall,.76,2.45,.92,0,1.24,0,m.kitchenCabinet);
 for(const z of [-.23,.23]){box(tall,.025,2.26,.436,.393,1.28,z,m.kitchenCabinet);rod(tall,[.413,1.03,z+.12],[.413,1.72,z+.12],.012,m.bronze);}
 box(tall,.030,.005,.90,.41,.80,0,m.dark);
 const pantry=node(2.65,38.7,0,'Pantry and oven tower');box(pantry,1.18,2.44,.59,0,1.23,0,m.kitchenCabinet);
 for(const x of [-.302,.302])box(pantry,.568,1.17,.025,x,1.79,.312,m.kitchenCabinet);
 box(pantry,.55,.60,.030,-.302,.91,.316,m.dark);box(pantry,.48,.36,.020,-.302,.86,.337,m.glass);rod(pantry,[-.52,1.095,.356],[-.09,1.095,.356],.012,m.bronze);
 box(pantry,.55,.55,.026,.302,.90,.316,m.kitchenCabinet);box(pantry,1.16,.17,.025,0,.195,.312,m.kitchenCabinet);
 const island=node(5.35,46.05,0,'Waterfall stone island');
 box(island,.94,.10,2.34,0,.06,0,m.dark);soft(island,1.04,.73,2.37,.018,0,.465,0,m.kitchenCabinet);
 soft(island,1.20,.055,2.61,.032,0,.862,0,m.kitchenCounter);
 for(const z of [-1.28,1.28])box(island,1.20,.81,.055,0,.43,z,m.kitchenCounter);
 for(let i=0;i<38;i++)box(island,.028,.68,.021,.535,.46,-1.11+i*.060,m.kitchenCabinet);
 for(const z of [-.77,0,.77]){box(island,.022,.68,.73,-.536,.46,z,m.kitchenCabinet);rod(island,[-.554,.67,z-.20],[-.554,.67,z+.20],.006,m.bronze);}
 soft(island,.76,.012,.59,.035,0,.898,-.57,m.dark);
 for(const [x,z,rr] of [[-.20,-.70,.09],[.19,-.69,.105],[0,-.39,.082]])mesh(island,new THREE.TorusGeometry(rr,.0025,6,24),m.bronze,x,.906,z,Math.PI/2);
 tray(island,0,.89,.65,.82);vase(island,.03,.90,.71,.8);book(island,-.14,.89,.98,.23,.29,.028,m.art,-.05);
 for(const z of [43.45,46.05,48.65])upholsteredChair(8.65,z,-Math.PI/2,.94,true);
 for(const z of [-.75,.75])pendant(island,0,z,2.22,'cone');point(island,0,2.1,0,24,5,'kitchen');
 recessed(2.0,42.7,'kitchen');recessed(2.0,50.8,'kitchen',true);
 const bowl=node(.0,51.7);tray(bowl,0,.88,0,.75);for(let i=0;i<4;i++)sphere(bowl,.045,Math.cos(i*2.2)*.075,.943,Math.sin(i*2.2)*.075,m.art);

 // Family lounge preserves the sliding-door approach at Z70–72.
 rug(4.7,65.4,2.75,2.70);sofa(1.20,65.1,2.15,Math.PI/2);
 const family=node(5.75,65.5,0,'Family lounge coffee table');cyl(family,.39,.39,.052,0,.375,0,m.marble);cyl(family,.17,.23,.32,0,.19,0,m.walnut);book(family,.0,.404,.0,.25,.29,.025,m.art,.16);vase(family,.15,.405,.09,.43);
 const media=node(9.0,65.2,-Math.PI/2,'Family media cabinet');soft(media,1.78,.38,.39,.035,0,.31,0,m.walnut);box(media,1.80,.030,.40,0,.52,0,m.stone);
 for(let i=0;i<4;i++)box(media,.43,.31,.022,-.665+i*.445,.33,.211,m.oak);
 box(media,1.39,.795,.043,0,1.105,-.13,m.dark);box(media,1.31,.715,.013,0,1.105,-.102,m.glass);rod(media,[-.39,.56,-.11],[-.28,.705,-.11],.013,m.bronze);rod(media,[.39,.56,-.11],[.28,.705,-.11],.013,m.bronze);
 const fp=node(.15,70.0);plant(fp,0,0,0,.8);recessed(3,62,'family-room',true);recessed(7,68.7,'family-room');

 function bed(x,z,width=1.8,ry=0,name='Guest bed'){
  const g=node(x,z,ry,name);
  for(const a of [-1,1])for(const b of [-1,1])cyl(g,.026,.03,.12,a*(width/2-.12),.06,b*.83,m.walnut,10);
  soft(g,width+.12,.23,2.16,.05,0,.25,0,m.oak);
  soft(g,width,.25,2.03,.08,0,.49,0,m.linen);
  soft(g,width-.035,.10,1.53,.055,0,.65,-.18,m.linen);
  soft(g,width+.28,1.15,.15,.065,0,.695,1.09,m.boucle);
  const n=width>1.3?2:1;
  for(let i=0;i<n;i++)soft(g,width/n-.15,.16,.47,.078,(i-(n-1)/2)*width/n,.73,.66,m.linen,0,.11,i%2?.035:-.035);
  bedThrow(g,width);
  return g;
 }
 function wardrobe(x,z,length,ry=0){const g=node(x,z,ry,'Flush oak wardrobe');box(g,length,2.38,.56,0,1.20,0,m.oak);const n=Math.max(2,Math.round(length/.48));for(let i=0;i<n;i++){const w=length/n;box(g,w-.012,2.26,.025,(i-(n-1)/2)*w,1.24,.294,m.walnut);rod(g,[(i-(n-1)/2)*w+w*.35,.97,.319],[(i-(n-1)/2)*w+w*.35,1.44,.319],.006,m.bronze);}return g;}
 rug(18.25,8.75,2.95,2.93);bed(18.25,8.75,1.80,0,'Guest suite bed');
 for(const x of [14.28,22.22]){const g=node(x,11.7);soft(g,.47,.42,.43,.025,0,.28,0,m.walnut);box(g,.45,.015,.42,0,.50,0,m.stone);box(g,.42,.18,.020,0,.32,-.226,m.oak);lamp(g,0,.51,0,.65);}
 wardrobe(11.65,7.1,1.60,Math.PI/2);
 const gb=node(18.25,4.10);soft(gb,1.12,.12,.38,.055,0,.48,0,m.boucle);for(const x of [-.43,.43])rod(gb,[x,.06,0],[x,.42,0],.026,m.walnut);
 recessed(17.3,5.0,'guest-suite',true);recessed(20.0,12.5,'guest-suite');
 bed(3.90,6.1,1.06,0,'Service bedroom bed');rug(4.4,5.9,1.72,2.30);
 const sd=node(9.1,2.6,Math.PI/2,'Compact writing desk');soft(sd,1.05,.040,.47,.022,0,.74,0,m.oak);for(const x of [-.45,.45])box(sd,.04,.71,.40,x,.365,0,m.walnut);book(sd,.17,.765,0,.2,.26,.028,m.art);lamp(sd,-.30,.77,0,.51);
 upholsteredChair(8.8,2.6,Math.PI/2,.70);wardrobe(9.25,9.6,.86,-Math.PI/2);recessed(5.1,7.7,'service-bedroom',true);

 // Entry console sits against the closet side, outside the door's clear approach.
 const foyer=node(26.28,56.2,-Math.PI/2,'Foyer console');soft(foyer,1.02,.055,.34,.03,0,.79,0,m.stone);for(const x of [-.40,.40])box(foyer,.04,.75,.29,x,.397,0,m.bronze);vase(foyer,.30,.82,0,.64);tray(foyer,-.26,.82,0,.50);
 const mir=node(26.83,56.2,-Math.PI/2,'Foyer bronze mirror');const ring=mesh(mir,new THREE.RingGeometry(.37,.395,40),m.bronze,0,1.57,0);ring.scale.y=1.35;const mirror=mesh(mir,new THREE.CircleGeometry(.37,40),m.mirror,0,1.57,.002);mirror.scale.y=1.35;
 recessed(22.5,55.5,'foyer',true);

 // Main-floor bathroom fixtures are staged within their existing partition envelopes.
 function bathVanity(x,z,width=.70,ry=-Math.PI/2){
  const g=node(x,z,ry,'Floating bath vanity');soft(g,width,.46,.43,.025,0,.57,0,m.oak);box(g,width+.035,.045,.45,0,.822,0,m.dark);
  for(const a of [-1,1])box(g,width/2-.015,.38,.022,a*width/4,.58,.235,m.walnut);
  lathe(g,[[.005,0],[.17,0],[.205,.085],[.19,.11],[.165,.09],[.135,.035],[.005,.027]],0,.85,0,m.ceramic);
  tube(g,[[0,.845,-.18],[0,1.10,-.18],[0,1.14,-.04],[0,1.055,.02]],.010,m.bronze,18);
  box(g,width*.9,.81,.023,0,1.43,-.225,m.mirror);box(g,width*.86,.010,.012,0,1.846,-.206,m.emissive);return g;
 }
 function toilet(x,z,ry=0){const g=node(x,z,ry,'Ceramic sanitaryware');soft(g,.28,.35,.38,.085,0,.195,.02,m.ceramic);soft(g,.38,.22,.58,.09,0,.40,.045,m.ceramic);const seat=mesh(g,new THREE.TorusGeometry(.14,.026,8,24),m.ceramic,0,.523,.065,Math.PI/2);seat.scale.y=1.35;sphere(g,.10,0,.503,.065,m.dark,1,.08,1.35);soft(g,.34,.43,.14,.035,0,.52,-.23,m.ceramic);cyl(g,.018,.018,.006,.08,.74,-.23,m.bronze,12);return g;}
 bathVanity(1.80,12.5,.74,Math.PI/2);toilet(4.9,13.0,Math.PI);
 bathVanity(14.65,16.9,.77,Math.PI/2);toilet(17.3,18.1,Math.PI);
 bathVanity(7.05,29.45,.72,Math.PI/2);toilet(9.6,30.75,Math.PI);
 for(const [x,z] of [[3.4,13],[16,17],[8.7,29]])recessed(x,z,'bath');

 rooms.push(
  {id:'great-room',name:'Living & dining',camera:{position:[21.8,72.1,F+1.57],target:[28.1,80.1,F+1.15]},note:'Eight-seat dining and waterfront lounge; circulation remains along the terrace side.'},
  {id:'dining',name:'Dining',camera:{position:[23.0,70.7,F+1.57],target:[28.1,65.5,F+1.20]}},
  {id:'kitchen',name:'Kitchen',camera:{position:[9.4,53.8,F+1.58],target:[2.0,45.7,F+1.18]},note:'Light cabinetry and cream stone interpret Andres’s lighter kitchen direction; exact products and detailing remain unverified.'},
  {id:'family-room',name:'Family lounge',camera:{position:[8.0,70.2,F+1.55],target:[3.9,65.25,F+1.12]}},
  {id:'guest-suite',name:'Guest suite',camera:{position:[22.3,3.2,F+1.56],target:[18.15,9.4,F+1.12]}},
  {id:'service-bedroom',name:'Service bedroom',camera:{position:[8.8,12.1,F+1.52],target:[3.9,6.2,F+1.07]}}
 );
 stats.uniqueMaterials=used.size;stats.lights=lights.length;
 group.userData.staging={basis:'A102 room envelopes and openings; proposed furniture and decorative lighting',palette:'Warm / coastal / dramatic furnishing palettes; light kitchen architectural finishes remain fixed',cameraConvention:'position/target arrays are [source X feet,source Z feet,absolute Y metres]'};
 return {lights,stats,rooms};
}
