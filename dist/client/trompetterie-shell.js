"use strict";
(()=>{
  const $=selector=>document.querySelector(selector);
  const handle=$("#musicClefHandle"),drawer=$("#musicDrawer"),veil=$("#drawerVeil"),close=$("#drawerClose");
  if(!handle||!drawer)return;
  const root=$("#drawerRoot"),scale=$("#drawerScale"),music=$("#drawerMusic"),summary=$("#drawerSummary");
  const noteLabels=["Do","Do♯","Ré","Mi♭","Mi","Fa","Fa♯","Sol","La♭","La","Si♭","Si"];
  const scaleLabels={blues:"Blues",major:"Majeure",minor:"Mineure naturelle",pentatonic:"Pentatonique majeure",minorPentatonic:"Pentatonique mineure"};

  function openDrawer(){document.body.classList.add("drawer-open");drawer.setAttribute("aria-hidden","false");handle.setAttribute("aria-expanded","true");veil.hidden=false;requestAnimationFrame(()=>veil.classList.add("visible"));}
  function closeDrawer(){document.body.classList.remove("drawer-open");drawer.setAttribute("aria-hidden","true");handle.setAttribute("aria-expanded","false");veil.classList.remove("visible");setTimeout(()=>{if(!document.body.classList.contains("drawer-open"))veil.hidden=true},320);handle.focus();}
  function selectedMode(){return document.querySelector('input[name="drawerMode"]:checked')?.value||"hero"}
  function selectedSource(){return document.querySelector("[data-source-tab].active")?.dataset.sourceTab||"scale"}
  function updateSummary(){const mode={hero:"Héros",instrument:"Instrument",partition:"Partition"}[selectedMode()];const songName=music?.selectedOptions?.[0]?.textContent||"Premiers pas";summary.textContent=selectedSource()==="scale"?`${noteLabels[Number(root.value)]} trompette · ${scaleLabels[scale.value]} · ${mode}`:`${songName} · ${mode}`;}

  handle.addEventListener("click",()=>document.body.classList.contains("drawer-open")?closeDrawer():openDrawer());close.addEventListener("click",closeDrawer);veil.addEventListener("click",closeDrawer);
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&document.body.classList.contains("drawer-open"))closeDrawer()});
  document.querySelectorAll("[data-source-tab]").forEach(tab=>tab.addEventListener("click",()=>{
    document.querySelectorAll("[data-source-tab]").forEach(item=>{const active=item===tab;item.classList.toggle("active",active);item.setAttribute("aria-selected",String(active))});
    document.querySelectorAll("[data-source-panel]").forEach(panel=>{const active=panel.dataset.sourcePanel===tab.dataset.sourceTab;panel.classList.toggle("active",active);panel.hidden=!active});updateSummary();
  }));
  [root,scale,music,...document.querySelectorAll('input[name="drawerMode"]')].filter(Boolean).forEach(input=>input.addEventListener("change",updateSummary));
  $("#drawerImportMidi").addEventListener("click",()=>{$("#midiInput")?.click()});
  $("#drawerPlay").addEventListener("click",()=>{
    const detail={source:selectedSource(),mode:selectedMode(),root:Number(root.value),scale:scale.value,music:music?.value||"demo"};
    window.dispatchEvent(new CustomEvent("trompetterie:play",{detail}));closeDrawer();
  });
  updateSummary();
})();
