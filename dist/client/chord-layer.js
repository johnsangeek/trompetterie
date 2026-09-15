"use strict";

const NOTE_FR=["Do","Réb","Ré","Mib","Mi","Fa","Solb","Sol","Lab","La","Sib","Si"];
const NOTE_INT=["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const CHORDS={
  maj:{symbol:"",intervals:[0,4,7]},min:{symbol:"m",intervals:[0,3,7]},maj7:{symbol:"maj7",intervals:[0,4,7,11]},min7:{symbol:"m7",intervals:[0,3,7,10]},
  dom7:{symbol:"7",intervals:[0,4,7,10]},maj9:{symbol:"maj9",intervals:[0,4,7,11,14]},min9:{symbol:"m9",intervals:[0,3,7,10,14]},dom9:{symbol:"9",intervals:[0,4,7,10,14]},
  dom13:{symbol:"13",intervals:[0,4,7,10,14,21]},maj69:{symbol:"6/9",intervals:[0,2,4,7,9]},min69:{symbol:"m6/9",intervals:[0,2,3,7,9]},min11:{symbol:"m11",intervals:[0,3,7,10,14,17]},
  dom9sus:{symbol:"9sus4",intervals:[0,5,7,10,14]},dim7:{symbol:"dim7",intervals:[0,3,6,9]}
};
const state={master:null,overlay:null,style:"jazz",audacity:2,generation:0,generated:[],audio:null,suppressGeneratedClick:false};
const $=id=>document.getElementById(id);
const pc=n=>((n%12)+12)%12;
const midiName=n=>`${NOTE_FR[pc(n)]}${Math.floor(n/12)-1}`;
const chordName=c=>c?`${NOTE_FR[c.root]}${CHORDS[c.quality].symbol}`:"—";

