import * as THREE from './vendor/three/three.module.min.js';
import {greatCircle} from './connect-data.js';

// Earth surface and atmospheric treatment adapted from Master Dev Workshop's
// world.ts. Original day/night maps and licence are in assets/earth/.
const vector=p=>{
 const lat=p.lat*Math.PI/180,lon=p.lon*Math.PI/180;
 return new THREE.Vector3(Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon));
};
const vertex=`varying vec2 vUv; varying vec3 vN; void main(){vUv=uv;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const surface=`uniform sampler2D dayMap;uniform sampler2D nightMap;uniform vec3 sun;varying vec2 vUv;varying vec3 vN;void main(){float d=dot(normalize(vN),normalize(sun));float daylight=smoothstep(-.15,.28,d);vec3 day=texture2D(dayMap,vUv).rgb;vec3 night=texture2D(nightMap,vUv).rgb;vec3 color=mix(day*vec3(.055,.085,.14)+night*.85,day*(.65+.35*max(0.,d)),daylight);gl_FragColor=vec4(color,1.);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`;

export function createEarth(canvas,{onPins=()=>{},onError=()=>{},onReady=()=>{}}={}){
 let renderer;
 try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'low-power'});}catch(error){onError();return null;}
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
 renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.35;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,20),globe=new THREE.Group();
 camera.position.z=3.55;scene.add(globe);
 let disposed=false,origin=null,matches=[],lines=[],markers=[],yaw=0,pitch=.3,zoom=1,width=1,height=1,active=null,lastProgress=0;
 const loader=new THREE.TextureLoader();
 const ready=[];
 const texture=name=>{
  const t=loader.load(new URL('./assets/earth/'+name,import.meta.url).href,()=>{if(disposed)return;ready.push(name);render(lastProgress);if(ready.length===2)onReady();},undefined,()=>{if(!disposed)onError();});
  t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());return t;
 };
 const dayMap=texture('earth-day.jpg'),nightMap=texture('earth-night.jpg');
 const earth=new THREE.Mesh(new THREE.SphereGeometry(1,96,64),new THREE.ShaderMaterial({uniforms:{dayMap:{value:dayMap},nightMap:{value:nightMap},sun:{value:new THREE.Vector3(-.8,.45,1.1)}},vertexShader:vertex,fragmentShader:surface.replace(');#include',');\n#include')}));
 earth.rotation.y=-Math.PI/2;globe.add(earth);
 const atmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.045,64,48),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,blending:THREE.AdditiveBlending,vertexShader:'varying vec3 n;varying vec3 v;void main(){vec4 p=modelMatrix*vec4(position,1.);n=normalize(mat3(modelMatrix)*normal);v=normalize(cameraPosition-p.xyz);gl_Position=projectionMatrix*viewMatrix*p;}',fragmentShader:'varying vec3 n;varying vec3 v;void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),2.8);gl_FragColor=vec4(.45,.65,1.,rim*.38);}'}));
 globe.add(atmosphere);
 const cloud=new THREE.Mesh(new THREE.SphereGeometry(1.007,64,48),new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0}},vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;uniform float time;float hash(vec3 a){a=fract(a*.3183099+.1);a*=17.;return fract(a.x*a.y*a.z*(a.x+a.y+a.z));}float noise(vec3 a){vec3 i=floor(a),f=fract(a);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}void main(){vec3 a=p*8.+vec3(time*.006,0,0);float n=noise(a)*.6+noise(a*2.1)*.3;float alpha=smoothstep(.5,.69,n)*.19;gl_FragColor=vec4(.85,.91,1.,alpha);}'}));
 globe.add(cloud);
 const pointGeometry=new THREE.SphereGeometry(.012,12,10),headGeometry=new THREE.ConeGeometry(.014,.04,8);
 function disposeObjects(){for(const x of lines){globe.remove(x.line,x.head);x.line.geometry.dispose();x.line.material.dispose();x.head.material.dispose();}for(const x of markers){globe.remove(x.mesh);x.mesh.material.dispose();}lines=[];markers=[];}
 function setEvents(nextOrigin,nextMatches){
  disposeObjects();origin=nextOrigin;matches=nextMatches;
  if(origin&&Number.isFinite(origin.lon)&&Number.isFinite(origin.lat)){
   yaw=-origin.lon*Math.PI/180;pitch=origin.lat*Math.PI/180;
   for(const [index,s] of matches.entries()){
    const points=Array.from({length:81},(_,i)=>vector(greatCircle(origin,s,i/80)).multiplyScalar(1.018+.14*Math.sin(Math.PI*i/80)));
    const geometry=new THREE.BufferGeometry().setFromPoints(points),line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xf0bd83,transparent:true,opacity:.45}));
    const head=new THREE.Mesh(headGeometry,new THREE.MeshBasicMaterial({color:0xffdbb1,transparent:true,opacity:.9}));
    globe.add(line,head);lines.push({line,head,points,id:s.id,index});
   }
  }
  for(const s of [...(origin&&Number.isFinite(origin.lon)?[{...origin,id:'origin',origin:true}]:[]),...matches]){
   const mesh=new THREE.Mesh(pointGeometry,new THREE.MeshBasicMaterial({color:s.origin?0xffd5a0:0xf4f8ff}));mesh.position.copy(vector(s).multiplyScalar(1.025));mesh.scale.setScalar(s.origin?1.5:1);globe.add(mesh);markers.push({mesh,s});
  }
  render();
 }
 function render(progress=lastProgress){
  if(disposed)return;
  lastProgress=progress;
  globe.rotation.set(pitch,yaw,0);camera.position.z=3.55/zoom;
  cloud.material.uniforms.time.value=progress*5;
  for(const entry of lines){
   const t=Math.max(0,Math.min(1,progress*(lines.length+1)-entry.index*.7));
   const count=Math.max(1,Math.round(t*80));entry.line.geometry.setDrawRange(0,count+1);
   entry.line.material.opacity=active===entry.id ? .95 : t===1 ? .32 : .75;
   entry.head.visible=t>0;entry.head.position.copy(entry.points[count]);
   const direction=entry.points[count].clone().sub(entry.points[Math.max(0,count-1)]).normalize();entry.head.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
  }
  globe.updateMatrixWorld(true);camera.updateMatrixWorld();
  const pins=[];
  for(const {mesh,s} of markers){
   const world=mesh.getWorldPosition(new THREE.Vector3()),facing=world.clone().normalize().dot(camera.position.clone().sub(world).normalize());
   if(facing<.02)continue;
   const projected=world.clone().project(camera);let x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
   for(let i=0;i<24&&pins.some(p=>Math.hypot(x-p.x,y-p.y)<30);i++){x+=Math.cos(i*2.4)*8;y+=Math.sin(i*2.4)*8;}
   pins.push({...s,x,y});
  }
  renderer.render(scene,camera);onPins(pins);
 }
 function resize(w,h){width=w;height=h;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();render();}
 const lost=e=>{e.preventDefault();onError();};canvas.addEventListener('webglcontextlost',lost);
 return {setEvents,render,resize,rotate(dx,dy){yaw+=dx;pitch=Math.max(-1.3,Math.min(1.3,pitch+dy));},locate(s){yaw=-s.lon*Math.PI/180;pitch=s.lat*Math.PI/180;render();},zoom(delta){zoom=Math.max(.7,Math.min(1.5,zoom+delta));render();},highlight(id){active=id;render();},dispose(){disposed=true;canvas.removeEventListener('webglcontextlost',lost);disposeObjects();dayMap.dispose();nightMap.dispose();for(const mesh of [earth,atmosphere,cloud]){mesh.geometry.dispose();mesh.material.dispose();}pointGeometry.dispose();headGeometry.dispose();renderer.dispose();}};
}
