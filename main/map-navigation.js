'use strict';
const { fetchJson } = require('../tools/net');

function haversineM(a,b){const R=6371000,toRad=d=>d*Math.PI/180;const dLat=toRad(b.latitude-a.latitude),dLon=toRad(b.longitude-a.longitude);const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function pointSegmentDistanceM(p,a,b){ // local equirectangular projection, sufficient for off-route detection
  const lat0=p.latitude*Math.PI/180, kx=111320*Math.cos(lat0), ky=110540;
  const px=(p.longitude-a.longitude)*kx, py=(p.latitude-a.latitude)*ky, bx=(b.longitude-a.longitude)*kx, by=(b.latitude-a.latitude)*ky;
  const den=bx*bx+by*by, t=den?Math.max(0,Math.min(1,(px*bx+py*by)/den)):0;
  return Math.hypot(px-bx*t,py-by*t);
}
function normalizeRoute(r, index=0){return {id:`route-${Date.now()}-${index}`,distance_km:Math.round(r.distance/100)/10,duration_min:Math.max(1,Math.round(r.duration/60)),geometry:r.geometry?.coordinates?.map(([longitude,latitude])=>({latitude,longitude}))||[],steps:(r.legs||[]).flatMap(l=>l.steps||[]).map(s=>({instruction:[s.maneuver?.type,s.maneuver?.modifier].filter(Boolean).join(' '),name:s.name||'',distance_m:Math.round(s.distance),duration_s:Math.round(s.duration),location:s.maneuver?.location?{longitude:s.maneuver.location[0],latitude:s.maneuver.location[1]}:null}))};}
async function calculateRoutes(from,to,{alternatives=true,signal}={}){
  const q=new URLSearchParams({overview:'full',geometries:'geojson',steps:'true',alternatives:alternatives?'true':'false'});
  const url=`https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?${q}`;
  const j=await fetchJson(url,{signal}); if(!j.routes?.length) throw new Error('No driving route found.');
  return j.routes.map(normalizeRoute).sort((a,b)=>a.duration_min-b.duration_min);
}
class MapNavigationManager{
  constructor(app){this.app=app;this.location=null;this.session=null;this.markers=[];}
  setLocation(loc){if(!Number.isFinite(loc?.latitude)||!Number.isFinite(loc?.longitude)) throw new Error('Invalid location.');this.location={latitude:loc.latitude,longitude:loc.longitude,accuracy:loc.accuracy||null,heading:loc.heading??null,speed:loc.speed??null,timestamp:Date.now()};this._progress();return this.location;}
  async route(from,to,opts={}){const routes=await calculateRoutes(from,to,opts);this.app.getWindow?.()?.webContents.send('map:event',{type:'routes',routes,from,to});return routes;}
  async start({to,from=null}){from=from||this.location;if(!from) throw new Error('Current location is unavailable. Open Map and allow location, or provide a start point.');const routes=await this.route(from,to,{alternatives:true});const route=routes[0];this.session={active:true,paused:false,to,route,startedAt:Date.now(),lastRerouteAt:0,remaining_km:route.distance_km,eta_min:route.duration_min};this.app.getWindow?.()?.webContents.send('map:event',{type:'navigation_start',session:this.session});return this.session;}
  pause(){if(this.session)this.session.paused=true;return this.status();} resume(){if(this.session)this.session.paused=false;return this.status();} stop(){const old=this.session;this.session=null;this.app.getWindow?.()?.webContents.send('map:event',{type:'navigation_stop'});return {stopped:!!old};} status(){return {location:this.location,session:this.session};}
  async recalculate(){if(!this.session||!this.location) throw new Error('No active navigation/current location.');const routes=await this.route(this.location,this.session.to,{alternatives:true});this.session.route=routes[0];this.session.lastRerouteAt=Date.now();return this.session;}
  _progress(){const s=this.session;if(!s||s.paused||!this.location)return;const pts=s.route.geometry;if(pts.length>1){let min=Infinity;for(let i=0;i<pts.length-1;i++)min=Math.min(min,pointSegmentDistanceM(this.location,pts[i],pts[i+1]));const direct=haversineM(this.location,s.to);s.remaining_km=Math.round(direct/100)/10;s.eta_min=Math.max(1,Math.round((direct/Math.max(1,s.route.distance_km*1000))*s.route.duration_min));this.app.getWindow?.()?.webContents.send('map:event',{type:'navigation_progress',location:this.location,offRouteM:Math.round(min),session:s});if(min>120&&Date.now()-s.lastRerouteAt>30000){s.lastRerouteAt=Date.now();this.recalculate().catch(()=>{});}}}
}
module.exports={MapNavigationManager,calculateRoutes,haversineM};
