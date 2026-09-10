import * as THREE from 'three';

// A visual planting interpretation of the client's courtyard-palm direction.
// Species, planting size and mature height are not established by the architecture set.
export function buildCourtyardPalm({group,materials,toWorld,position=[31.5,39],trunkHeight=9.2,spread=1.85}){
 const origin=new THREE.Vector3(...toWorld(position,0)),tree=new THREE.Group();tree.name='Courtyard specimen palm';group.add(tree);
 const trunkCurve=new THREE.CatmullRomCurve3([
  origin.clone(),origin.clone().add(new THREE.Vector3(-.045,trunkHeight*.32,.02)),
  origin.clone().add(new THREE.Vector3(.09,trunkHeight*.70,.03)),origin.clone().add(new THREE.Vector3(.12,trunkHeight,0))
 ]);
 const add=(geometry,material)=>{const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;tree.add(mesh);return mesh;};
 add(new THREE.TubeGeometry(trunkCurve,28,.14,12,false),materials.trunk);
 const foot=add(new THREE.CylinderGeometry(.14,.23,.46,14),materials.trunk);foot.position.copy(origin).add(new THREE.Vector3(0,.20,0));
 // Fine growth rings give the slender trunk visible structure at room-view distance.
 for(let i=1;i<61;i++){const ring=add(new THREE.TorusGeometry(.142,.005,3,12),i%4===0?materials.woodLight:materials.trunk);ring.position.copy(trunkCurve.getPointAt(i/64));ring.rotation.x=Math.PI/2;}
 const crown=trunkCurve.getPoint(1),shaft=add(new THREE.CylinderGeometry(.095,.148,.62,12),materials.leafLight);shaft.position.copy(crown).add(new THREE.Vector3(0,.12,0));
 const vertices=[[],[]];
 for(let k=0;k<17;k++){
  const angle=k*2.399963+0.18,dir=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle)),side=new THREE.Vector3(-dir.z,0,dir.x);
  const upright=k>=12,reach=spread*(upright?.38+.07*(k-12):.88+.10*Math.sin(k*1.7)),lift=upright?1.15:.65,droop=upright?.20:.90;
  const stemPoint=t=>crown.clone().addScaledVector(dir,reach*t).add(new THREE.Vector3(0,.30+lift*Math.sin(t*Math.PI*.82)-droop*t*t,0));
  const curve=new THREE.CatmullRomCurve3(Array.from({length:9},(_,i)=>stemPoint(i/8)));
  add(new THREE.TubeGeometry(curve,12,.008,4,false),materials.leafLight);
  for(let n=1;n<=23;n++){
   const t=n/25,p=stemPoint(t),length=spread*.22*Math.pow(Math.sin(t*Math.PI),.75)*(1+.09*Math.sin(n*2.3+k));
   for(const sign of [-1,1]){
    const root=p.clone().addScaledVector(dir,-.013),mid=p.clone().addScaledVector(side,length*.52*sign).addScaledVector(dir,reach*.06).add(new THREE.Vector3(0,-length*.07,0));
    const tip=p.clone().addScaledVector(side,length*sign).addScaledVector(dir,reach*.14).add(new THREE.Vector3(0,-length*.32,0));
    const width=.022*Math.sin(t*Math.PI)+.006,a=mid.clone().addScaledVector(dir,width),b=mid.clone().addScaledVector(dir,-width);
    vertices[(k+n)%4===0?1:0].push(...root.toArray(),...a.toArray(),...b.toArray(),...a.toArray(),...tip.toArray(),...b.toArray());
   }
  }
 }
 vertices.forEach((v,i)=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(v,3));geometry.computeVertexNormals();add(geometry,i?materials.leafLight:materials.leaf);});
 tree.userData={kind:'courtyard-palm',position_ft:position,trunkHeight_m:trunkHeight,approximateCrownRadius_m:spread,basis:'Client-directed planting concept; precise species and size unconfirmed'};
 return tree.userData;
}