function readVariable(view,cursor){let value=0,byte;do{if(cursor.pos>=view.byteLength)throw new Error("MIDI incomplet");byte=view.getUint8(cursor.pos++);value=(value<<7)|(byte&127)}while(byte&128);return value}
function parseMidi(arrayBuffer){
  const view=new DataView(arrayBuffer),cursor={pos:0},text=(at,n)=>String.fromCharCode(...new Uint8Array(arrayBuffer,at,n)),u32=()=>{const value=view.getUint32(cursor.pos);cursor.pos+=4;return value};
  if(text(0,4)!=="MThd")throw new Error("Ce fichier n’est pas un MIDI standard");cursor.pos=4;const headerLength=u32();if(headerLength<6)throw new Error("En-tête MIDI invalide");
  const format=view.getUint16(cursor.pos),trackCount=view.getUint16(cursor.pos+2);let division=view.getUint16(cursor.pos+4);if(division&0x8000)division=480;cursor.pos=8+headerLength;
  const notes=[];let tempo=500000,maxTick=0;
  for(let track=0;track<trackCount&&cursor.pos+8<=view.byteLength;track++){
    if(text(cursor.pos,4)!=="MTrk")break;cursor.pos+=4;const length=u32(),end=Math.min(view.byteLength,cursor.pos+length),active=new Map();let tick=0,running=0;
    while(cursor.pos<end){tick+=readVariable(view,cursor);maxTick=Math.max(maxTick,tick);let status=view.getUint8(cursor.pos),first=null;if(status<128){if(!running)throw new Error("Événement MIDI invalide");first=status;status=running;cursor.pos++}else{cursor.pos++;if(status<240)running=status}
      if(status===255){const type=view.getUint8(cursor.pos++),size=readVariable(view,cursor);if(type===81&&size===3)tempo=(view.getUint8(cursor.pos)<<16)|(view.getUint8(cursor.pos+1)<<8)|view.getUint8(cursor.pos+2);cursor.pos+=size;continue}
      if(status===240||status===247){cursor.pos+=readVariable(view,cursor);continue}
      const high=status&240,channel=status&15,short=high===192||high===208,d1=first===null?view.getUint8(cursor.pos++):first,d2=short?0:view.getUint8(cursor.pos++),key=`${channel}:${d1}`;
      if(high===144&&d2>0&&channel!==9){if(!active.has(key))active.set(key,[]);active.get(key).push({start:tick,note:d1,velocity:d2})}
      else if((high===128||high===144&&d2===0)&&active.has(key)){const started=active.get(key).shift();if(started)notes.push({...started,end:Math.max(tick,started.start+1)});if(!active.get(key).length)active.delete(key)}
    }
    active.forEach(queue=>queue.forEach(started=>notes.push({...started,end:Math.max(maxTick,started.start+division)})));cursor.pos=end;
  }
  if(!notes.length)throw new Error("Aucune note exploitable dans ce MIDI");return{format,trackCount,division,tempo,notes,groups:groupNotes(notes,division)};
}
function groupNotes(notes,division){
  const tolerance=Math.max(1,Math.round(division/10)),groups=[];[...notes].sort((a,b)=>a.start-b.start||a.note-b.note).forEach(note=>{let group=groups[groups.length-1];if(!group||note.start-group.start>tolerance){group={start:note.start,events:[]};groups.push(group)}group.events.push(note)});
  return groups.map(group=>{const unique=[...new Set(group.events.map(event=>event.note))].sort((a,b)=>a-b),ends=group.events.map(event=>event.end).sort((a,b)=>a-b);return{start:group.start,end:ends[Math.floor(ends.length/2)]||group.start+division,notes:unique,velocity:Math.round(group.events.reduce((sum,event)=>sum+event.velocity,0)/group.events.length)}}).filter(group=>new Set(group.notes.map(pc)).size>=3);
}
function detectChord(notes){
  const pcs=new Set(notes.map(pc)),bass=pc(Math.min(...notes)),ranked=[];Object.entries(CHORDS).forEach(([quality,def])=>{for(let root=0;root<12;root++){const wanted=new Set(def.intervals.map(interval=>pc(root+interval)));let hit=0;wanted.forEach(tone=>{if(pcs.has(tone))hit++});const missing=wanted.size-hit,extra=[...pcs].filter(tone=>!wanted.has(tone)).length,score=hit*3-missing*3-extra*.6+(root===bass?1.2:0)+(wanted.size===pcs.size?.7:0);ranked.push({root,quality,score})}});ranked.sort((a,b)=>b.score-a.score);return ranked[0]||null;
}
function estimateKey(parsed){
  const major=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],minor=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17],weights=Array(12).fill(0);
  parsed.notes.forEach(note=>weights[pc(note.note)]+=Math.max(1,note.end-note.start));const total=weights.reduce((sum,value)=>sum+value,0)||1,first=detectChord(parsed.groups[0]?.notes||[]),last=detectChord(parsed.groups.at(-1)?.notes||[]);let best={score:-Infinity,root:0,mode:"major"};for(let root=0;root<12;root++){for(const [mode,profile] of [["major",major],["minor",minor]]){let score=0;for(let tone=0;tone<12;tone++)score+=weights[tone]/total*profile[pc(tone-root)];if(first?.root===root)score+=2.6;if(first&&family(first.quality)===mode)score+=.8;if(last?.root===root)score+=.45;if(score>best.score)best={score,root,mode}}}return best;
}
function family(quality){return quality.startsWith("min")?"minor":quality.startsWith("dom")?"dominant":"major"}
function styleQuality(found,style,audacity){
  if(found.quality==="dim7")return "dim7";
  const f=family(found.quality),map={
    jazz:{major:audacity===1?"maj7":"maj9",minor:audacity===1?"min7":audacity===3?"min11":"min9",dominant:audacity===3?"dom13":"dom9"},
    neosoul:{major:"maj69",minor:audacity===3?"min11":"min9",dominant:"dom9sus"},
    bossa:{major:"maj69",minor:"min69",dominant:"dom9"},
    blues:{major:"dom9",minor:"min9",dominant:audacity===3?"dom13":"dom9"}
  };return map[style][f];
}
function phraseQuality(found,style,audacity,{repeat,penultimate,final}){
  const base=styleQuality(found,style,audacity),f=family(found.quality);if(!repeat&&!penultimate&&!final)return base;
  if(style==="jazz"){if(f==="minor")return "min11";if(f==="dominant")return final||penultimate?"dom13":"dom9sus";return final?"maj69":"maj9"}
  if(style==="neosoul"){if(f==="minor")return "min11";if(f==="dominant")return final?"dom13":"dom9sus";return final?"maj9":"maj69"}
  if(style==="bossa"){if(f==="minor")return repeat?"min9":"min69";if(f==="dominant")return final?"dom13":"dom9";return repeat?"maj9":"maj69"}
  if(style==="blues"){if(f==="minor")return repeat?"min11":"min9";return final||penultimate?"dom13":"dom9"}
  return base;
}
function voicingCandidates(root,quality,audacity){
  let intervals=[...CHORDS[quality].intervals];if(audacity<3&&intervals.length>5)intervals=intervals.filter((_,index)=>index!==2);if(audacity===1&&intervals.length>4)intervals=intervals.slice(0,4);
  if(intervals.length>4)intervals=intervals.filter(interval=>pc(interval)!==7||intervals.length<=4);
  let rootMidi=60;while(pc(rootMidi)!==root)rootMidi++;const normalized=intervals.map(interval=>rootMidi+interval),candidates=[];
  for(let inversion=0;inversion<normalized.length;inversion++){const rotated=normalized.slice(inversion).concat(normalized.slice(0,inversion).map(note=>note+12));for(let i=1;i<rotated.length;i++)while(rotated[i]<=rotated[i-1])rotated[i]+=12;for(const shift of [-12,0,12]){const notes=rotated.map(note=>note+shift);if(Math.min(...notes)>=52&&Math.max(...notes)<=88)candidates.push(notes)}}return candidates.length?candidates:[normalized];
}
function movementCost(from,to){if(!from||!to)return 0;const count=Math.min(from.length,to.length);let cost=Math.abs(from.length-to.length)*4;for(let i=0;i<count;i++)cost+=Math.abs(from[i]-to[i]);return cost}
function seededIndex(seed,index,length){if(length<=1)return 0;let value=(seed+1)*2654435761^(index+11)*1597334677;value^=value>>>16;return Math.abs(value)%length}
function createSuggestions(master,overlay,style,audacity,generation=0){
  const cycleStart=master.groups[0]?.start||0,cycleEnd=Math.max(...master.groups.map(group=>group.end),cycleStart+master.division),cycleLength=Math.max(1,cycleEnd-cycleStart),usedBySlot=new Map(),total=overlay.groups.length;let previous=null;
  return overlay.groups.map((source,index)=>{const wrappedStart=cycleStart+((source.start-cycleStart)%cycleLength+cycleLength)%cycleLength,active=master.groups.filter(group=>group.start<=wrappedStart&&group.end>wrappedStart).sort((a,b)=>b.start-a.start)[0],nearest=master.groups.reduce((best,group)=>!best||Math.abs(group.start-wrappedStart)<Math.abs(best.start-wrappedStart)?group:best,null),base=active||nearest;if(!base)return null;const baseIndex=Math.max(0,master.groups.indexOf(base)),repeat=index>=master.groups.length,penultimate=index===total-2,final=index===total-1,found=detectChord(base.notes),quality=phraseQuality(found,style,audacity,{repeat,penultimate,final}),candidates=voicingCandidates(found.root,quality,audacity),target=68+(index%4===1?3:index%4===3?-2:0)+(repeat?2:0)+(penultimate?5:0)+(final?-1:0)+(audacity===3?(index%2?3:-2):0),previousSlot=usedBySlot.get(baseIndex);
    candidates.sort((a,b)=>{const score=notes=>movementCost(previous,notes)+Math.abs(notes.reduce((s,n)=>s+n,0)/notes.length-target)*1.6+(repeat&&notes.join(",")===previousSlot?90:0);return score(a)-score(b)});const eligible=candidates.filter(notes=>!repeat||notes.join(",")!==previousSlot),pool=(eligible.length?eligible:candidates).slice(0,Math.min(candidates.length,2+audacity)),notes=pool[seededIndex(generation,index,pool.length)];previous=notes;usedBySlot.set(baseIndex,notes.join(","));const phraseLabel=final?"Finale":penultimate?"Montée de tension":repeat?"Reprise variée":"Exposition";return{start:source.start,end:source.end,velocity:source.velocity,base,baseIndex,original:source,notes,phraseLabel,isEnding:penultimate||final,chord:{root:found.root,quality:found.quality},styled:{root:found.root,quality}}}).filter(Boolean);
}
function diatonicSpecs(key){return key.mode==="minor"?[[0,"min9"],[2,"dim7"],[3,"maj9"],[5,"min9"],[7,"min9"],[8,"maj9"],[10,"dom9"]]:[[0,"maj9"],[2,"min9"],[4,"min9"],[5,"maj9"],[7,"dom9"],[9,"min9"],[11,"dim7"]]}
function localVariationIdeas(generated,index,key,style,audacity){
  const item=generated[index];if(!item)return[];const previous=generated[index-1]?.notes||null,next=generated[index+1]?.notes||null,currentSignature=item.notes.join(","),ideas=[];
  voicingCandidates(item.styled.root,item.styled.quality,audacity).filter(notes=>notes.join(",")!==currentSignature).sort((a,b)=>(movementCost(previous,a)+movementCost(a,next))-(movementCost(previous,b)+movementCost(b,next))).slice(0,3).forEach((notes,position)=>ideas.push({kind:"voicing",label:"Même socle",title:`${chordName(item.styled)} · voicing ${position+1}`,description:"L’accord reste identique, seule sa disposition change pour mieux dialoguer avec les mesures voisines.",notes,styled:{...item.styled}}));
  diatonicSpecs(key).map(([offset,quality])=>{const chord={root:pc(key.root+offset),quality};if(chord.root===item.chord.root)return null;const baseNotes=voicingCandidates(chord.root,quality,1)[0],responseQuality=styleQuality(chord,style,audacity),responses=voicingCandidates(chord.root,responseQuality,audacity).sort((a,b)=>(movementCost(previous,a)+movementCost(a,next))-(movementCost(previous,b)+movementCost(b,next)));return{kind:"substitution",label:"Changer le socle",title:chordName({root:chord.root,quality:responseQuality}),description:`Substitution diatonique en ${NOTE_FR[key.root]} ${key.mode==="minor"?"mineur":"majeur"} : une autre fonction, mais aucune note étrangère au thème.`,notes:responses[0],baseNotes,chord,styled:{root:chord.root,quality:responseQuality}}}).filter(Boolean).sort((a,b)=>(movementCost(previous,a.notes)+movementCost(a.notes,next))-(movementCost(previous,b.notes)+movementCost(b.notes,next))).slice(0,4).forEach(idea=>ideas.push(idea));return ideas;
}
function variableBytes(value){let buffer=value&127,out=[];while((value>>=7)){buffer<<=8;buffer|=(value&127)|128}for(;;){out.push(buffer&255);if(buffer&128)buffer>>=8;else break}return out}
function midiBytes(suggestions,division,tempo){
  const track=[0,255,81,3,(tempo>>>16)&255,(tempo>>>8)&255,tempo&255,0,192,4],events=[];suggestions.forEach(item=>item.notes.forEach(note=>{events.push({tick:item.start,on:true,note,velocity:item.velocity||82});events.push({tick:Math.max(item.start+1,item.end),on:false,note,velocity:48})}));events.sort((a,b)=>a.tick-b.tick||(a.on===b.on?0:a.on?1:-1));let last=0;events.forEach(event=>{track.push(...variableBytes(event.tick-last),event.on?144:128,event.note,event.velocity);last=event.tick});track.push(0,255,47,0);const chunk=data=>[77,84,114,107,(data.length>>>24)&255,(data.length>>>16)&255,(data.length>>>8)&255,data.length&255,...data];return new Uint8Array([77,84,104,100,0,0,0,6,0,0,0,1,(division>>>8)&255,division&255,...chunk(track)])
}

