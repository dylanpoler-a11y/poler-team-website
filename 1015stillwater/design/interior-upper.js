// A103 room geometry governs placement. Furnishings and joinery are a finished design study.
// Shared materials remain live so the viewer can change the complete finish palette.
export function buildUpperInteriors({THREE,group,materials,toWorld,floorY}) {
  const F=.3048, y0=floorY+.0508, M=materials, accent=M.accentFabric||M.rug, lights=[], rooms=[];
  const content=new THREE.Group();content.name='Upper interiors — master suite and guest rooms';group.add(content);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mesh=(g,geo,mat,name='')=>{const o=new THREE.Mesh(geo,mat);o.name=name;o.castShadow=!mat.transparent;o.receiveShadow=true;g.add(o);return o;};
  const anchor=(name,x,z,y=0,yaw=0)=>{const g=new THREE.Group();g.name=name;g.position.set(...toWorld([x,z],y0+y));g.rotation.y=yaw;content.add(g);return g;};
  function box(g,p,s,mat,r=0) {
    const divisions=r>.04?4:r?2:1;
    const geo=new THREE.BoxGeometry(...s,divisions,divisions,divisions);
    if(r){r=Math.min(r,...s.map(v=>v*.48));const a=geo.attributes.position;
      for(let i=0;i<a.count;i++){const v=new THREE.Vector3().fromBufferAttribute(a,i),c=new THREE.Vector3(clamp(v.x,-s[0]/2+r,s[0]/2-r),clamp(v.y,-s[1]/2+r,s[1]/2-r),clamp(v.z,-s[2]/2+r,s[2]/2-r));v.sub(c).normalize().multiplyScalar(r).add(c);a.setXYZ(i,v.x,v.y,v.z);}geo.computeVertexNormals();}
    const o=mesh(g,geo,mat);o.position.set(...p);return o;
  }
  function cyl(g,p,r,h,mat,rt=r,n=20){const o=mesh(g,new THREE.CylinderGeometry(rt,r,h,n),mat);o.position.set(...p);return o;}
  function ellipsoid(g,p,s,mat,segments=24){const o=mesh(g,new THREE.SphereGeometry(1,segments,12),mat);o.position.set(...p);o.scale.set(...s);return o;}
  function pipe(g,pts,r,mat,segments=24){const c=new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p)));return mesh(g,new THREE.TubeGeometry(c,segments,r,4,false),mat);}
  function rod(g,a,b,r,mat){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),o=cyl(g,av.clone().add(bv).multiplyScalar(.5).toArray(),r,d.length(),mat,r,10);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return o;}
  function lathe(g,p,profile,mat,scale=[1,1,1],segments=32){const o=mesh(g,new THREE.LatheGeometry(profile.map(p=>new THREE.Vector2(...p)),segments),mat);o.position.set(...p);o.scale.set(...scale);return o;}
  function point(g,p,intensity=12,distance=4){const l=new THREE.PointLight(0xffe1b5,intensity,distance,2);l.position.set(...p);l.castShadow=false;l.userData={interior:true,level:'upper',nominalIntensity:intensity};g.add(l);lights.push(l);return l;}
  function downlight(x,z,power=11){const g=anchor('Recessed ceiling light',x,z);cyl(g,[0,2.721,0],.055,.018,M.bronze);cyl(g,[0,2.707,0],.042,.008,M.emissive);point(g,[0,2.64,0],power,4.4);}
  function lineArt(g,p,w,h,variant=0){
    box(g,p,[w+.035,h+.035,.037],M.bronze,.01);box(g,[p[0],p[1],p[2]+.022],[w,h,.014],M.art);
    const z=p[2]+.034;
    for(let k=0;k<3;k++){const pts=[];for(let i=0;i<=18;i++){const t=i/18;pts.push([p[0]+(t-.5)*w*.80,p[1]+Math.sin(t*Math.PI*(1.1+variant*.25)+k*.65)*h*.22+(k-1)*h*.11,z]);}pipe(g,pts,.0035,k===1?M.bronze:M.walnut,18);}
  }
  function book(g,x,y,z,w=.17,d=.23,h=.025,i=0){const o=box(g,[x,y+h/2,z],[w,h,d],i%2?M.oak:M.walnut,.003);o.rotation.y=i*.07;box(g,[x,y+h/2,z+d/2+.001],[w*.90,h*.65,.003],M.linen);}
  function vase(g,x,y,z,scale=.9){lathe(g,[x,y,z],[[.001,0],[.08,0],[.105,.045],[.11,.13],[.055,.20],[.042,.26],[.047,.27],[.034,.27],[.031,.22]],M.ceramic,[scale,scale,scale]);}
  function plant(g,x,y,z,scale=1){
    lathe(g,[x,y,z],[[.001,0],[.14,0],[.19,.27],[.20,.30],[.16,.30],[.15,.27]],M.ceramic,[scale,scale,scale]);
    for(let i=0;i<7;i++){const a=i*2.4,bx=Math.cos(a)*.24*scale,bz=Math.sin(a)*.24*scale,hy=(.65+(i%3)*.15)*scale;pipe(g,[[x,y+.25*scale,z],[x+bx*.4,y+hy*.7,z+bz*.4],[x+bx,y+hy,z+bz]],.005*scale,M.bronze,7);const leaf=ellipsoid(g,[x+bx,y+hy,z+bz],[.055*scale,.20*scale,.012*scale],M.leaf,12);leaf.rotation.set(.25*Math.cos(a),a,.35*Math.sin(a));}
  }
  function lamp(g,x,y,z,small=false){
    const s=small?.75:1;cyl(g,[x,y+.02*s,z],.105*s,.04*s,M.bronze);lathe(g,[x,y+.04*s,z],[[.045,0],[.07,.07],[.065,.18],[.024,.25]],M.ceramic,[s,s,s],24);
    cyl(g,[x,y+.41*s,z],.18*s,.26*s,M.linen,.14*s,28);cyl(g,[x,y+.279*s,z],.171*s,.01*s,M.bronze,.171*s,28);cyl(g,[x,y+.54*s,z],.135*s,.008*s,M.emissive);point(g,[x,y+.40*s,z],small?4:6,2.4);
  }
  function pillow(g,p,w=.76,d=.48,h=.18,mat=M.linen,tilt=0){
    const geo=new THREE.SphereGeometry(1,24,12),a=geo.attributes.position;
    const signedPow=(v,e)=>Math.sign(v)*Math.pow(Math.abs(v),e);
    for(let i=0;i<a.count;i++){const sx=a.getX(i),sy=a.getY(i),sz=a.getZ(i);const x=signedPow(sx,.47)*w/2,z=signedPow(sz,.47)*d/2;let y=signedPow(sy,.82)*h/2;y+=.004*Math.sin(sx*15+sz*6)*Math.abs(sy);a.setXYZ(i,x,y,z);}geo.computeVertexNormals();const o=mesh(g,geo,mat,'Sculpted pillow');o.position.set(...p);o.rotation.x=tilt;
    const sg=new THREE.Group();sg.position.copy(o.position);sg.rotation.copy(o.rotation);g.add(sg);const pts=[];for(let i=0;i<=44;i++){const t=i/44*Math.PI*2;pts.push([Math.sign(Math.cos(t))*Math.pow(Math.abs(Math.cos(t)),.47)*w*.499,0,Math.sign(Math.sin(t))*Math.pow(Math.abs(Math.sin(t)),.47)*d*.499]);}pipe(sg,pts,.0035,mat,44);return o;
  }
  function cloth(g,{width,depth,y,z=0,mat=M.linen,drop=.2,throwCloth=false,restWidth=width-.30}){
    const nx=32,nz=25,positions=[],uv=[],indices=[];
    for(let j=0;j<=nz;j++)for(let i=0;i<=nx;i++){
      const u=i/nx,v=j/nz,flatX=(u-.5)*width,flatZ=(v-.5)*depth+z,half=restWidth/2;
      const edge=clamp((Math.abs(flatX)-half)/Math.max(.01,(width-restWidth)/2),0,1),curve=Math.sin(edge*Math.PI/2);
      const x=Math.sign(flatX)*(Math.min(Math.abs(flatX),half)+.028*curve),foot=clamp((flatZ-1.065)/Math.max(.025,z+depth/2-1.065),0,1);
      const zz=Math.min(flatZ,1.065)+.025*Math.sin(foot*Math.PI/2);
      let yy=y-Math.max(drop*curve,drop*.66*Math.sin(foot*Math.PI/2));
      yy+=.010*Math.sin(u*37+v*9)*(.4+.6*edge)+.006*Math.cos(v*35-u*8);if(throwCloth)yy+=.010*Math.sin(u*31+v*3);
      positions.push(x,yy,zz);uv.push(u*2,v*2);
    }
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;indices.push(a,c,b,b,c,d);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();return mesh(g,geo,mat,throwCloth?'Draped throw':'Draped duvet');
  }
  function upholsteredBed(x,z,width=1.95,yaw=-Math.PI/2,master=false){
    const g=anchor(master?'Master upholstered bed':'Guest upholstered bed',x,z,0,yaw),depth=2.14;
    box(g,[0,.105,0],[width-.12,.19,depth-.04],M.walnut,.045);box(g,[0,.255,0],[width+.13,.26,depth+.1],M.boucle,.075);
    box(g,[0,.45,0],[width,.23,depth],M.linen,.09);box(g,[0,.575,0],[width+.015,.08,depth+.02],M.linen,.035);
    box(g,[0,.80,-depth/2-.11],[width+.34,1.43,.15],M.boucle,.075);
    for(const xx of [-width*.26,width*.26]){box(g,[xx,.84,-depth/2-.012],[width*.47,1.24,.035],M.linen,.017);pillow(g,[xx,.88,-.73],width*.47,.59,.25,M.linen,.86);pillow(g,[xx,.79,-.39],width*.42,.45,.22,M.linen,.52);}
    cloth(g,{width:width+.33,depth:1.62,y:.643,z:.29,drop:.26});
    cloth(g,{width:width+.23,restWidth:width+.04,depth:.28,y:.683,z:-.15,drop:.10,throwCloth:true});
    cloth(g,{width:width+.37,depth:.59,y:.670,z:.74,drop:.24,mat:accent,throwCloth:true});
    pillow(g,[0,.78,-.07],.72,.29,.15,accent,.30);
    for(const sign of [-1,1]){
      const xx=sign*(width/2+.44);box(g,[xx,.10,-.68],[.48,.11,.44],M.walnut,.025);box(g,[xx,.355,-.68],[.57,.38,.50],M.oak,.025);box(g,[xx,.553,-.68],[.60,.038,.52],M.stone,.014);
      box(g,[xx,.365,-.418],[.48,.014,.012],M.dark);rod(g,[xx-.095,.408,-.401],[xx+.095,.408,-.401],.006,M.bronze);lamp(g,xx,.576,-.74,!master);if(sign===1){book(g,xx+.05,.577,-.52,.13,.17,.018,2);}
    }
    box(g,[0,.022,.37],[width+1.1,.018,2.85],M.rug,.008);
    if(master){box(g,[0,.40,1.48],[1.44,.18,.44],M.boucle,.09);for(const sign of [-1,1])box(g,[sign*.56,.19,1.48],[.11,.34,.33],M.walnut,.026);}
    return g;
  }
  function curtain(x,z,width,height=2.66,yaw=0){
    const g=anchor('Open pleated linen drapery',x,z,0,yaw),cols=32,rows=12,positions=[],uv=[],index=[];
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const u=i/cols,v=j/rows,xx=(u-.5)*width;positions.push(xx,.035+height*(1-v),.047*Math.cos(u*12*Math.PI)*(1+.3*v)+.009*Math.sin(v*3*Math.PI+u*9));uv.push(u*2,v*3);}
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;index.push(a,c,b,b,c,d);}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(index);geo.computeVertexNormals();mesh(g,geo,M.linen);
    rod(g,[-width/2-.04,height+.04,0],[width/2+.04,height+.04,0],.012,M.bronze);
    for(let i=0;i<10;i++){const xx=(i/9-.5)*width;rod(g,[xx,height+.025,0],[xx,height-.065,.04],.007,M.bronze);}
    const hem=[];for(let i=0;i<=42;i++)hem.push([(i/42-.5)*width,.066,.061*Math.cos(i/42*12*Math.PI)]);pipe(g,hem,.003,M.linen,42);
  }
  function chair(g,x,z,yaw=0){const c=new THREE.Group();c.position.set(x,0,z);c.rotation.y=yaw;g.add(c);cyl(c,[0,.15,0],.22,.24,M.walnut);box(c,[0,.43,0],[.75,.27,.73],M.boucle,.13);box(c,[0,.72,-.29],[.78,.62,.21],M.boucle,.10);for(const s of [-1,1])box(c,[s*.31,.58,0],[.19,.39,.68],M.boucle,.08);pillow(c,[0,.58,-.09],.41,.39,.13,M.linen,-.7);return c;}
  function wallPanel(x,z,w,h=2.60,yaw=0){const g=anchor('Timber and textile feature wall',x,z,0,yaw);box(g,[0,h/2,0],[w,h,.035],M.oak);for(let i=0;i<=Math.floor(w/.11);i++){const xx=-w/2+i*.11;box(g,[xx,h/2,.035],[.026,h,.023],M.walnut,.008);}return g;}
  function mirror(g,x,y,z,w,h){box(g,[x,y,z],[w+.025,h+.025,.035],M.bronze,.035);box(g,[x,y,z+.022],[w,h,.013],M.mirror,.03);for(const sign of [-1,1])box(g,[x+sign*(w/2+.035),y,z-.006],[.01,h*.94,.008],M.emissive);}
  function basin(g,x,y,z){lathe(g,[x,y,z],[[.001,0],[.19,0],[.245,.065],[.26,.145],[.247,.16],[.222,.145],[.17,.035],[.02,.025]],M.dark,[1,1,.82],36);cyl(g,[x,y+.027,z],.017,.006,M.bronze);}
  function faucet(g,x,y,z){rod(g,[x,y,z],[x,y+.29,z],.014,M.bronze);pipe(g,[[x,y+.29,z],[x,y+.325,z+.015],[x,y+.33,z+.14],[x,y+.30,z+.175]],.014,M.bronze,14);cyl(g,[x+.095,y+.025,z],.03,.05,M.bronze);rod(g,[x+.095,y+.05,z],[x+.095,y+.05,z+.08],.008,M.bronze);}
  function soap(g,x,y,z){box(g,[x,y+.055,z],[.065,.11,.047],M.ceramic,.012);rod(g,[x,y+.11,z],[x,y+.143,z],.006,M.bronze);rod(g,[x,y+.143,z],[x,y+.143,z+.035],.006,M.bronze);}
  function towel(g,x,y,z,w=.40,d=.27){for(let i=0;i<3;i++)box(g,[x,y+i*.039+.021,z],[w-i*.008,.040,d-i*.006],M.linen,.019);for(let i=0;i<3;i++)box(g,[x,y+i*.039+.024,z+d/2-.014],[w*.86,.006,.006],M.rug,.002);}
  function vanity(x,z,width,yaw=0,master=false){
    const g=anchor('Floating fluted oak vanity',x,z,0,yaw),h=.42,bottom=.31;
    box(g,[0,bottom+h/2,0],[width,h,.51],M.oak,.012);box(g,[0,bottom-.023,.075],[width-.08,.026,.33],M.emissive);
    for(let i=0;i<Math.floor(width/.033);i++){const xx=-width/2+.024+i*.033;const fl=cyl(g,[xx,bottom+h/2,.264],.012,h-.026,M.oak,.012,8);fl.castShadow=false;}
    for(let i=1;i<Math.max(2,Math.round(width/.64));i++)box(g,[-width/2+i*width/Math.max(2,Math.round(width/.64)),bottom+h/2,.278],[.003,h-.014,.006],M.dark);
    box(g,[0,.77,0],[width+.034,.092,.57],M.dark,.01);box(g,[0,1.00,-.298],[width+.04,.37,.019],M.stone);
    basin(g,master?-.1:0,.818,.02);faucet(g,master?-.1:0,.82,-.185);mirror(g,0,1.69,-.30,width*.89,.99);
    soap(g,width/2-.11,.82,-.10);if(width>1.45){towel(g,width/2-.27,.82,.06,.33,.25);vase(g,-width/2+.16,.82,-.06,.58);}point(g,[0,1.65,.25],7,2.8);return g;
  }
  function toilet(x,z,yaw=0){const g=anchor('Wall hung WC',x,z,0,yaw);ellipsoid(g,[0,.38,0],[.18,.13,.27],M.ceramic);box(g,[0,.38,-.20],[.28,.18,.20],M.ceramic,.07);ellipsoid(g,[0,.50,.022],[.183,.025,.25],M.ceramic);box(g,[0,.98,-.28],[.19,.115,.015],M.bronze,.009);for(const xx of [-.04,.045])box(g,[xx,.983,-.268],[.06,.064,.008],M.dark,.008);return g;}
  function shower(x,z,w,d,yaw=0){
    const g=anchor('Stone shower and bronze fittings',x,z,0,yaw);box(g,[0,.025,0],[w,.035,d],M.stone,.012);
    // Finish lining stays inside the existing wall; no new structural partition.
    box(g,[0,1.27,-d/2+.025],[w,2.52,.034],M.stone);for(const y of [.63,1.26,1.89])box(g,[0,y,-d/2+.046],[w,.002,.003],M.bronze);
    box(g,[0,1.18,-d/2+.048],[.61,.36,.015],M.dark);box(g,[0,1.18,-d/2+.059],[.55,.29,.019],M.stone);box(g,[0,1.035,-d/2+.10],[.61,.025,.16],M.stone);soap(g,-.13,1.05,-d/2+.10);vase(g,.15,1.05,-d/2+.10,.4);
    rod(g,[w*.24,1.07,-d/2+.09],[w*.24,2.17,-d/2+.09],.012,M.bronze);pipe(g,[[w*.24,2.17,-d/2+.09],[w*.24,2.24,-d/2+.11],[w*.24,2.26,-d/2+.44]],.014,M.bronze,12);cyl(g,[w*.24,2.23,-d/2+.45],.12,.035,M.bronze);box(g,[w*.24,1.10,-d/2+.07],[.13,.19,.012],M.bronze,.015);rod(g,[w*.24,1.10,-d/2+.08],[w*.24+.065,1.10,-d/2+.12],.010,M.bronze);
    box(g,[0,.047,-d/2+.09],[w*.78,.007,.035],M.dark);box(g,[-w/2+.18,.43,0],[.35,.075,d-.08],M.stone,.018);
    return g;
  }
  function tub(x,z,yaw=-Math.PI/4){
    const g=anchor('Freestanding sculpted bath',x,z,0,yaw);
    lathe(g,[0,.055,0],[[0,0],[.28,0],[.37,.05],[.45,.21],[.48,.43],[.47,.51],[.447,.528],[.423,.51],[.41,.42],[.34,.14],[.25,.09],[0,.09]],M.ceramic,[1.04,1,1.92],52);
    cyl(g,[0,.152,.40],.023,.006,M.bronze);rod(g,[.59,0,.13],[.59,.78,.13],.022,M.bronze);pipe(g,[[.59,.78,.13],[.59,.83,.13],[.49,.85,.13],[.30,.85,.13],[.28,.81,.13]],.022,M.bronze,16);cyl(g,[.59,.022,.13],.07,.025,M.bronze);box(g,[0,.59,-.36],[1.04,.031,.23],M.oak,.012);towel(g,-.22,.61,-.36,.26,.19);vase(g,.30,.61,-.36,.5);return g;
  }
  function hangingGarment(g,x,y,z,i){
    const w=.24+(i%3)*.016,len=.72+(i%4)*.065;
    const pts=[[-.038,0],[.038,0],[w*.62,-.075],[w*.85,-.29],[w*.51,-.34],[w*.43,-.17],[w*.45,-len],[-w*.45,-len],[-w*.43,-.17],[-w*.51,-.34],[-w*.85,-.29],[-w*.62,-.075]];
    const shape=new THREE.Shape(pts.map(p=>new THREE.Vector2(...p)));const clothGeo=new THREE.ExtrudeGeometry(shape,{depth:.035,bevelEnabled:true,bevelSegments:1,steps:1,bevelSize:.012,bevelThickness:.013,curveSegments:2});
    const garmentMat=i%6===0?M.dark:i%4===0?accent:i%4===1?M.boucle:M.linen;
    const o=mesh(g,clothGeo,garmentMat,'Hanging garment');o.position.set(x,y,z);o.rotation.y=Math.PI/2;
    rod(g,[x-.02,y+.08,z],[x,y+.14,z],.005,M.bronze);for(const sign of [-1,1])rod(g,[x,y+.07,z],[x,y-.03,z+sign*.13],.005,M.bronze);
    // Pressed front fold breaks up a flat silhouette.
    rod(g,[x+.047,y-.16,z+.02],[x+.047,y-len+.035,z+.02],.0025,garmentMat);
  }
  function wardrobe(x,z,width,yaw=0,open=true){
    const g=anchor(open?'Open fitted wardrobe':'Fitted wardrobe',x,z,0,yaw),d=.57,h=2.47,n=Math.max(1,Math.round(width/.73)),bay=width/n;
    box(g,[0,.075,0],[width,.12,d-.05],M.walnut);box(g,[0,h/2,-d/2+.018],[width,h,.028],M.oak);box(g,[0,h-.025,0],[width,.045,d],M.oak);
    for(let i=0;i<=n;i++)box(g,[-width/2+i*bay,h/2,0],[.035,h,d],M.oak);
    for(let i=0;i<n;i++){
      const xx=-width/2+(i+.5)*bay;box(g,[xx,2.12,0],[bay-.04,.035,d],M.oak);box(g,[xx,2.095,-.07],[bay-.08,.009,.013],M.emissive);towel(g,xx,2.15,0,bay*.70,.35);
      if(open&&i%3!==2){rod(g,[xx-bay/2+.035,1.94,0],[xx+bay/2-.035,1.94,0],.012,M.bronze);for(let j=0;j<7;j++)hangingGarment(g,xx-bay*.36+j*bay*.12,1.79,-.045,j+i*3);for(const y of [.23,.43]){box(g,[xx,y,0],[bay-.065,.17,d-.04],M.oak,.01);rod(g,[xx-.11,y,.295],[xx+.11,y,.295],.006,M.bronze);}}
      else if(open){for(const y of [.42,.78,1.15,1.53]){box(g,[xx,y,0],[bay-.04,.028,d],M.oak);towel(g,xx,y+.03,-.03,bay*.72,.36);}}
      else{box(g,[xx,1.23,d/2+.004],[bay-.02,2.34,.034],M.oak,.01);rod(g,[xx+bay*.29,1.03,d/2+.037],[xx+bay*.29,1.34,d/2+.037],.007,M.bronze);}
    }return g;
  }

  // Master: bed against the only solid perimeter wall, clear passage at the I3 glazing.
  upholsteredBed(32.0,68.0,2.02,-Math.PI/2,true);
  const masterFeature=wallPanel(36.09,68,3.42,2.60,-Math.PI/2-.0667);
  lineArt(masterFeature,[0,2.00,.074],1.25,.64,1);
  curtain(19.67,62.15,.53,2.65,Math.PI/2);curtain(19.67,73.75,.53,2.65,Math.PI/2);
  curtain(20.95,75.48,.63);curtain(34.4,75.48,.65);
  const sitting=anchor('Master reading corner',22.65,72.75);chair(sitting,0,0,.40);cyl(sitting,[.68,.37,-.13],.26,.07,M.stone);cyl(sitting,[.68,.19,-.13],.05,.35,M.bronze);book(sitting,.68,.41,-.13,.16,.20,.024,0);plant(sitting,-.28,0,.63,.65);
  for(const p of [[23,63],[23,70],[31,63],[31,73]])downlight(...p,10);

  // Master bath follows A103: separate opposing vanities; shower and tub by K1.
  vanity(-.29,62.22,1.96,Math.PI/2,true);vanity(8.70,61.15,2.14,-Math.PI/2,true);
  const bathFinishA=anchor('Master bath slab wall finish',-1.30,62.32,0,Math.PI/2);box(bathFinishA,[0,1.31,0],[2.08,2.62,.027],M.stone);for(const y of [.65,1.31,1.97])box(bathFinishA,[0,y,.016],[2.08,.002,.004],M.bronze);
  const bathFinishB=anchor('Master bath slab wall finish',9.76,61.15,0,-Math.PI/2);box(bathFinishB,[0,1.31,0],[2.36,2.62,.027],M.stone);for(const y of [.65,1.31,1.97])box(bathFinishB,[0,y,.016],[2.36,.002,.004],M.bronze);
  tub(2.50,68.10,-Math.PI/4);
  const ms=shower(8.15,68.50,1.00,1.86,0);
  box(ms,[-.52,1.17,0],[.012,2.31,1.86],M.glass);rod(ms,[-.536,.84,-.40],[-.536,1.11,-.40],.011,M.bronze);
  const bathTextiles=anchor('Master bath towels and stool',4.17,64.38);box(bathTextiles,[0,.015,0],[.65,.019,1.25],M.rug,.008);cyl(bathTextiles,[.13,.32,.53],.19,.055,M.oak);for(const a of [0,2.094,4.189])rod(bathTextiles,[.13+Math.cos(a)*.13,.29,.53+Math.sin(a)*.13],[.13+Math.cos(a)*.17,0,.53+Math.sin(a)*.17],.021,M.oak);towel(bathTextiles,.13,.355,.53,.28,.24);
  toilet(.4,54.5,0);for(const p of [[3.5,60.3],[3.5,65.5],[7.6,68.3]])downlight(...p,12);

  // Master dressing room: fitted perimeter bays leave the central through-route open.
  wardrobe(-.93,44.92,3.51,Math.PI/2,true);wardrobe(3.16,38.82,2.59,0,true);wardrobe(7.14,46.13,2.20,-Math.PI/2,true);
  const fullMirror=anchor('Dressing room full height mirror',5.86,51.16);mirror(fullMirror,0,1.2,0,.61,2.10);for(const p of [[3.1,41.1],[3.1,47.5]])downlight(...p,12);

  // Three front bedrooms use side walls, preserving the Q/Q1/Q2 floor-to-ceiling windows.
  for(const [index,x,z,w,headX]of [[2,9.20,11.15,1.60,13.16],[3,22.05,10.72,1.52,26.37],[4,34.76,11.62,1.60,38.99]]){
    upholsteredBed(x,z,w,-Math.PI/2,false);
    const wall=wallPanel(headX,z,2.8,2.59,-Math.PI/2);lineArt(wall,[0,1.97,.067],.97,.56,index);
    const minX=index===2?.95:index===3?14.45:27.8,maxX=index===2?12.0:index===3?25.8:39.0;
    curtain(minX+.65,4.97,.46);curtain(maxX-.65,4.97,.46);
    const desk=anchor('Bedroom '+index+' writing desk',index===2?1.63:index===3?14.60:28.22,14.05,0,Math.PI/2);
    box(desk,[0,.745,0],[.92,.048,.45],M.oak,.016);for(const s of [-1,1])box(desk,[s*.40,.36,0],[.031,.72,.39],M.bronze);book(desk,-.23,.772,0);lamp(desk,.26,.772,-.05,true);chair(desk,0,.66,Math.PI);
    const art=anchor('Bedroom '+index+' artwork',index===2?.50:index===3?14.02:27.21,11.7,0,Math.PI/2);lineArt(art,[0,1.48,0],.73,.93,index);
    for(const zz of [8.2,14.9])downlight(index===2?5:index===3?18.25:31.0,zz,9);
  }

  // Secondary bathrooms and fitted closets use the actual A103 fixture zones.
  vanity(3.1,18.65,1.22,0);toilet(1.31,22.13,Math.PI/2);shower(3.45,24.70,.90,1.48,-Math.PI/2);
  vanity(18.0,20.47,.90,-Math.PI/2);toilet(15.35,18.17,0);shower(11.97,19.58,1.52,.90,Math.PI/2);
  vanity(34.75,18.67,.91,0);toilet(38.0,21.75,-Math.PI/2);shower(36.0,25.07,.84,1.46,-Math.PI/2);
  for(const p of [[3.0,22],[16.7,20.0],[35.9,21.7]])downlight(...p,11);
  wardrobe(7.20,29.2,1.62,Math.PI/2,true);wardrobe(24.72,21.30,1.56,Math.PI,true);wardrobe(30.14,21.33,1.66,0,false);
  for(const p of [[8.7,29.5],[24.5,18.8],[30.1,24.9]])downlight(...p,7);

  // Positions are in source feet; eye/target heights are absolute world metres.
  const room=(id,name,position_ft,target_ft,height=1.56,targetHeight=1.10)=>rooms.push({id,name,level:'upper',position_ft,target_ft,eyeY:y0+height,targetY:y0+targetHeight,position:toWorld(position_ft,y0+height),target:toWorld(target_ft,y0+targetHeight)});
  room('master-suite','Master suite',[22.3,62.3],[32.0,68.0]);
  room('master-waterfront','Master waterfront',[27.0,71.8],[21.4,76.7]);
  room('master-bath','Master bathroom',[5.6,58.9],[2.5,68.1],1.54,.94);
  room('master-closet','Master dressing room',[4.2,50.45],[2.4,42.0],1.56,1.13);
  room('bedroom-2','Bedroom 2',[3.5,15.4],[9.2,11.15]);
  room('bedroom-3','Bedroom 3',[16.0,15.1],[22.05,10.72]);
  room('bedroom-4','Bedroom 4',[29.3,15.8],[34.76,11.62]);
  let triangles=0,meshes=0;const materialIds=new Set();content.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;for(const m of Array.isArray(o.material)?o.material:[o.material])materialIds.add(m.uuid);}});
  const stats={meshes,triangles,materials:materialIds.size,lights:lights.length,finishedFloorY:y0,basis:'A103 room envelopes and fixture zones; furniture and finish treatments are design proposals.'};
  content.userData={...stats,interior:true,level:'upper'};
  return {lights,stats,rooms};
}
