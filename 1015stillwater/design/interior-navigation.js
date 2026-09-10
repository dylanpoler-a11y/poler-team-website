import * as THREE from 'three';

export class InteriorNavigation{
 constructor(camera,canvas,getObjects,toWorld){
  this.camera=camera;this.canvas=canvas;this.getObjects=getObjects;this.toWorld=toWorld;this.enabled=false;this.pointers=new Map();this.ray=new THREE.Raycaster();this.yaw=0;this.pitch=0;
  canvas.addEventListener('pointerdown',e=>{if(!this.enabled)return;this.pointers.set(e.pointerId,[e.clientX,e.clientY]);canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});this.pinch=null;});
  canvas.addEventListener('pointermove',e=>{if(!this.enabled||!this.pointers.has(e.pointerId))return;const old=this.pointers.get(e.pointerId);this.pointers.set(e.pointerId,[e.clientX,e.clientY]);if(this.pointers.size===2){const[a,b]=[...this.pointers.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(this.pinch)this.zoom(this.pinch/distance);this.pinch=distance;}else{this.yaw-=(e.clientX-old[0])*.004;this.pitch=THREE.MathUtils.clamp(this.pitch+(e.clientY-old[1])*.0035,-1.05,1.1);this.look();}});
  const release=e=>{this.pointers.delete(e.pointerId);this.pinch=null;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  canvas.addEventListener('wheel',e=>{if(!this.enabled)return;e.preventDefault();this.zoom(Math.exp(e.deltaY*.001));},{passive:false});
  canvas.addEventListener('keydown',e=>{if(!this.enabled)return;const key=e.key.toLowerCase(),axes={arrowup:[0,1],w:[0,1],arrowdown:[0,-1],s:[0,-1],arrowleft:[-1,0],a:[-1,0],arrowright:[1,0],d:[1,0]};if(axes[key]){e.preventDefault();e.stopPropagation();this.move(...axes[key]);}},{capture:true});
 }
 enter(room,position,target){this.enabled=true;this.room=room;this.camera.position.copy(position);const d=target.clone().sub(position);this.yaw=Math.atan2(d.x,d.z);this.pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));this.camera.fov=this.camera.aspect<.95?Math.min(85,room.fov+8):room.fov;this.camera.near=.025;this.camera.updateProjectionMatrix();this.look();}
 exit(){this.enabled=false;this.pointers.clear();this.camera.fov=38;this.camera.near=.1;this.camera.updateProjectionMatrix();}
 look(){const direction=new THREE.Vector3(Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch));this.camera.lookAt(this.camera.position.clone().add(direction));}
 zoom(factor){this.camera.fov=THREE.MathUtils.clamp(this.camera.fov*factor,38,90);this.camera.updateProjectionMatrix();}
 move(side,forward){
  const direction=new THREE.Vector3(Math.sin(this.yaw)*forward-Math.cos(this.yaw)*side,0,Math.cos(this.yaw)*forward+Math.sin(this.yaw)*side).normalize();
  const step=.16,candidate=this.camera.position.clone().addScaledVector(direction,step),b=this.room.bounds,low=this.toWorld([b[0],b[2]]),high=this.toWorld([b[1],b[3]]);
  if(candidate.x<Math.min(low[0],high[0])||candidate.x>Math.max(low[0],high[0])||candidate.z<Math.min(low[2],high[2])||candidate.z>Math.max(low[2],high[2]))return;
  // Check both eye and waist height so movement stops at walls, tables and seat backs.
  for(const drop of [0,.78]){this.ray.set(this.camera.position.clone().add(new THREE.Vector3(0,-drop,0)),direction);this.ray.far=step+.2;const hit=this.ray.intersectObjects(this.getObjects(),true).find(h=>h.object.isMesh&&!h.object.material.transparent&&h.object.visible);if(hit)return;}
  this.camera.position.copy(candidate);this.look();
 }
}
