"use strict";

const NOTE_FR = ["Do","Réb","Ré","Mib","Mi","Fa","Solb","Sol","Lab","La","Sib","Si"];
const NOTE_INT = ["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const QUALITY = {
  maj:{label:"Majeur",symbol:"",intervals:[0,4,7]}, min:{label:"Mineur",symbol:"m",intervals:[0,3,7]},
  maj7:{label:"Maj 7",symbol:"maj7",intervals:[0,4,7,11]}, min7:{label:"Mineur 7",symbol:"m7",intervals:[0,3,7,10]},
  dom7:{label:"Dominante 7",symbol:"7",intervals:[0,4,7,10]}, maj9:{label:"Maj 9",symbol:"maj9",intervals:[0,4,7,11,14]},
  min9:{label:"Mineur 9",symbol:"m9",intervals:[0,3,7,10,14]}, dom9:{label:"Dominante 9",symbol:"9",intervals:[0,4,7,10,14]},
  dom13:{label:"Dominante 13",symbol:"13",intervals:[0,4,7,10,14,21]}, min7b5:{label:"Demi-diminué",symbol:"m7♭5",intervals:[0,3,6,10]},
  dim7:{label:"Diminué 7",symbol:"dim7",intervals:[0,3,6,9]}, sus4:{label:"Sus 4",symbol:"sus4",intervals:[0,5,7]},
};
const STORAGE = "trumpetTrainerChordProgression";
const state = {notes:new Set(),progression:[],selected:null,direction:"both",audio:null};
const $ = (id)=>document.getElementById(id);

function pc(n){return ((n%12)+12)%12}
function chordName(root,quality,international=false){return `${(international?NOTE_INT:NOTE_FR)[root]}${QUALITY[quality].symbol}`}
function midiLabel(midi){return `${NOTE_FR[pc(midi)]}${Math.floor(midi/12)-1}`}

function canonicalVoicing(root,quality,center=60){
  let base=center; while(pc(base)!==root) base++; if(base>center+6) base-=12;
  return [...new Set(QUALITY[quality].intervals.map(iv=>base+iv).map(n=>n>79?n-12:n))].sort((a,b)=>a-b);
}

function detect(notes){
  if(notes.length<2)return null;
  const pcs=new Set(notes.map(pc)); const bass=pc(Math.min(...notes)); const ranked=[];
  Object.entries(QUALITY).forEach(([quality,def])=>{
    for(let root=0;root<12;root++){
      const wanted=new Set(def.intervals.map(iv=>(root+iv)%12));
      let hit=0; wanted.forEach(v=>{if(pcs.has(v))hit++});
      const missing=wanted.size-hit, extra=[...pcs].filter(v=>!wanted.has(v)).length;
      let score=hit*3-missing*2.8-extra*.55+(root===bass?1.25:0)+(wanted.size===pcs.size?.65:0);
      ranked.push({root,quality,score,hit,missing,extra});
    }
  });
  ranked.sort((a,b)=>b.score-a.score);
  const best=ranked[0];
  best.confidence=Math.max(35,Math.min(99,Math.round(68+best.hit*7-best.missing*13-best.extra*4+(best.root===bass?7:0))));
  best.alternatives=ranked.slice(1).filter(x=>x.score>best.score-1.8).slice(0,3);
  return best;
}

function load(){
  try{const saved=JSON.parse(localStorage.getItem(STORAGE)||"null");if(Array.isArray(saved)&&saved.length)state.progression=saved.filter(x=>Array.isArray(x)&&x.length)}catch(_e){}
  if(!state.progression.length) state.progression=[canonicalVoicing(2,"min9",58),canonicalVoicing(7,"dom7",55)];
  state.selected=state.progression.length-1; state.notes=new Set(state.progression[state.selected]);
}
function save(){localStorage.setItem(STORAGE,JSON.stringify(state.progression))}

function renderSelects(){
  NOTE_FR.forEach((name,i)=>$("rootSelect").add(new Option(`${name} / ${NOTE_INT[i]}`,i)));
  Object.entries(QUALITY).forEach(([key,q])=>$("qualitySelect").add(new Option(q.label,key)));
  $("rootSelect").value="2";$("qualitySelect").value="min9";
}

