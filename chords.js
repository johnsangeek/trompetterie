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
const TIMELINE_STORAGE = "trumpetTrainerChordTimeline";
const state = {notes:new Set(),progression:[],selected:null,direction:"both",audio:null,importedFile:null,timeline:[],timelineMeasures:8,timelineTimers:[],timelineAnimation:null};
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
  try{const layout=JSON.parse(localStorage.getItem(TIMELINE_STORAGE)||"null");if(layout&&Array.isArray(layout.items)){state.timeline=layout.items;state.timelineMeasures=[4,8,16,32].includes(layout.measures)?layout.measures:8}}catch(_e){}
  if(!state.progression.length) state.progression=[canonicalVoicing(2,"min9",58),canonicalVoicing(7,"dom7",55)];
  normalizeTimeline();
  state.selected=state.progression.length-1; state.notes=new Set(state.progression[state.selected]);
}
function save(){normalizeTimeline();localStorage.setItem(STORAGE,JSON.stringify(state.progression));localStorage.setItem(TIMELINE_STORAGE,JSON.stringify({measures:state.timelineMeasures,items:state.timeline}))}

function normalizeTimeline(){
  if(!Array.isArray(state.timeline))state.timeline=[];
  if(state.timeline.length>state.progression.length)state.timeline.length=state.progression.length;
  while(state.timeline.length<state.progression.length){const end=state.timeline.reduce((max,item)=>Math.max(max,Number(item.start||0)+Number(item.duration||1)),0);state.timeline.push({start:Math.min(Math.floor(end),Math.max(0,state.timelineMeasures-1)),duration:1})}
  state.timeline.forEach((item,index)=>{item.start=Math.max(0,Math.min(state.timelineMeasures-1,Number(item.start)||0));item.duration=Math.max(.25,Math.min(4,Number(item.duration)||1));if(item.start+item.duration>state.timelineMeasures)item.duration=Math.max(.25,state.timelineMeasures-item.start);item.index=index});
}

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
  if(!found||notes.length<3){$("detectedName").textContent="—";$("detectedName").disabled=true;$("detectedInternational").textContent="Ajoute au moins trois notes";$("confidenceBar").style.width="0";$("confidenceLabel").textContent="—";$("addCurrentBtn").disabled=true;$("alternativeNames").textContent="";return}
  $("detectedName").textContent=chordName(found.root,found.quality);$("detectedInternational").textContent=`${chordName(found.root,found.quality,true)} · ${QUALITY[found.quality].label}`;
  $("detectedName").disabled=false;$("confidenceBar").style.width=`${found.confidence}%`;$("confidenceLabel").textContent=`${found.confidence}%`;$("addCurrentBtn").disabled=false;
  $("alternativeNames").textContent=found.alternatives.length?`Autres lectures : ${found.alternatives.map(a=>chordName(a.root,a.quality)).join(" · ")}`:"Lecture harmonique nette.";
}

function renderProgression(){
  const wrap=$("progression");wrap.innerHTML="";state.progression.forEach((notes,i)=>{const found=detect(notes),b=document.createElement("div");b.className=`chord-chip ${i===state.selected?"active":""}`;b.tabIndex=0;b.draggable=true;b.setAttribute("role","button");b.innerHTML=`<button type="button" class="delete-chord" aria-label="Supprimer cet accord">×</button><small>ACCORD ${String(i+1).padStart(2,"0")}</small><strong>${found?chordName(found.root,found.quality):"?"}</strong><span>${notes.length} notes</span>`;const select=()=>{state.selected=i;state.notes=new Set(notes);renderAll();playNotes(notes)};b.onclick=(event)=>{if(!event.target.closest(".delete-chord"))select()};b.onkeydown=(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();select()}};b.querySelector(".delete-chord").onclick=(event)=>{event.stopPropagation();removeChord(i)};b.ondragstart=(event)=>{event.dataTransfer.setData("text/chord-index",String(i));b.classList.add("dragging")};b.ondragend=()=>b.classList.remove("dragging");wrap.appendChild(b)});
  const add=document.createElement("button");add.className="chip-add";add.textContent="+ Accord";add.onclick=()=>{$("clearNotesBtn").click();$("rootSelect").focus()};wrap.appendChild(add);
}

