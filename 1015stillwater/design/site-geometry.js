import { siteData } from './plan-data.js';

// All traced polygons use the A102 origin and feet; elevations use the model's understory datum.
export function buildSite({groups,materials,slab,line,fb,cylinder,FT,IN,rect,dimensions}) {
 const d=siteData,p=d.pool,r=d.roof,s=d.site_features;
 const mainY=dimensions.main;
 const roofY=dimensions.roof;
 const roofFinishY=mainY+24.25*FT;
 const lowerRoofY=mainY+(22+7/12)*FT;
 const holes=r.holes.map(h=>h.polygon_xz_ft);
 const waterY=.38; // Water elevation is indicative; the pool is under a separate permit.
 const copingY=mainY+(-9-7/12)*FT;
 const deckY=mainY+(-9-5/12)*FT;
 const edge=(group,poly,bottom,height,width,material,closed=true)=>{
  for(let i=0;i<poly.length-(closed?0:1);i++)line(group,poly[i],poly[(i+1)%poly.length],bottom,height,width,material);
 };

 // The curved, tapering parcel is cut around the pool rather than intersecting its water.
 slab(groups.site,d.lot.parcel_polygon_xz_ft,-.055,.72,materials.grass,[p.outer_coping_and_front_channel_polygon_xz_ft]);
 const waterfront=d.lot.seawall_arc_polyline_xz_ft;
 const bayOutline=[...waterfront,[65,180],[-35,180]];
 slab(groups.water,bayOutline,-.82,.035,materials.channel);
 edge(groups.site,waterfront,-.97,1.09,FT,materials.concrete,false);
 edge(groups.site,waterfront,.10,.10,1.08*FT,materials.stone,false);
 const street=d.lot.street_arc_polyline_xz_ft;
 slab(groups.site,[...street,[61,-51],[-25,-51]],-.085,.15,materials.concrete);
 edge(groups.site,street,-.03,.11,.20,materials.stone,false);

 // Porous driveway envelope and individual broad paving bands.
 const drive=s.driveway_envelope_xz_ft;
 slab(groups.site,drive,.002,.065,materials.stone);
 for(let z=-32;z<3;z+=3.55)fb(groups.site,10.6,z,18,.14,.005,.009,materials.grass);

 // Pool coping, a front overflow trough, inset spa and the actual L-shaped water perimeter.
 slab(groups.pool,p.outer_coping_and_front_channel_polygon_xz_ft,copingY,.20,materials.stone,
  [p.main_water_polygon_xz_ft,p.spa_water_polygon_xz_ft,p.front_overflow_channel_water_polygon_xz_ft]);
 for(const polygon of [p.main_water_polygon_xz_ft,p.spa_water_polygon_xz_ft,p.front_overflow_channel_water_polygon_xz_ft]) {
  slab(groups.pool,polygon,waterY-.15,.045,materials.poolTile);
  slab(groups.pool,polygon,waterY,.012,materials.water);
  edge(groups.pool,polygon,waterY-.16,copingY-waterY+.16,.07,materials.poolTile);
 }
 const treadEdges=p.step_tread_edges_xz_ft;
 for(let i=0;i<treadEdges.length-1;i++){
  const a=treadEdges[i],b=treadEdges[i+1];
  const poly=[a[0],a[1],b[1],b[0]];
  slab(groups.pool,poly,waterY-.055-(treadEdges.length-2-i)*.035,.032,materials.poolTile);
 }
 slab(groups.site,s.raised_rear_deck_polygon_xz_ft,deckY,.11,materials.woodLight);
 const deck=s.raised_rear_deck_polygon_xz_ft;
 const dx0=Math.min(...deck.map(a=>a[0])),dx1=Math.max(...deck.map(a=>a[0]));
 const dz0=Math.min(...deck.map(a=>a[1])),dz1=Math.max(...deck.map(a=>a[1]));
 for(let x=dx0+.55;x<dx1;x+=.65)line(groups.site,[x,dz0],[x,dz1],deckY+.001,.006,.008,materials.wood);

 // Main roof and lower projecting bands remain separate; the four open areas remain open.
 for(const band of r.lower_gray_bands)slab(groups.roof,band.polygon_xz_ft,lowerRoofY,.22,materials.stucco);
 slab(groups.roof,r.main_roof_above_gray_bands.polygon_xz_ft,roofY,.24,materials.stucco,holes);
 slab(groups.roof,r.main_roof_above_gray_bands.polygon_xz_ft,roofY+.025,.025,materials.stone,holes);
 // Raised edge/coping follows the traced roof perimeter; thin interior roofing retains readable voids.
 edge(groups.roof,r.main_roof_above_gray_bands.polygon_xz_ft,roofY,roofFinishY-roofY,.16,materials.stucco);
 for(const hole of holes)edge(groups.roof,hole,roofY,roofFinishY-roofY,.16,materials.stucco);

 // A108 RCP legend3 specifies wood-composite T&G soffits. Its brown zones match
 // the front U-shaped band, large-court return and rear/right bands. Client ref17
 // confirms fine timber joints at the front court. Joint spacing/tone are visual
 // approximations; only undersides are clad, and every roof hole remains empty.
 function timberSoffit(polygon,undersideY) {
  const panel=slab(groups.roof,polygon,undersideY+.018,.028,materials.wood);
  if(panel)panel.name='Wood composite soffit — A108 / client ref17';
  const z0=Math.min(...polygon.map(p=>p[1])),z1=Math.max(...polygon.map(p=>p[1]));
  // Scan-line clipping keeps each fine joint entirely inside its concave soffit band.
  for(let z=Math.ceil(z0*3)/3;z<z1;z+=1/3){
   const xs=[];
   for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    if((a[1]<=z&&b[1]>z)||(b[1]<=z&&a[1]>z))
     xs.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]));
   }
   xs.sort((a,b)=>a-b);
   for(let i=0;i+1<xs.length;i+=2)
    if(xs[i+1]-xs[i]>.05)line(groups.roof,[xs[i]+.015,z],[xs[i+1]-.015,z],undersideY-.012,.003,.006,materials.frame);
  }
 }
 for(const band of r.lower_gray_bands)timberSoffit(band.polygon_xz_ft,lowerRoofY-.223);
 // A108 also colors the broad master-terrace ceiling, within the solid roof field.
 // Coordinates are A104 vectors registered to A108 by(-221.28,-26.28)PDFpoints.
 const masterTerraceSoffit=[[1786.20,1175.52],[1958.28,1175.52],[1958.28,1463.88],[1786.20,1472.40]]
  .map(([u,v])=>[(v-824.40)/18,(u-412.86)/18]);
 timberSoffit(masterTerraceSoffit,roofY-.243);

 // Ten 4×8in louvers, directly traced from A104's one-foot module.
 for(let i=0;i<10;i++) {
  const v=1320.48+18*i;
  const x=(v-824.40)/18;
  line(groups.roof,[x,(1376.52-412.86)/18],[x,(1472.64-412.86)/18],roofFinishY-8*IN,8*IN,4*IN,materials.wood);
 }

 // Mechanical enclosure: footprint and 5ft screen height from A104; equipment shapes are simplified.
 const screen=r.roof_equipment_screen.approx_polygon_xz_ft;
 for(let k=0;k<11;k++)edge(groups.roof,screen,roofY+.12+k*(5*FT-.14)/11,.075,.075,materials.frame);
 for(const pt of screen)fb(groups.roof,pt[0],pt[1],.14,.14,roofY,5*FT,materials.frame);
 for(const u of [862.8,919.3,972.9,1037.3]){
  const point=[(970-824.4)/18,(u-412.86)/18];
  fb(groups.roof,point[0],point[1],2.6,2.8,roofY+.16,.63,materials.concrete);
  cylinder(groups.roof,point,roofY+.80,.28,.025,materials.frame);
 }
 const hatch=r.roof_hatch.approx_center_xz_ft;
 fb(groups.roof,hatch[0],hatch[1],5.35,2.81,roofY+.03,.12,materials.frame);
 const sky=r.skylight.approx_center_xz_ft;
 fb(groups.roof,sky[0],sky[1],2.06,2.06,roofY+.03,16*IN,materials.frame);
 fb(groups.roof,sky[0],sky[1],1.85,1.85,roofY+16*IN+.03,.024,materials.glass);
 return {roofY,roofFinishY,lowerRoofY,copingY,deckY};
}