function renderPiano(){
  const piano=$("piano");piano.innerHTML="";const low=48,high=72;const whites=[];
  for(let midi=low;midi<=high;midi++)if(![1,3,6,8,10].includes(pc(midi)))whites.push(midi);
  whites.forEach((midi,i)=>{const b=document.createElement("button");b.className=`piano-key white ${state.notes.has(midi)?"active":""}`;b.innerHTML=`<span>${midiLabel(midi)}</span>`;b.onclick=()=>toggleNote(midi);piano.appendChild(b);
    const blackPc={0:1,2:3,5:6,7:8,9:10}[pc(midi)];if(blackPc!==undefined&&midi+1<=high){const black=midi+1;const k=document.createElement("button");k.className=`piano-key black ${state.notes.has(black)?"active":""}`;k.style.left=`calc(${(i+1)/whites.length*100}% - 2.1%)`;k.innerHTML=`<span>${NOTE_INT[pc(black)]}</span>`;k.onclick=()=>toggleNote(black);piano.appendChild(k)}});
}

function toggleNote(midi){state.notes.has(midi)?state.notes.delete(midi):state.notes.add(midi);renderAll();playNotes([midi],.25)}

function renderIdentity(){
  const notes=[...state.notes].sort((a,b)=>a-b),found=detect(notes);$("noteCount").textContent=`${notes.length} note${notes.length>1?"s":""}`;
  $("detectedNotes").innerHTML=notes.map(n=>`<span class="note-pill">${midiLabel(n)}</span>`).join("");
  if(!found||notes.length<3){$("detectedName").textContent="—";$("detectedInternational").textContent="Ajoute au moins trois notes";$("confidenceBar").style.width="0";$("confidenceLabel").textContent="—";$("addCurrentBtn").disabled=true;$("alternativeNames").textContent="";return}
  $("detectedName").textContent=chordName(found.root,found.quality);$("detectedInternational").textContent=`${chordName(found.root,found.quality,true)} · ${QUALITY[found.quality].label}`;
  $("confidenceBar").style.width=`${found.confidence}%`;$("confidenceLabel").textContent=`${found.confidence}%`;$("addCurrentBtn").disabled=false;
  $("alternativeNames").textContent=found.alternatives.length?`Autres lectures : ${found.alternatives.map(a=>chordName(a.root,a.quality)).join(" · ")}`:"Lecture harmonique nette.";
}

function renderProgression(){
  const wrap=$("progression");wrap.innerHTML="";state.progression.forEach((notes,i)=>{const found=detect(notes),b=document.createElement("button");b.className=`chord-chip ${i===state.selected?"active":""}`;b.innerHTML=`<small>ACCORD ${String(i+1).padStart(2,"0")}</small><strong>${found?chordName(found.root,found.quality):"?"}</strong><span>${notes.length} notes</span>`;b.onclick=()=>{state.selected=i;state.notes=new Set(notes);renderAll();playNotes(notes)};wrap.appendChild(b)});
  const add=document.createElement("button");add.className="chip-add";add.textContent="+ Accord";add.onclick=()=>{$("clearNotesBtn").click();$("rootSelect").focus()};wrap.appendChild(add);
}

