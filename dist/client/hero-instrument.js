import * as THREE from "three";
import { GLTFLoader } from "./vendor/three/addons/loaders/GLTFLoader.js";

const stage=document.getElementById("heroInstrument");
const canvas=document.getElementById("heroTrumpetCanvas");
const status=document.getElementById("heroInstrumentStatus");
const dots=[...document.querySelectorAll("[data-instrument-valve]")];

if(stage&&canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-5,5,3,-3,.1,100),root=new THREE.Group();scene.add(root);
  scene.add(new THREE.HemisphereLight(0xfff8ea,0x3c3425,3));const key=new THREE.DirectionalLight(0xffd48a,5);key.position.set(-4,6,8);scene.add(key);const rim=new THREE.DirectionalLight(0x9adbd1,2.6);rim.position.set(5,-2,4);scene.add(rim);
  const valves=[null,null,null],home=[0,0,0],amount=[0,0,0],targets=[0,0,0],tops=[null,null,null];let bounds=null,pistonCenter=0,visible=document.body.dataset.viewMode==="instrument";

  function resize(){
    if(!stage.clientWidth||!stage.clientHeight||!bounds)return;const width=stage.clientWidth,height=stage.clientHeight;renderer.setSize(width,height,false);const aspect=width/height;
    const halfWidth=Math.max((bounds.center.x+bounds.size.x/2)-pistonCenter,pistonCenter-(bounds.center.x-bounds.size.x/2))*1.14;
    const viewHeight=Math.max(bounds.size.y*1.38,(halfWidth*2)/aspect),viewWidth=viewHeight*aspect;camera.left=-viewWidth/2;camera.right=viewWidth/2;camera.top=viewHeight/2;camera.bottom=-viewHeight/2;camera.updateProjectionMatrix();
    const targetY=bounds.center.y+bounds.size.y*.04;camera.position.set(pistonCenter,targetY,bounds.center.z+12);camera.lookAt(pistonCenter,targetY,bounds.center.z);positionDots();
  }
  function positionDots(){
    if(!bounds)return;root.updateMatrixWorld(true);camera.updateMatrixWorld(true);valves.forEach((node,index)=>{if(!node||!tops[index])return;const p=tops[index].clone().applyMatrix4(node.matrixWorld).project(camera);dots[index].style.left=`${(p.x*.5+.5)*stage.clientWidth}px`;dots[index].style.top=`${(-p.y*.5+.5)*stage.clientHeight-26}px`});
  }
  new GLTFLoader().load("./assets/trumpet/trumpet.glb",gltf=>{
    root.add(gltf.scene);const box=new THREE.Box3().setFromObject(gltf.scene);bounds={size:box.getSize(new THREE.Vector3()),center:box.getCenter(new THREE.Vector3())};const xs=[];
    valves.forEach((_,index)=>{const node=gltf.scene.getObjectByName(`Piston_${index+1}`);valves[index]=node;if(!node)return;node.position.z-=.32;home[index]=node.position.y;node.traverse(child=>{if(child.isMesh&&child.material){child.material=child.material.clone();child.material.emissive=new THREE.Color(0)}});gltf.scene.updateMatrixWorld(true);const valveBox=new THREE.Box3().setFromObject(node),worldTop=new THREE.Vector3((valveBox.min.x+valveBox.max.x)/2,valveBox.max.y,(valveBox.min.z+valveBox.max.z)/2);xs.push(worldTop.x);tops[index]=node.worldToLocal(worldTop)});
    if(xs.length)pistonCenter=xs.reduce((sum,x)=>sum+x,0)/xs.length;status.textContent="";resize();
  },undefined,()=>{status.textContent="Trompette indisponible"});
  function animate(){requestAnimationFrame(animate);valves.forEach((node,index)=>{amount[index]+=(targets[index]-amount[index])*(targets[index]>amount[index]?.62:.36);if(node){node.position.y=home[index]-amount[index]*.26;node.traverse(child=>{if(child.isMesh&&child.material?.emissive)child.material.emissive.copy(child.material.color).multiplyScalar(amount[index]*.5)})}});positionDots();if(visible)renderer.render(scene,camera)}animate();
  window.addEventListener("hero:view-mode",event=>{visible=event.detail?.mode==="instrument";if(visible)requestAnimationFrame(resize)});
  window.addEventListener("hero:performance-state",event=>{const active=event.detail?.valves||[];targets.forEach((_,index)=>{targets[index]=active.includes(index+1)?1:0;dots[index].classList.toggle("active",Boolean(targets[index]))})});
  window.addEventListener("resize",resize);
}
