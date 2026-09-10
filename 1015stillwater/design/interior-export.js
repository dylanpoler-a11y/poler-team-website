import * as THREE from 'three';

// GLTFExporter packs roughness with a canvas; convert local DataTextures for that step.
// Use only on the separate export scene, then restore/dispose the temporary images.
export function prepareInteriorExport(root){
 const converted=new Map(),changes=[];
 root.traverse(object=>{
  if(!object.isMesh)return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   for(const key of ['map','roughnessMap','metalnessMap','normalMap','emissiveMap']){
    const source=material[key];if(!source?.isDataTexture)continue;
    if(!converted.has(source)){
     const {width,height,data}=source.image,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
     canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
     const texture=new THREE.CanvasTexture(canvas);texture.name=source.name;
     for(const property of ['colorSpace','wrapS','wrapT','magFilter','minFilter','anisotropy','flipY','rotation','channel'])texture[property]=source[property];
     texture.repeat.copy(source.repeat);texture.offset.copy(source.offset);texture.center.copy(source.center);texture.updateMatrix();
     converted.set(source,texture);
    }
    material[key]=converted.get(source);changes.push([material,key,source]);
   }
  }
 });
 return()=>{for(const [material,key,source]of changes)material[key]=source;for(const texture of converted.values())texture.dispose();};
}
