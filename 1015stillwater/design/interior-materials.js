import * as THREE from 'three';

// Local, deterministic PBR maps: no canvas, DOM, remote assets or global RNG.
const SIZE=128, TAU=Math.PI*2, states=new WeakMap();
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=n=>n*n*(3-2*n), mix=(a,b,t)=>a+(b-a)*t;
const mod=(n,m)=>((n%m)+m)%m;

export const interiorStyles=Object.freeze([
  Object.freeze({id:'warm',label:'Warm contemporary',description:'Honey oak, warm stone, natural textiles and aged bronze.',swatches:['#bca27c','#75604a','#ded6c7','#eee8da','#95734f']}),
  Object.freeze({id:'coastal',label:'Bright coastal',description:'Pale oak, ivory stone and soft sea-blue textiles.',swatches:['#d6c5a5','#f0eee4','#b4cbd0','#e9e5d8','#b29b76']}),
  Object.freeze({id:'dramatic',label:'Dramatic luxury',description:'Deep timber, veined dark stone, ivory upholstery and warm metal.',swatches:['#79634c','#48392e','#555b56','#e0d6c3','#a48150']}),
]);

export const interiorMaterialDescriptors=Object.freeze({
  status:'Reference-informed finishes with three proposed furnishing palettes.',
  units:'metres',
  referencePhotos:['ref-12.jpg','ref-14.jpg','ref-30.jpg','ref-31.jpg','ref-32.jpg','ref-37.jpg'],
  confirmedAppearance:[
    'Light, vertically grained and finely reeded timber-look vanity fronts.',
    'Charcoal integrated vanity basins/counters with black edge trim.',
    'Pale stone-look bathroom slabs with horizontal strata, small pores and narrow joints.',
    'White ceilings, recessed shower niches and clear glass openings.',
  ],
  notConfirmed:'Timber species, natural versus manufactured stone, product names, exact colours and gloss values are not specified by the photos.',
  staging:'Sofas, beds, upholstery, rugs, art, bronze decorative pieces and plants are proposed staging. Coastal and dramatic finishes are alternatives, not claims about the installed house.',
  materialBasis:{oak:'reference appearance; species unverified',walnut:'staging',stone:'reference-inspired banded stone appearance',marble:'staging',plaster:'reference white finish; exact specification unverified',linen:'staging',boucle:'staging',rug:'staging',accentFabric:'proposed accent cloth; caramel, sea blue or rust according to palette',bronze:'staging',dark:'reference charcoal basin/trim appearance',ceramic:'neutral fixture interpretation',glass:'clear glazing interpretation',emissive:'proposed decorative lighting',leaf:'staging',art:'original procedural abstract staging',mirror:'reflective approximation, not a planar scene mirror',floorFinish:'reference-inspired mineral finish; dramatic variant is staging'},
  textureNotes:'128px deterministic, repeating DataTextures. Albedo is sRGB; bump/roughness are linear. Grain runs along V. Set mesh UVs for physical scale/orientation; do not change a shared map repeat for one object.',
  glassNotes:'Mobile-friendly transparent PBR glass without a screen-space refraction pass. Mirror reflections depend on the scene environment.',
});