function removeChord(index){
  if(index<0||index>=state.progression.length)return;state.progression.splice(index,1);state.timeline.splice(index,1);
  if(!state.progression.length){state.selected=null;state.notes.clear()}else{state.selected=Math.min(index,state.progression.length-1);state.notes=new Set(state.progression[state.selected])}
  save();renderAll();toast("Accord supprimé");
}

function renderTimeline(){
  normalizeTimeline();const canvas=$("timelineCanvas"),measureWidth=150,labelWidth=52,rowHeight=14,top=46,low=45,high=84,totalWidth=labelWidth+state.timelineMeasures*measureWidth,totalHeight=top+(high-low+1)*rowHeight;
  canvas.innerHTML="";canvas.style.width=`${totalWidth}px`;canvas.style.height=`${totalHeight}px`;
  const corner=document.createElement("div");corner.className="timeline-corner";corner.textContent="CHORDS";canvas.appendChild(corner);
  for(let measure=0;measure<state.timelineMeasures;measure++){const number=document.createElement("div");number.className="measure-number";number.style.left=`${labelWidth+measure*measureWidth}px`;number.style.width=`${measureWidth}px`;number.innerHTML=`<strong>${measure+1}</strong>4 / 4`;canvas.appendChild(number);for(let beat=0;beat<4;beat++){const line=document.createElement("i");line.className=beat===0?"measure-line":"beat-line";line.style.left=`${labelWidth+measure*measureWidth+beat*measureWidth/4}px`;canvas.appendChild(line)}}
  for(let midi=high;midi>=low;midi--){const rowIndex=high-midi,key=document.createElement("div"),row=document.createElement("div");key.className="roll-key";key.style.top=`${top+rowIndex*rowHeight}px`;key.style.height=`${rowHeight}px`;key.textContent=midiLabel(midi);row.className=`roll-row ${[1,3,6,8,10].includes(pc(midi))?"black":""}`;row.style.top=key.style.top;row.style.width=`${state.timelineMeasures*measureWidth}px`;row.style.height=key.style.height;canvas.append(row,key)}
  state.timeline.forEach((item,index)=>{const notes=state.progression[index];if(!notes)return;const found=detect(notes),left=labelWidth+item.start*measureWidth,width=Math.max(18,Math.min(item.duration,state.timelineMeasures-item.start)*measureWidth-4),block=document.createElement("div");block.className=`chord-lane-block ${index===state.selected?"selected":""}`;block.style.left=`${left+2}px`;block.style.width=`${width}px`;block.draggable=true;block.innerHTML=`<strong>${found?chordName(found.root,found.quality):"Accord"}</strong><span>M.${Math.floor(item.start)+1} · ${item.duration<1?Math.round(item.duration*4)+" temps":item.duration+" mesure"+(item.duration>1?"s":"")}</span>`;block.onclick=()=>{state.selected=index;state.notes=new Set(notes);$("chordDurationSelect").value=String(item.duration);renderAll();playNotes(notes)};block.ondragstart=event=>{event.dataTransfer.setData("text/timeline-index",String(index));block.classList.add("dragging")};block.ondragend=()=>block.classList.remove("dragging");canvas.appendChild(block);
    notes.forEach(midi=>{if(midi<low||midi>high)return;const note=document.createElement("div");note.className="roll-note";note.style.left=`${left+3}px`;note.style.top=`${top+(high-midi)*rowHeight+1}px`;note.style.width=`${Math.max(12,width-3)}px`;canvas.appendChild(note)})});
  if(!state.progression.length){const empty=document.createElement("div");empty.className="empty-roll-message";empty.textContent="Ajoute ou importe des accords pour remplir la grille.";canvas.appendChild(empty)}
  document.querySelectorAll("[data-measures]").forEach(button=>button.classList.toggle("active",Number(button.dataset.measures)===state.timelineMeasures));
  if(state.selected!==null&&state.timeline[state.selected])$("chordDurationSelect").value=String(state.timeline[state.selected].duration);
}

