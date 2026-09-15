"use strict";
(()=>{
  const $=selector=>document.querySelector(selector);
  const handle=$("#musicClefHandle"),drawer=$("#musicDrawer"),veil=$("#drawerVeil"),close=$("#drawerClose");
  if(!handle||!drawer)return;
  const root=$("#drawerRoot"),scale=$("#drawerScale"),octave=$("#drawerOctave"),music=$("#drawerMusic"),summary=$("#drawerSummary");
  const noteLabels=["Do","Do♯","Ré","Mi♭","Mi","Fa","Fa♯","Sol","La♭","La","Si♭","Si"];
  const scaleLabels={blues:"Blues",major:"Majeure",minor:"Mineure naturelle",pentatonic:"Pentatonique majeure",minorPentatonic:"Pentatonique mineure",allOctaves:"Toutes les octaves"};
  const scaleIntervals={blues:[0,3,5,6,7,10,12],major:[0,2,4,5,7,9,11,12],minor:[0,2,3,5,7,8,10,12],pentatonic:[0,2,4,7,9,12],minorPentatonic:[0,3,5,7,10,12]};
  let previewAudio=null;
  const comfortableOctave=rootValue=>rootValue>=7?3:4;
  const scaleBase=(rootValue,octaveValue)=>12*((octaveValue==="auto"?comfortableOctave(rootValue):Number(octaveValue))+1)+rootValue;
  const staffStep=midi=>{const diatonic=[0,0,1,1,2,3,3,4,4,5,5,6];return(Math.floor(midi/12)-5)*7+diatonic[midi%12]};
  const compactMidi=midi=>{while(midi>74)midi-=12;while(midi<55)midi+=12;return midi};
  function validateOctave(){
    const octaveField=octave?.closest("label");
    if(octaveField)octaveField.hidden=scale?.value==="allOctaves";
    const low=octave?.querySelector('option[value="3"]'),hint=$("#drawerOctaveHint");if(!low)return;const rootValue=Number(root.value);low.disabled=rootValue<6;if(low.disabled&&octave.value==="3")octave.value="auto";if(hint)hint.textContent=low.disabled?`${noteLabels[rootValue]}3 est sous la tessiture standard. La trompette commence à Fa♯3.`:"";
  }

  function previewNote(midi){
    previewAudio ||= new (window.AudioContext||window.webkitAudioContext)();
    if(previewAudio.state==="suspended")previewAudio.resume();
    const now=previewAudio.currentTime,osc=previewAudio.createOscillator(),gain=previewAudio.createGain();
    osc.type="triangle";osc.frequency.value=440*Math.pow(2,(midi-69)/12);
    gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.17,now+.018);gain.gain.exponentialRampToValueAtTime(.0001,now+.48);
    osc.connect(gain).connect(previewAudio.destination);osc.start(now);osc.stop(now+.5);
  }
  function allOctaveMidis(rootValue){const out=[];for(let midi=54;midi<=90;midi++)if(midi%12===rootValue)out.push(midi);return out}
  function renderScalePreview(){
    const panel=document.querySelector('[data-source-panel="scale"]');if(!panel||!root||!scale)return;
    let preview=panel.querySelector(".drawer-scale-preview");
    if(!preview){preview=document.createElement("div");preview.className="drawer-scale-preview";preview.innerHTML='<div class="scale-preview-heading"><strong>Aperçu de la gamme</strong><small>Clique une note pour l’écouter</small></div><div class="mini-staff"><span class="mini-clef" aria-hidden="true">𝄞</span><div class="mini-staff-lines"></div><div class="mini-scale-notes"></div></div>';panel.appendChild(preview)}
    const rootValue=Number(root.value),isAllOctaves=scale.value==="allOctaves";
    const base=scaleBase(rootValue,octave?.value||"auto"),intervals=isAllOctaves?null:(scaleIntervals[scale.value]||scaleIntervals.blues);
    const midis=isAllOctaves?allOctaveMidis(rootValue):intervals.map(interval=>base+interval);
    const notes=preview.querySelector(".mini-scale-notes");notes.style.setProperty("--scale-count",String(midis.length));notes.innerHTML="";
    midis.forEach(midi=>{
      const button=document.createElement("button"),name=`${noteLabels[midi%12]}${Math.floor(midi/12)-1}`,values=window.TrumpetFingerings.primary(midi),hard=midi>window.TrumpetFingerings.highestWrittenMidi;
      button.type="button";button.className="mini-note"+(hard?" hard":"");button.style.setProperty("--note-y",`${49-staffStep(compactMidi(midi))*2.15}px`);button.setAttribute("aria-label",`${name}, ${values.length?`pistons ${values.join(" et ")}`:"pistons libres"}${hard?", note avancée au-delà de la tessiture standard":""}`);
      button.innerHTML=`<span class="mini-note-head" aria-hidden="true"></span><strong>${name}</strong><span class="mini-fingering">${(values.length?values:[0]).map(value=>`<i class="finger-${value}">${value}</i>`).join("")}</span>`;
      button.addEventListener("click",()=>{previewNote(midi);notes.querySelectorAll(".mini-note").forEach(note=>note.classList.remove("sounding"));button.classList.add("sounding");setTimeout(()=>button.classList.remove("sounding"),430)});notes.appendChild(button);
    });
  }

  function openDrawer(){document.body.classList.add("drawer-open");drawer.setAttribute("aria-hidden","false");handle.setAttribute("aria-expanded","true");veil.hidden=false;requestAnimationFrame(()=>veil.classList.add("visible"));}
  function closeDrawer(){document.body.classList.remove("drawer-open");drawer.setAttribute("aria-hidden","true");handle.setAttribute("aria-expanded","false");veil.classList.remove("visible");setTimeout(()=>{if(!document.body.classList.contains("drawer-open"))veil.hidden=true},320);handle.focus();}
  function selectedMode(){return document.querySelector('input[name="drawerMode"]:checked')?.value||"hero"}
  function selectedSource(){return document.querySelector("[data-source-tab].active")?.dataset.sourceTab||"scale"}
  function updateSummary(){
    validateOctave();
    const mode={hero:"Héros",instrument:"Instrument",partition:"Partition"}[selectedMode()];
    const songName=music?.selectedOptions?.[0]?.textContent||"Premiers pas",rootValue=Number(root.value),isAllOctaves=scale.value==="allOctaves";
    const startOctave=octave?.value==="auto"?comfortableOctave(rootValue):Number(octave?.value||4);
    const scaleSummary=isAllOctaves?`${noteLabels[rootValue]} trompette · toutes les octaves`:`${noteLabels[rootValue]}${startOctave} trompette · ${scaleLabels[scale.value]}`;
    summary.textContent=selectedSource()==="scale"?`${scaleSummary} · ${mode}`:`${songName} · ${mode}`;
    renderScalePreview();
  }

  handle.addEventListener("click",()=>document.body.classList.contains("drawer-open")?closeDrawer():openDrawer());close.addEventListener("click",closeDrawer);veil.addEventListener("click",closeDrawer);
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&document.body.classList.contains("drawer-open"))closeDrawer()});
  document.querySelectorAll("[data-source-tab]").forEach(tab=>tab.addEventListener("click",()=>{
    document.querySelectorAll("[data-source-tab]").forEach(item=>{const active=item===tab;item.classList.toggle("active",active);item.setAttribute("aria-selected",String(active))});
    document.querySelectorAll("[data-source-panel]").forEach(panel=>{const active=panel.dataset.sourcePanel===tab.dataset.sourceTab;panel.classList.toggle("active",active);panel.hidden=!active});updateSummary();
  }));
  [root,scale,octave,music,...document.querySelectorAll('input[name="drawerMode"]')].filter(Boolean).forEach(input=>input.addEventListener("change",updateSummary));
  $("#drawerImportMidi").addEventListener("click",()=>{$("#midiInput")?.click()});
  $("#drawerPlay").addEventListener("click",()=>{
    const detail={source:selectedSource(),mode:selectedMode(),root:Number(root.value),scale:scale.value,octave:octave?.value||"auto",music:music?.value||"demo"};
    window.dispatchEvent(new CustomEvent("trompetterie:play",{detail}));closeDrawer();
  });
  updateSummary();
})();