function ensureAudio(){if(!state.audio)state.audio=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==="suspended")state.audio.resume();return state.audio}
function playNotes(notes,duration=.72,delay=0){const ctx=ensureAudio(),when=ctx.currentTime+delay;notes.forEach((midi,index)=>{const osc=ctx.createOscillator(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();osc.type=index%2?"triangle":"sine";osc.frequency.value=440*Math.pow(2,(midi-69)/12);filter.type="lowpass";filter.frequency.value=1700;gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(.1/Math.sqrt(notes.length),when+.02);gain.gain.exponentialRampToValueAtTime(.0001,when+duration);osc.connect(filter).connect(gain).connect(ctx.destination);osc.start(when);osc.stop(when+duration+.05)})}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1900)}
function fileStatus(kind,file,parsed){const status=$(`${kind}Status`),drop=$(`${kind}Drop`);status.textContent=`${file.name} · ${parsed.groups.length} accords`;drop.classList.add("ready");drop.querySelector("strong").textContent=file.name}
function compatibility(){if(!state.master||!state.overlay)return 0;const masterPcs=new Set(state.master.notes.map(note=>pc(note.note))),overlayPcs=state.overlay.notes.map(note=>pc(note.note));return Math.round(overlayPcs.filter(tone=>masterPcs.has(tone)).length/Math.max(1,overlayPcs.length)*100)}
function renderAnalysis(){if(!state.master||!state.overlay)return;const key=estimateKey(state.master);$("analysisPanel").hidden=false;$("keyResult").textContent=`${NOTE_FR[key.root]} ${key.mode==="minor"?"mineur":"majeur"}`;$("masterChordCount").textContent=state.master.groups.length;$("overlayChordCount").textContent=state.overlay.groups.length;$("compatibilityResult").textContent=`${compatibility()} % des notes communes`;$("generateBtn").disabled=false}
async function loadFile(kind,file){if(!file)return;const status=$(`${kind}Status`);status.textContent="Analyse…";try{const parsed=parseMidi(await file.arrayBuffer());state[kind]=parsed;fileStatus(kind,file,parsed);renderAnalysis();state.generation=0;state.generated=[];$("generateBtn").textContent="Créer la couche jazz";$("resultPanel").hidden=true}catch(error){status.textContent=error.message;toast("Impossible d’analyser ce MIDI")}}
function chordCell(className,label,notes,knownChord=null){const found=knownChord||detectChord(notes);return `<div class="layer-chord ${className}"><small>${label}</small><strong>${chordName(found)}</strong><p>${notes.map(midiName).join(" · ")}</p></div>`}
function bindLocalEditor(element,index){let timer=null,longPress=false;const clear=()=>{if(timer){clearTimeout(timer);timer=null}};element.title="Appui long ou double-clic pour transformer cette mesure";element.addEventListener("pointerdown",()=>{longPress=false;timer=setTimeout(()=>{longPress=true;state.suppressGeneratedClick=true;openLocalEditor(index)},620)});["pointerup","pointercancel","pointerleave"].forEach(type=>element.addEventListener(type,clear));element.onclick=event=>{if(longPress||state.suppressGeneratedClick){event.preventDefault();state.suppressGeneratedClick=false;return}playNotes(state.generated[index].notes)};element.ondblclick=event=>{event.preventDefault();openLocalEditor(index)}}
function localIdeaCard(idea,index){const card=document.createElement("article");card.className=`local-idea ${idea.kind}`;card.innerHTML=`<small>${idea.label}</small><h3>${idea.title}</h3><p>${idea.description}</p><div class="local-idea-notes">${idea.notes.map(note=>`<span>${midiName(note)}</span>`).join("")}</div><div class="local-idea-actions"><button type="button" class="listen-local">Écouter</button><button type="button" class="apply-local">Appliquer</button></div>`;card.querySelector(".listen-local").onclick=()=>playNotes(idea.notes);card.querySelector(".apply-local").onclick=()=>{const item=state.generated[index];item.notes=[...idea.notes];item.styled={...idea.styled};item.phraseLabel="Variation locale";if(idea.kind==="substitution"){item.base={...item.base,notes:[...idea.baseNotes]};item.chord={...idea.chord};item.localOverride=true}renderResults();$("localVariationDialog").close();toast(`Mesure ${index+1} transformée`)};return card}
function openLocalEditor(index){const item=state.generated[index];if(!item)return;const key=estimateKey(state.master),ideas=localVariationIdeas(state.generated,index,key,state.style,state.audacity),wrap=$("localVariationIdeas");$("localVariationTitle").textContent=`Mesure ${index+1} · ${chordName(item.styled)}`;$("localVariationIntro").textContent=`Choisis un autre voicing, ou change le socle tout en restant dans la tonalité de ${NOTE_FR[key.root]} ${key.mode==="minor"?"mineur":"majeur"}.`;wrap.innerHTML="";ideas.forEach(idea=>wrap.appendChild(localIdeaCard(idea,index)));$("localVariationDialog").showModal()}
function renderResults(){const wrap=$("layerSequence");wrap.innerHTML="";if(!state.generated.length){wrap.innerHTML='<div class="layer-empty">Aucune réponse générée.</div>';return}const varied=state.generated.filter(item=>item.phraseLabel!=="Exposition").length;$("phraseSummary").textContent=`Version ${String(state.generation).padStart(2,"0")} · ${state.generated.length} mesures. La reprise utilise ${varied} variations. Appui long ou double-clic sur une réponse pour transformer uniquement cette mesure.`;state.generated.forEach((item,index)=>{const row=document.createElement("article");row.className=`layer-row ${item.isEnding?"ending":""}`;row.innerHTML=`<span class="layer-row-index">${String(index+1).padStart(2,"0")}</span>${chordCell("base",item.localOverride?"Socle ajusté":"Socle",item.base.notes,item.chord)}${chordCell("original","Original",item.original.notes)}${chordCell("generated",item.phraseLabel,item.notes,item.styled)}`;bindLocalEditor(row.querySelector(".generated"),index);wrap.appendChild(row)});$("resultPanel").hidden=false}
function generate(){if(!state.master||!state.overlay)return;state.generation++;state.generated=createSuggestions(state.master,state.overlay,state.style,state.audacity,state.generation);renderResults();$("generateBtn").textContent="Régénérer une autre version";$("resultPanel").scrollIntoView({behavior:"smooth",block:"start"});toast(`Version ${String(state.generation).padStart(2,"0")} créée`)}
function listenAll(){if(!state.generated.length)return;const beatSeconds=state.overlay.tempo/1000000;state.generated.forEach(item=>playNotes(item.notes,Math.min(1.5,Math.max(.35,(item.end-item.start)/state.overlay.division*beatSeconds*.82)),item.start/state.overlay.division*beatSeconds))}
function exportMidi(){if(!state.generated.length)return;const bytes=midiBytes(state.generated,state.overlay.division,state.overlay.tempo),url=URL.createObjectURL(new Blob([bytes],{type:"audio/midi"})),link=document.createElement("a");link.href=url;link.download=`piano-${state.style}-layer.mid`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("Couche piano exportée")}
function init(){
  for(const kind of ["master","overlay"]){const input=$(`${kind}Input`),drop=$(`${kind}Drop`);input.onchange=event=>loadFile(kind,event.target.files[0]);["dragenter","dragover"].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add("drag")}));["dragleave","drop"].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove("drag")}));drop.addEventListener("drop",event=>loadFile(kind,[...event.dataTransfer.files].find(file=>/\.midi?$/i.test(file.name))))}
  document.querySelectorAll("[data-style]").forEach(button=>button.onclick=()=>{state.style=button.dataset.style;document.querySelectorAll("[data-style]").forEach(item=>item.classList.toggle("active",item===button));if(state.generated.length)generate()});
  $("audacityInput").oninput=event=>{state.audacity=Number(event.target.value);$("audacityLabel").textContent=["","Discrète","Équilibrée","Libre"][state.audacity]};$("generateBtn").onclick=generate;$("listenResultBtn").onclick=listenAll;$("exportLayerBtn").onclick=exportMidi;$("resetBtn").onclick=()=>location.reload();
}
if(typeof document!=="undefined")init();
if(typeof module!=="undefined")module.exports={parseMidi,detectChord,estimateKey,createSuggestions,localVariationIdeas,midiBytes,chordName,midiName};