function hash(x,y,seed) {
  let h=Math.imul(x^seed,374761393)^Math.imul(y+seed,668265263);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/4294967295;
}
function noise(u,v,nx,ny,seed) {
  const px=u*nx,py=v*ny,ix=Math.floor(px),iy=Math.floor(py);
  const a=smooth(px-ix),b=smooth(py-iy);
  const sample=(x,y)=>hash(mod(x,nx),mod(y,ny),seed);
  return mix(mix(sample(ix,iy),sample(ix+1,iy),a),mix(sample(ix,iy+1),sample(ix+1,iy+1),a),b);
}
function field(kind,u,v,seed) {
  const n=noise(u,v,7,7,seed), fine=noise(u,v,61,59,seed+9);
  if(kind==='wood') {
    const warp=.21*Math.sin(TAU*v)+.13*Math.sin(TAU*3*v)+.26*noise(u,v,3,4,seed+1);
    const growth=Math.pow(.5+.5*Math.sin(TAU*(u*38+warp)),7);
    const fibres=Math.pow(.5+.5*Math.cos(TAU*(u*61+warp*.8)),10);
    const broad=noise(u,v,12,2,seed+2);
    return [.934+.061*broad-.043*growth-.014*fibres,.5+.10*growth+.045*fibres,.90+.07*broad-.045*growth];
  }
  if(kind==='stone'||kind==='floor') {
    // Broad, irregular strata remain visible close up; pores do not form dots.
    const bend=.017*Math.sin(TAU*u)+.012*noise(u,v,4,3,seed+4);
    const strata=(noise(u,v+bend,3,19,seed+6)-.5)*.019+(noise(u,v+bend,5,37,seed+7)-.5)*.009;
    const mineral=noise(u,v,31,29,seed+3)-.5,subtle=kind==='floor'?.60:1;
    return [.962+subtle*(strata+(n-.5)*.014+mineral*.008),.5+subtle*((fine-.5)*.032+mineral*.018),.93+(n-.5)*.045+(fine-.5)*.025];
  }
  if(kind==='marble'||kind==='marbleDark') {
    const warp=.25*Math.sin(TAU*v)+.13*Math.sin(TAU*(2*v+u))+.27*noise(u,v,5,5,seed+5);
    const a=Math.abs(Math.sin(TAU*(u+v*2+warp))),hair=Math.abs(Math.sin(TAU*(u*3-v+warp*1.6)));
    const vein=Math.exp(-a*37)*(.35+.65*n),branch=Math.exp(-hair*60)*.12;
    const value=kind==='marbleDark'?.61+(n-.5)*.13+vein*.28+branch:.965+(n-.5)*.043-vein*.24-branch;
    return [value,.51+vein*.012,.79+(fine-.5)*.07+vein*.055];
  }
  if(kind==='plaster') return [.965+(n-.5)*.029+(fine-.5)*.009,.5+(fine-.5)*.08,.95+(fine-.5)*.04];
  if(kind==='linen'||kind==='rug') {
    // Unaligned fibres carry the weave in relief, not a visible checker print.
    const warp=noise(u,v,59,7,seed+2),weft=noise(u,v,9,61,seed+4);
    const fibres=warp*.46+weft*.34+fine*.20,slub=noise(u,v,37,11,seed+3)-.5;
    return [.955+(fibres-.5)*.022+slub*.006,.5+(fibres-.5)*.16,.968+(fine-.5)*.024];
  }
  if(kind==='boucle') {
    // Irregular yarn clumps avoid the former evenly spaced circular motif.
    const tufts=noise(u,v,47,43,seed+3)*.48+noise(u,v,31,37,seed+4)*.25+fine*.27;
    return [.957+(tufts-.5)*.029+(n-.5)*.006,.5+(tufts-.5)*.22,.977+(fine-.5)*.018];
  }
  if(kind==='bronze') return [.95+(noise(u,v,59,3,seed)-.5)*.045,.5+(fine-.5)*.02,.83+(noise(u,v,59,3,seed)-.5)*.2];
  if(kind==='dark') return [.945+(n-.5)*.055+(fine-.5)*.02,.5+(fine-.5)*.065,.85+(n-.5)*.11];
  if(kind==='leaf') {
    const mid=Math.exp(-Math.pow(u-.5,2)*1500),vein=Math.pow(.5+.5*Math.cos(TAU*(v*12+Math.abs(u-.5)*8)),15);
    return [.79+n*.15+mid*.08+vein*.035,.4+mid*.35+vein*.12,.87+fine*.08];
  }
  // Original tonal art: broad washes, a rectilinear field and one fine brush gesture.
  const arch=Math.hypot((u-.53)*1.14,(v-.49)*.88),wash=smooth(clamp((.44-arch)*9));
  const block=u>.18&&u<.57&&v>.23&&v<.75?.2:0;
  const stroke=Math.exp(-Math.pow(v-(.70-.35*u+.015*Math.sin(TAU*u)),2)*6000)*.32;
  return [.97-wash*.22-block-stroke+(fine-.5)*.035,.5+(fine-.5)*.065,.96];
}
function dataTexture(name,data,isColour,repeat) {
  const t=new THREE.DataTexture(data,SIZE,SIZE,THREE.RGBAFormat,THREE.UnsignedByteType);
  t.name='interior-'+name;
  t.colorSpace=isColour?THREE.SRGBColorSpace:THREE.NoColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;
  t.generateMipmaps=true;t.anisotropy=2;t.repeat.set(...repeat);t.unpackAlignment=1;t.needsUpdate=true;
  return t;
}
function makeMaps(kind,seed,repeat=[1,1]) {
  const colour=new Uint8Array(SIZE*SIZE*4),bump=new Uint8Array(colour.length),rough=new Uint8Array(colour.length);
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++) {
    const [value,relief,roughness]=field(kind,(x+.5)/SIZE,(y+.5)/SIZE,seed),i=(y*SIZE+x)*4;
    const c=Math.round(clamp(value)*255),h=Math.round(clamp(relief)*255),r=Math.round(clamp(roughness)*255);
    colour[i]=colour[i+1]=colour[i+2]=c;bump[i]=bump[i+1]=bump[i+2]=h;rough[i]=rough[i+1]=rough[i+2]=r;
    colour[i+3]=bump[i+3]=rough[i+3]=255;
  }
  return {map:dataTexture(kind+'-colour',colour,true,repeat),bumpMap:dataTexture(kind+'-relief',bump,false,repeat),roughnessMap:dataTexture(kind+'-roughness',rough,false,repeat)};
}
function textureSet() {
  return {
    wood:makeMaps('wood',103),stone:makeMaps('stone',211),floor:makeMaps('floor',307),
    marble:makeMaps('marble',401),marbleDark:makeMaps('marbleDark',401),plaster:makeMaps('plaster',503,[3,3]),
    linen:makeMaps('linen',601,[4,4]),boucle:makeMaps('boucle',701,[5,5]),rug:makeMaps('rug',809,[4,4]),
    bronze:makeMaps('bronze',907,[2,4]),dark:makeMaps('dark',1013),leaf:makeMaps('leaf',1103),art:makeMaps('art',1201),
  };
}
const surface={
  oak:{texture:'wood',roughness:.60,bumpScale:.00035},
  walnut:{texture:'wood',roughness:.49,bumpScale:.00025},
  stone:{texture:'stone',roughness:.73,bumpScale:.00030},
  marble:{texture:'marble',roughness:.34,bumpScale:.00014,clearcoat:.13,clearcoatRoughness:.36},
  plaster:{texture:'plaster',roughness:.97,bumpScale:.00035},
  linen:{texture:'linen',roughness:.98,bumpScale:.00030,sheen:.22,sheenRoughness:.83},
  boucle:{texture:'boucle',roughness:1,bumpScale:.00070,sheen:.16,sheenRoughness:.9},
  rug:{texture:'rug',roughness:1,bumpScale:.0010},
  accentFabric:{texture:'linen',roughness:.96,bumpScale:.00035,sheen:.26,sheenRoughness:.88},
  bronze:{texture:'bronze',roughness:.36,bumpScale:.000025,metalness:.88},
  dark:{texture:'dark',roughness:.49,bumpScale:.00024,metalness:.07},
  ceramic:{roughness:.19,clearcoat:.20,clearcoatRoughness:.23},
  glass:{roughness:.075,metalness:.04,opacity:.16},
  emissive:{roughness:.6,emissiveIntensity:2.3},
  leaf:{texture:'leaf',roughness:.80,bumpScale:.00035},
  art:{texture:'art',roughness:.93,bumpScale:.0003},
  mirror:{roughness:.045,metalness:1},
  floorFinish:{texture:'floor',roughness:.67,bumpScale:.00015},
};
const finishes={
  warm:{
    colours:{oak:'#bca27c',walnut:'#75604a',stone:'#ded6c7',marble:'#f0ebe1',plaster:'#eee8da',linen:'#d6cbb8',boucle:'#eee8d8',rug:'#c7b697',accentFabric:'#a97443',bronze:'#95734f',dark:'#353735',ceramic:'#f5f0e6',glass:'#e0ece7',emissive:'#fff0d5',leaf:'#536747',art:'#d8c7a6',mirror:'#e4e7e3',floorFinish:'#ded6c7'},
    overrides:{},emission:'#ffdb9c',
  },
  coastal:{
    colours:{oak:'#d6c5a5',walnut:'#b4a082',stone:'#f0eee4',marble:'#f7f5eb',plaster:'#f6f4eb',linen:'#b4cbd0',boucle:'#f1eee3',rug:'#ded9c9',accentFabric:'#608991',bronze:'#b29b76',dark:'#383b39',ceramic:'#fcf9f0',glass:'#deeff0',emissive:'#fff5e6',leaf:'#688066',art:'#c1d4d3',mirror:'#e9edeb',floorFinish:'#ece9dd'},
    overrides:{oak:{roughness:.66},walnut:{roughness:.64},stone:{roughness:.78},marble:{roughness:.41},bronze:{roughness:.44},floorFinish:{roughness:.72}},emission:'#ffe6ba',
  },
  dramatic:{
    colours:{oak:'#79634c',walnut:'#48392e',stone:'#8b8578',marble:'#68726b',plaster:'#ddd3c1',linen:'#c1b39d',boucle:'#e0d6c3',rug:'#867a66',accentFabric:'#884633',bronze:'#a48150',dark:'#292d2b',ceramic:'#e7e1d4',glass:'#cbded5',emissive:'#ffe6bd',leaf:'#435640',art:'#c7ad80',mirror:'#d9dfda',floorFinish:'#827f77'},
    overrides:{oak:{roughness:.50},walnut:{roughness:.40},stone:{texture:'marbleDark',roughness:.40,bumpScale:.00016},marble:{texture:'marbleDark',roughness:.24,clearcoat:.24},bronze:{roughness:.29},floorFinish:{texture:'marbleDark',roughness:.39,bumpScale:.00012}},emission:'#ffd18d',
  },
};
function styleId(value) {
  const id=typeof value==='string'?value:value?.style;
  return Object.hasOwn(finishes,id)?id:'warm';
}