function moveTimelineChord(index,clientX){
  const viewport=$("timelineViewport"),rect=$("timelineCanvas").getBoundingClientRect(),measureWidth=150,labelWidth=52,x=clientX-rect.left+viewport.scrollLeft-labelWidth,start=Math.max(0,Math.min(state.timelineMeasures-1,Math.floor(x/measureWidth)));
  if(!state.timeline[index])return;state.timeline[index].start=start;if(start+state.timeline[index].duration>state.timelineMeasures)state.timeline[index].duration=Math.max(.25,state.timelineMeasures-start);state.selected=index;save();renderAll();toast(`Accord déplacé en mesure ${start+1}`);
}

function stopTimeline(){state.timelineTimers.forEach(clearTimeout);state.timelineTimers=[];if(state.timelineAnimation){state.timelineAnimation.cancel();state.timelineAnimation=null}const head=document.querySelector(".timeline-playhead");if(head)head.remove()}
function playTimeline(){
  stopTimeline();if(!state.progression.length)return;const bpm=Math.max(30,Math.min(260,Number($("timelineTempo").value)||100)),measureMs=240000/bpm,canvas=$("timelineCanvas"),head=document.createElement("div");head.className="timeline-playhead";head.style.left="52px";canvas.appendChild(head);
  state.timeline.forEach((item,index)=>state.timelineTimers.push(setTimeout(()=>{state.selected=index;playNotes(state.progression[index],Math.min(1.4,item.duration*measureMs/1000*.85));renderProgression()},item.start*measureMs)));
  const end=Math.max(...state.timeline.map(item=>item.start+item.duration),1),distance=end*150;state.timelineAnimation=head.animate([{transform:"translateX(0)"},{transform:`translateX(${distance}px)`}],{duration:end*measureMs,easing:"linear",fill:"forwards"});state.timelineAnimation.onfinish=()=>{state.timelineAnimation=null;state.timelineTimers=[]};
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

function playProgression(progression=state.progression){progression.forEach((notes,i)=>playNotes(notes,.7,i*.62))}

function readMidiFile(arrayBuffer){
  const view=new DataView(arrayBuffer);let pos=0;const text=(at,n)=>String.fromCharCode(...new Uint8Array(arrayBuffer,at,n));
  const u32=()=>{const value=view.getUint32(pos);pos+=4;return value};
  const variable=()=>{let value=0,byte;do{if(pos>=view.byteLength)throw new Error("MIDI incomplet");byte=view.getUint8(pos++);value=(value<<7)|(byte&127)}while(byte&128);return value};
  if(text(0,4)!=="MThd")throw new Error("Ce fichier n’est pas un MIDI standard");pos=4;const headerLength=u32();
  if(headerLength<6)throw new Error("En-tête MIDI invalide");const format=view.getUint16(pos),trackCount=view.getUint16(pos+2);let division=view.getUint16(pos+4);if(division&0x8000)division=480;pos=8+headerLength;
  const events=[];
  for(let track=0;track<trackCount&&pos+8<=view.byteLength;track++){
    if(text(pos,4)!=="MTrk")break;pos+=4;const length=u32(),end=Math.min(view.byteLength,pos+length);let tick=0,running=0;
    while(pos<end){tick+=variable();let status=view.getUint8(pos),first=null;if(status<128){if(!running)throw new Error("Événement MIDI invalide");first=status;status=running;pos++}else{pos++;if(status<240)running=status}
      if(status===255){pos++;const size=variable();pos+=size;continue}if(status===240||status===247){pos+=variable();continue}
      const high=status&240,channel=status&15,short=high===192||high===208;const d1=first===null?view.getUint8(pos++):first;const d2=short?0:view.getUint8(pos++);
      if(high===144&&d2>0&&channel!==9)events.push({tick,note:d1,velocity:d2});
    }
    pos=end;
  }
  if(!events.length)throw new Error("Aucune note exploitable dans ce MIDI");events.sort((a,b)=>a.tick-b.tick||a.note-b.note);
  const tolerance=Math.max(1,Math.round(division/3)),groups=[];for(const event of events){let group=groups[groups.length-1];if(!group||event.tick-group.start>tolerance){group={start:event.tick,notes:[]};groups.push(group)}if(!group.notes.includes(event.note))group.notes.push(event.note)}
  const progression=[];let previous="";for(const group of groups){if(new Set(group.notes.map(pc)).size<3)continue;const notes=[...new Set(group.notes.map(note=>{while(note<48)note+=12;while(note>84)note-=12;return note}))].sort((a,b)=>a-b),found=detect(notes);if(!found)continue;const signature=`${found.root}:${found.quality}`;if(signature===previous)continue;previous=signature;progression.push(notes)}
  if(!progression.length)throw new Error("Je trouve des notes, mais pas de blocs d’au moins trois notes jouées ensemble");return{format,trackCount,division,events,progression};
}

async function importMidi(file){
  if(!file)return;const result=$("midiImportResult");result.hidden=false;result.textContent="Analyse du MIDI…";
  try{const parsed=readMidiFile(await file.arrayBuffer());state.progression=parsed.progression;state.timeline=[];state.selected=state.progression.length-1;state.notes=new Set(state.progression[state.selected]);state.importedFile=file.name;const needed=parsed.progression.length<=4?4:parsed.progression.length<=8?8:parsed.progression.length<=16?16:32;state.timelineMeasures=needed;save();renderAll();result.innerHTML=`<strong>${file.name}</strong> · ${parsed.trackCount} piste${parsed.trackCount>1?"s":""} · ${parsed.events.length} attaques · ${parsed.progression.length} accords reconnus`;toast("Progression MIDI analysée")}
  catch(error){result.innerHTML=`<strong>Impossible de l’analyser :</strong> ${error.message}`}
}

function closestVoicing(root,quality,reference){
  const refMean=reference.reduce((a,b)=>a+b,0)/reference.length;let best=null;
  for(let center=48;center<=72;center+=12){const notes=canonicalVoicing(root,quality,center),mean=notes.reduce((a,b)=>a+b,0)/notes.length,score=Math.abs(mean-refMean);if(!best||score<best.score)best={notes,score}}
  return best.notes;
}

function progressionVariants(){
  if(state.progression.length<2)return[];
  const enrichedMap={maj:"maj7",maj7:"maj9",min:"min7",min7:"min9",dom7:"dom9",dom9:"dom13",sus4:"dom7"};
  const enrich=state.progression.map(notes=>{const chord=detect(notes),quality=enrichedMap[chord.quality]||chord.quality;return closestVoicing(chord.root,quality,notes)});
  const tritone=state.progression.map(notes=>{const chord=detect(notes);return qualityFamily(chord.quality)==="dominant"?closestVoicing(pc(chord.root+6),"dom7",notes):[...notes]});
  const parallel=state.progression.map(notes=>{const chord=detect(notes),family=qualityFamily(chord.quality),quality=family==="major"?"min7":family==="minor"?"maj7":chord.quality;return closestVoicing(chord.root,quality,notes)});
  return [{title:"Version enrichie",description:"Ajoute 7e, 9e et 13e sans changer les fondamentales.",progression:enrich},{title:"Substitution tritonique",description:"Remplace les dominantes par leur miroir jazz à trois tons.",progression:tritone},{title:"Ombre parallèle",description:"Bascule majeur et mineur en gardant le dessin des basses.",progression:parallel}];
}

function renderProgressionIdeas(){
  const panel=$("progressionIdeasPanel"),wrap=$("progressionIdeas"),ideas=progressionVariants();panel.hidden=!ideas.length;wrap.innerHTML="";
  ideas.forEach(idea=>{const card=document.createElement("article");card.className="progression-idea";card.innerHTML=`<h3>${idea.title}</h3><p>${idea.description}</p><div class="mini-progression">${idea.progression.map(notes=>{const c=detect(notes);return `<span>${chordName(c.root,c.quality)}</span>`}).join("")}</div><div class="idea-actions"><button type="button">Écouter</button><button type="button">Utiliser</button></div>`;const buttons=card.querySelectorAll("button");buttons[0].onclick=()=>playProgression(idea.progression);buttons[1].onclick=()=>{state.progression=idea.progression.map(notes=>[...notes]);state.selected=state.progression.length-1;state.notes=new Set(state.progression[state.selected]);save();renderAll();toast(`${idea.title} appliquée`)};wrap.appendChild(card)});
}

function inferTonic(){
  if(!state.progression.length)return{root:0,minor:false};const chords=state.progression.map(detect).filter(Boolean);let best={root:chords[0]?.root||0,score:-Infinity};
  for(let root=0;root<12;root++){let score=0;chords.forEach((chord,i)=>{const weight=i===0||i===chords.length-1?1.4:1;if(chord.root===root&&qualityFamily(chord.quality)!=="dominant")score+=3*weight;if(chord.root===pc(root+7)&&qualityFamily(chord.quality)==="dominant")score+=2.5;if(chord.root===pc(root+2)&&qualityFamily(chord.quality)==="minor")score+=1.3;if(chord.root===pc(root+5))score+=.8});if(score>best.score)best={root,score}}
  const tonicChord=chords.find(chord=>chord.root===best.root&&qualityFamily(chord.quality)!=="dominant");return{root:best.root,minor:tonicChord?qualityFamily(tonicChord.quality)==="minor":false};
}

function cadenceDefinitions(){
  const tonic=inferTonic(),t=tonic.root,I=tonic.minor?"min7":"maj7";return[{label:"Cadence parfaite",description:"L’arrivée la plus nette : dominante puis tonique.",specs:[[pc(t+7),"dom7"],[t,I]]},{label:"Cadence jazz",description:"Le classique ii–V–I, souple et immédiatement lisible.",specs:[[pc(t+2),"min7"],[pc(t+7),"dom7"],[t,I]]},{label:"Cadence plagale",description:"Une arrivée plus ronde, du IV vers la tonique.",specs:[[pc(t+5),tonic.minor?"min7":"maj7"],[t,I]]},{label:"Turnaround",description:"Une boucle complète qui peut finir ou relancer la progression.",specs:[[pc(t+9),"min7"],[pc(t+2),"min7"],[pc(t+7),"dom7"],[t,I]]}];
}
function cadenceVoicings(specs){let reference=state.progression[state.progression.length-1]||[60,64,67];return specs.map(([root,quality])=>{const notes=closestVoicing(root,quality,reference);reference=notes;return notes})}
function renderCadences(){
  const tonic=inferTonic();$("tonicGuess").textContent=`Centre tonal estimé : ${NOTE_FR[tonic.root]} ${tonic.minor?"mineur":"majeur"}`;const wrap=$("cadences");wrap.innerHTML="";
  cadenceDefinitions().forEach(cadence=>{const voicings=cadenceVoicings(cadence.specs),card=document.createElement("article");card.className="cadence-card";card.innerHTML=`<small>Finalité</small><h3>${cadence.label}</h3><p>${cadence.description}</p><div class="cadence-path">${cadence.specs.map(([r,q])=>`<span>${chordName(r,q)}</span>`).join("")}</div><button type="button">Écouter puis ajouter</button>`;card.querySelector("button").onclick=()=>{playProgression(voicings);setTimeout(()=>{state.progression.push(...voicings.map(notes=>[...notes]));state.selected=state.progression.length-1;state.notes=new Set(state.progression[state.selected]);save();renderAll();toast(`${cadence.label} ajoutée`)},Math.max(850,voicings.length*620))};wrap.appendChild(card)});
}

function variableBytes(value){let buffer=value&127,out=[];while((value>>=7)){buffer<<=8;buffer|=(value&127)|128}for(;;){out.push(buffer&255);if(buffer&128)buffer>>=8;else break}return out}
function exportMidi(){
  if(!state.progression.length){toast("La progression est vide");return}normalizeTimeline();const bpm=Math.max(30,Math.min(260,Number($("timelineTempo").value)||100)),micros=Math.round(60000000/bpm),track=[0,255,81,3,(micros>>>16)&255,(micros>>>8)&255,micros&255,0,192,4],events=[];let lastTick=0;
  state.timeline.forEach((item,index)=>{const start=Math.round(item.start*1920),end=start+Math.max(60,Math.round(item.duration*1920)-60);state.progression[index].forEach(note=>{events.push({tick:start,on:true,note});events.push({tick:end,on:false,note})})});events.sort((a,b)=>a.tick-b.tick||(a.on===b.on?0:a.on?1:-1));events.forEach(event=>{track.push(...variableBytes(event.tick-lastTick),event.on?144:128,event.note,event.on?88:48);lastTick=event.tick});track.push(...variableBytes(Math.max(state.timelineMeasures*1920,lastTick)-lastTick),255,47,0);
  const chunk=(name,data)=>[...name].map(c=>c.charCodeAt(0)).concat([(data.length>>>24)&255,(data.length>>>16)&255,(data.length>>>8)&255,data.length&255],data);const header=[77,84,104,100,0,0,0,6,0,0,0,1,1,224],bytes=new Uint8Array(header.concat(chunk("MTrk",track))),url=URL.createObjectURL(new Blob([bytes],{type:"audio/midi"})),a=document.createElement("a");a.href=url;a.download=`progression-${Date.now()}.mid`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast("MIDI exporté");
}

function renderAll(){renderPiano();renderIdentity();renderProgression();renderTimeline();renderAnswers();renderProgressionIdeas();renderCadences()}

renderSelects();load();renderAll();
$("placeChordBtn").onclick=()=>{const root=Number($("rootSelect").value),quality=$("qualitySelect").value;state.notes=new Set(canonicalVoicing(root,quality));renderAll();playNotes([...state.notes])};
$("clearNotesBtn").onclick=()=>{state.notes.clear();renderAll()};
$("addCurrentBtn").onclick=()=>{const notes=[...state.notes].sort((a,b)=>a-b);if(notes.length<3)return;state.progression.push(notes);state.selected=state.progression.length-1;save();renderAll();toast("Accord ajouté")};
$("clearAllBtn").onclick=()=>{if(!confirm("Effacer toute la progression ?"))return;stopTimeline();state.progression=[];state.timeline=[];state.selected=null;state.notes.clear();save();renderAll()};
$("detectedName").onclick=()=>{if(state.notes.size>=3)playNotes([...state.notes])};
$("exportMidiBtn").onclick=exportMidi;
$("midiFileInput").onchange=(event)=>importMidi(event.target.files[0]);
const midiDrop=$("midiDropzone");["dragenter","dragover"].forEach(type=>midiDrop.addEventListener(type,event=>{event.preventDefault();midiDrop.classList.add("drag")}));["dragleave","drop"].forEach(type=>midiDrop.addEventListener(type,event=>{event.preventDefault();midiDrop.classList.remove("drag")}));midiDrop.addEventListener("drop",event=>importMidi([...event.dataTransfer.files].find(file=>/\.midi?$/i.test(file.name))));
const trash=$("chordTrash");trash.addEventListener("dragover",event=>{if(Array.from(event.dataTransfer.types).includes("text/chord-index")){event.preventDefault();trash.classList.add("drag")}});trash.addEventListener("dragleave",()=>trash.classList.remove("drag"));trash.addEventListener("drop",event=>{event.preventDefault();trash.classList.remove("drag");const value=event.dataTransfer.getData("text/chord-index");if(value!=="")removeChord(Number(value))});
document.querySelectorAll("[data-measures]").forEach(button=>button.onclick=()=>{state.timelineMeasures=Number(button.dataset.measures);normalizeTimeline();save();renderAll()});
$("chordDurationSelect").onchange=()=>{if(state.selected===null||!state.timeline[state.selected])return;state.timeline[state.selected].duration=Number($("chordDurationSelect").value);normalizeTimeline();save();renderAll()};
$("playTimelineBtn").onclick=playTimeline;$("stopTimelineBtn").onclick=stopTimeline;
const timelineCanvas=$("timelineCanvas");timelineCanvas.addEventListener("dragover",event=>event.preventDefault());timelineCanvas.addEventListener("drop",event=>{event.preventDefault();const own=event.dataTransfer.getData("text/timeline-index"),fromTop=event.dataTransfer.getData("text/chord-index"),value=own!==""?own:fromTop;if(value!=="")moveTimelineChord(Number(value),event.clientX)});
document.querySelectorAll(".direction-btn").forEach(btn=>btn.onclick=()=>{state.direction=btn.dataset.direction;document.querySelectorAll(".direction-btn").forEach(b=>b.classList.toggle("active",b===btn));renderAnswers()});