function qualityFamily(q){return q.startsWith("min")?"minor":q.startsWith("dom")||q==="dom7"?"dominant":"major"}
function targetIdeas(source){
  const r=source.root,fam=qualityFamily(source.quality),tonicQuality=fam==="minor"?"min7":"maj7";
  const functional=fam==="dominant"?{offset:5,q:"maj7",role:"Résolution naturelle",why:"La sensible et la septième se détendent vers la tonique."}:fam==="minor"?{offset:5,q:"dom7",role:"Mouvement ii → V",why:"Le mineur prépare une dominante située une quarte plus haut."}:{offset:7,q:"dom7",role:"Appel vers la dominante",why:"Une dominante crée un nouvel élan avant le retour."};
  return [functional,{offset:5,q:tonicQuality,role:"Ouverture au IV",why:"Une réponse large et chantante sur le quatrième degré."},{offset:3,q:fam==="minor"?"maj7":"min7",role:"Couleur relative",why:"Des notes communes changent la lumière sans casser la phrase."},{offset:1,q:"dim7",role:"Approche chromatique",why:"Un accord diminué de passage crée une tension courte."},{offset:-2,q:"min7",role:"Recul modal",why:"Un pas descendant garde une conduite de voix très souple."},{offset:-1,q:"dom7",role:"Résolution par glissement",why:"Toutes les voix peuvent descendre d’un demi-ton avec impact."}];
}
function directedVoicing(root,quality,direction,sourceNotes){
  const mean=sourceNotes.reduce((a,b)=>a+b,0)/sourceNotes.length;let notes=canonicalVoicing(root,quality,Math.round(mean)-3),m=notes.reduce((a,b)=>a+b,0)/notes.length;
  if(direction==="up")while(m<=mean){notes=notes.map(n=>n+12);m+=12}
  else while(m>=mean){notes=notes.map(n=>n-12);m-=12}
  while(Math.min(...notes)<45)notes=notes.map(n=>n+12);while(Math.max(...notes)>84)notes=notes.map(n=>n-12);return notes;
}
function suggestions(){
  if(state.selected===null||!state.progression[state.selected])return[];const sourceNotes=state.progression[state.selected],source=detect(sourceNotes);if(!source)return[];
  return targetIdeas(source).map((idea,i)=>{const direction=i<4?"up":"down",root=pc(source.root+idea.offset),notes=directedVoicing(root,idea.q,direction,sourceNotes);return{...idea,root,quality:idea.q,direction,notes}});
}
function renderAnswers(){
  const wrap=$("answers"),items=suggestions().filter(x=>state.direction==="both"||x.direction===state.direction);wrap.innerHTML="";
  if(state.selected===null){$("sourceSummary").textContent="Sélectionne un accord de la progression pour lancer le calcul.";return}
  const source=detect(state.progression[state.selected]);$("sourceSummary").innerHTML=`Après <strong>${chordName(source.root,source.quality)}</strong>, voici les mouvements qui préservent le mieux la logique et la conduite des voix.`;
  items.forEach(item=>{const card=document.createElement("article");card.className=`answer-card ${item.direction}`;card.innerHTML=`<div class="answer-top"><span>${item.direction==="up"?"↗ réponse montante":"↘ réponse descendante"}</span><span>${item.role}</span></div><h3>${chordName(item.root,item.quality)}</h3><p>${item.why}</p><div class="voice-line">${item.notes.map(n=>`<span>${midiLabel(n)}</span>`).join("")}</div><div class="answer-actions"><button class="listen-btn">Écouter la suite</button><button class="add-answer-btn">+ Ajouter</button></div>`;
    card.querySelector(".listen-btn").onclick=()=>playSequence(state.progression[state.selected],item.notes);card.querySelector(".add-answer-btn").onclick=()=>{state.progression.push(item.notes);state.selected=state.progression.length-1;state.notes=new Set(item.notes);save();renderAll();toast(`${chordName(item.root,item.quality)} ajouté à la progression`)};wrap.appendChild(card)});
}

function ensureAudio(){if(!state.audio)state.audio=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==="suspended")state.audio.resume();return state.audio}
function playNotes(notes,duration=.85,delay=0){const ctx=ensureAudio(),when=ctx.currentTime+delay;notes.forEach((midi,i)=>{const o=ctx.createOscillator(),g=ctx.createGain(),filter=ctx.createBiquadFilter();o.type=i%2?"triangle":"sine";o.frequency.value=440*Math.pow(2,(midi-69)/12);filter.type="lowpass";filter.frequency.value=1800;g.gain.setValueAtTime(.0001,when);g.gain.linearRampToValueAtTime(.12/Math.sqrt(notes.length),when+.025);g.gain.exponentialRampToValueAtTime(.0001,when+duration);o.connect(filter).connect(g).connect(ctx.destination);o.start(when);o.stop(when+duration+.05)})}
function playSequence(a,b){playNotes(a,.7);playNotes(b,1,0.72)}
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),1800)}
function renderAll(){renderPiano();renderIdentity();renderProgression();renderAnswers()}

renderSelects();load();renderAll();
$("placeChordBtn").onclick=()=>{const root=Number($("rootSelect").value),quality=$("qualitySelect").value;state.notes=new Set(canonicalVoicing(root,quality));renderAll();playNotes([...state.notes])};
$("clearNotesBtn").onclick=()=>{state.notes.clear();renderAll()};
$("addCurrentBtn").onclick=()=>{const notes=[...state.notes].sort((a,b)=>a-b);if(notes.length<3)return;state.progression.push(notes);state.selected=state.progression.length-1;save();renderAll();toast("Accord ajouté")};
$("clearAllBtn").onclick=()=>{if(!confirm("Effacer toute la progression ?"))return;state.progression=[];state.selected=null;state.notes.clear();save();renderAll()};
document.querySelectorAll(".direction-btn").forEach(btn=>btn.onclick=()=>{state.direction=btn.dataset.direction;document.querySelectorAll(".direction-btn").forEach(b=>b.classList.toggle("active",b===btn));renderAnswers()});