/** Mutates appearance only; meshes retain their material identities. */
export function applyInteriorStyle(materials,requestedStyle='warm') {
  if(!materials||typeof materials!=='object') throw new TypeError('applyInteriorStyle requires a material palette.');
  const id=styleId(requestedStyle),finish=finishes[id];
  let state=states.get(materials);
  if(!state){state={textures:textureSet(),style:id};states.set(materials,state);}
  for(const [key,base] of Object.entries(surface)) {
    const m=materials[key];if(!m?.isMaterial) continue;
    const spec={...base,...finish.overrides[key]},maps=spec.texture?state.textures[spec.texture]:null;
    m.color.set(finish.colours[key]);
    for(const name of ['map','bumpMap','roughnessMap']) m[name]=maps?.[name]??null;
    m.roughness=spec.roughness;m.metalness=spec.metalness??0;m.bumpScale=spec.bumpScale??0;
    if(m.isMeshPhysicalMaterial) {
      m.clearcoat=spec.clearcoat??0;m.clearcoatRoughness=spec.clearcoatRoughness??.4;
      m.sheen=spec.sheen??0;m.sheenRoughness=spec.sheenRoughness??.85;m.sheenColor.copy(m.color);
    }
    if(key==='glass') m.opacity=spec.opacity;
    if(key==='emissive'){m.emissive.set(finish.emission);m.emissiveIntensity=spec.emissiveIntensity;}
    m.userData.interiorStyle=id;m.needsUpdate=true;
  }
  state.style=id;
  return materials;
}

/** One palette per shared scene; material keys stay fixed across all styles. */
export function createInteriorMaterials(style='warm') {
  const materials={},physical=new Set(['linen','boucle','accentFabric','marble','ceramic','glass']);
  for(const key of Object.keys(surface)) {
    const m=physical.has(key)?new THREE.MeshPhysicalMaterial():new THREE.MeshStandardMaterial();
    m.name='Stillwater interior · '+key;
    m.envMapIntensity=key==='mirror'?1.2:key==='bronze'?1:.68;
    m.userData={interiorMaterialKey:key,basis:interiorMaterialDescriptors.materialBasis[key],textureTile:'UV controlled; world geometry uses metres'};
    if(['glass','mirror','linen','accentFabric','leaf'].includes(key)) m.side=THREE.DoubleSide;
    if(key==='glass'){m.transparent=true;m.depthWrite=false;m.transmission=0;m.ior=1.46;}
    materials[key]=m;
  }
  states.set(materials,{textures:textureSet(),style:styleId(style)});
  Object.defineProperties(materials,{
    descriptors:{value:interiorMaterialDescriptors,enumerable:false},
    style:{get:()=>states.get(materials)?.style??'warm',enumerable:false},
  });
  return applyInteriorStyle(materials,style);
}

/** Dispose only when the whole palette is unused, never during a style change. */
export function disposeInteriorMaterials(materials) {
  const state=states.get(materials);
  if(state){
    for(const t of new Set(Object.values(state.textures).flatMap(m=>Object.values(m)))) t.dispose();
    states.delete(materials);
  }
  for(const m of Object.values(materials)) if(m?.isMaterial) m.dispose();
}
