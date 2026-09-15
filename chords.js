"use strict";

const NOTE_FR = ["Do","Réb","Ré","Mib","Mi","Fa","Solb","Sol","Lab","La","Sib","Si"];
const NOTE_INT = ["C","D♭","D","E♭","E","F","G♭","G","A♭","A","B♭","B"];
const NOTE_FL = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const ROLL_KEY_WIDTH = 88;
const QUALITY = {
  maj:{label:"Majeur",symbol:"",intervals:[0,4,7]}, min:{label:"Mineur",symbol:"m",intervals:[0,3,7]},
  maj7:{label:"Maj 7",symbol:"maj7",intervals:[0,4,7,11]}, min7:{label:"Mineur 7",symbol:"m7",intervals:[0,3,7,10]},
  dom7:{label:"Dominante 7",symbol:"7",intervals:[0,4,7,10]}, maj9:{label:"Maj 9",symbol:"maj9",intervals:[0,4,7,11,14]},
  min9:{label:"Mineur 9",symbol:"m9",intervals:[0,3,7,10,14]}, dom9:{label:"Dominante 9",symbol:"9",intervals:[0,4,7,10,14]},
  dom13:{label:"Dominante 13",symbol:"13",intervals:[0,4,7,10,14,21]}, min7b5:{label:"Demi-diminué",symbol:"m7♭5",intervals:[0,3,6,10]},
  dim7:{label:"Diminué 7",symbol:"dim7",intervals:[0,3,6,9]}, sus4:{label:"Sus 4",symbol:"sus4",intervals:[0,5,7]},
  maj6:{label:"Majeur 6",symbol:"6",intervals:[0,4,7,9]}, min6:{label:"Mineur 6",symbol:"m6",intervals:[0,3,7,9]},
  maj69:{label:"Majeur 6/9",symbol:"6/9",intervals:[0,2,4,7,9]},
};
const MOOD_FR = {Anguished:"Angoissé",Dark:"Sombre",Dramatic:"Dramatique",Empowered:"Puissant",Excited:"Excité",Fearful:"Craintif",Hopeful:"Plein d'espoir",Joyful:"Joyeux",Lonely:"Solitaire",Mysterious:"Mystérieux",Nostalgic:"Nostalgique",Peaceful:"Paisible",Playful:"Enjoué",Rebellious:"Rebelle",Relaxed:"Détendu",Romantic:"Romantique",Sad:"Triste",Spiritual:"Spirituel",Surprised:"Surpris",Tender:"Tendre",Triumphant:"Triomphant"};
const SCALE_FR = {M:"Majeur",m:"Mineur",O:"Modal"};
let moodLibrary = null, selectedMoods = new Set();
const STORAGE = "trumpetTrainerChordProgression";
const TIMELINE_STORAGE = "trumpetTrainerChordTimeline";
const state = {notes:new Set(),progression:[],selected:null,direction:"both",audio:null,importedFile:null,timeline:[],timelineMeasures:8,timelineTimers:[],timelineAnimation:null};
const $ = (id)=>document.getElementById(id);

function pc(n){return ((n%12)+12)%12}
function chordName(root,quality,international=false){return `${(international?NOTE_INT:NOTE_FR)[root]}${QUALITY[quality].symbol}`}
function midiLabel(midi){return `${NOTE_FR[pc(midi)]}${Math.floor(midi/12)-1}`}
function flMidiLabel(midi){return `${NOTE_FL[pc(midi)]}${Math.floor(midi/12)}`}
function displayChordName(found,notes,international=false){
  const base=chordName(found.root,found.quality,international),bass=pc(Math.min(...notes));
  const chordTones=new Set(QUALITY[found.quality].intervals.map(interval=>pc(found.root+interval)));
  return bass!==found.root&&chordTones.has(bass)?`${base}/${(international?NOTE_INT:NOTE_FR)[bass]}`:base;
}

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
  if(new URLSearchParams(location.search).get("preset")==="mood-jazz"){
    state.progression=[canonicalVoicing(5,"maj",58),canonicalVoicing(2,"sus4",58),canonicalVoicing(0,"dim7",58),canonicalVoicing(10,"maj7",58)];
    state.timeline=[{start:0,duration:0.25},{start:0.25,duration:0.75},{start:1,duration:0.25},{start:1.25,duration:0.75}];
    state.timelineMeasures=4;
    $("timelineTempo").value=120;
  }
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
  $("detectedName").textContent=displayChordName(found,notes);$("detectedInternational").textContent=`${displayChordName(found,notes,true)} · ${QUALITY[found.quality].label}`;
  $("detectedName").disabled=false;$("confidenceBar").style.width=`${found.confidence}%`;$("confidenceLabel").textContent=`${found.confidence}%`;$("addCurrentBtn").disabled=false;
  $("alternativeNames").textContent=found.alternatives.length?`Autres lectures : ${found.alternatives.map(a=>chordName(a.root,a.quality)).join(" · ")}`:"Lecture harmonique nette.";
}

function renderProgression(){
  const wrap=$("progression");wrap.innerHTML="";state.progression.forEach((notes,i)=>{const found=detect(notes),b=document.createElement("div");b.className=`chord-chip ${i===state.selected?"active":""}`;b.tabIndex=0;b.draggable=true;b.setAttribute("role","button");b.innerHTML=`<button type="button" class="delete-chord" aria-label="Supprimer cet accord">×</button><small>ACCORD ${String(i+1).padStart(2,"0")}</small><strong>${found?displayChordName(found,notes):"?"}</strong><span>${notes.length} notes</span>`;const select=()=>{state.selected=i;state.notes=new Set(notes);renderAll();playNotes(notes)};b.onclick=(event)=>{if(!event.target.closest(".delete-chord"))select()};b.onkeydown=(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();select()}};b.querySelector(".delete-chord").onclick=(event)=>{event.stopPropagation();removeChord(i)};b.ondragstart=(event)=>{event.dataTransfer.setData("text/chord-index",String(i));b.classList.add("dragging")};b.ondragend=()=>b.classList.remove("dragging");wrap.appendChild(b)});
  const add=document.createElement("button");add.className="chip-add";add.textContent="+ Accord";add.onclick=()=>{$("clearNotesBtn").click();$("rootSelect").focus()};wrap.appendChild(add);
}

function removeChord(index){
  if(index<0||index>=state.progression.length)return;state.progression.splice(index,1);state.timeline.splice(index,1);
  if(!state.progression.length){state.selected=null;state.notes.clear()}else{state.selected=Math.min(index,state.progression.length-1);state.notes=new Set(state.progression[state.selected])}
  save();renderAll();toast("Accord supprimé");
}

function renderTimeline(){
  normalizeTimeline();const canvas=$("timelineCanvas"),measureWidth=150,labelWidth=ROLL_KEY_WIDTH,rowHeight=20,top=46,low=45,high=84,totalWidth=labelWidth+state.timelineMeasures*measureWidth,totalHeight=top+(high-low+1)*rowHeight;
  canvas.innerHTML="";canvas.style.width=`${totalWidth}px`;canvas.style.height=`${totalHeight}px`;
  const header=document.createElement("div");header.className="timeline-header";header.style.width=`${totalWidth}px`;canvas.appendChild(header);
  const corner=document.createElement("div");corner.className="timeline-corner";corner.textContent="CHORDS";header.appendChild(corner);
  for(let measure=0;measure<state.timelineMeasures;measure++){const number=document.createElement("div");number.className="measure-number";number.style.left=`${labelWidth+measure*measureWidth}px`;number.style.width=`${measureWidth}px`;number.innerHTML=`<strong>${measure+1}</strong>4 / 4`;header.appendChild(number);for(let beat=0;beat<4;beat++){const line=document.createElement("i");line.className=beat===0?"measure-line":"beat-line";line.style.left=`${labelWidth+measure*measureWidth+beat*measureWidth/4}px`;canvas.appendChild(line)}}
  for(let midi=high;midi>=low;midi--){const rowIndex=high-midi,key=document.createElement("div"),row=document.createElement("div"),isBlack=[1,3,6,8,10].includes(pc(midi));key.className=`roll-key ${isBlack?"black":"white"}`;key.style.top=`${top+rowIndex*rowHeight}px`;key.style.height=`${rowHeight}px`;key.innerHTML=`<strong>${flMidiLabel(midi)}</strong><small>${midiLabel(midi)}</small>`;row.className=`roll-row ${isBlack?"black":""}`;row.style.top=key.style.top;row.style.width=`${state.timelineMeasures*measureWidth}px`;row.style.height=key.style.height;canvas.append(row,key)}
  state.timeline.forEach((item,index)=>{const notes=state.progression[index];if(!notes)return;const found=detect(notes),left=labelWidth+item.start*measureWidth,width=Math.max(18,Math.min(item.duration,state.timelineMeasures-item.start)*measureWidth-4),block=document.createElement("div");block.className=`chord-lane-block ${index===state.selected?"selected":""}`;block.style.left=`${left+2}px`;block.style.width=`${width}px`;block.draggable=true;block.title="Double-cliquer pour changer le voicing ou le style";block.setAttribute("aria-label",`${found?chordName(found.root,found.quality):"Accord"}, double-cliquer pour transformer`);block.innerHTML=`<strong>${found?chordName(found.root,found.quality):"Accord"}</strong><span>M.${Math.floor(item.start)+1} · ${item.duration<1?Math.round(item.duration*4)+" temps":item.duration+" mesure"+(item.duration>1?"s":"")}</span>`;block.onclick=()=>{state.selected=index;state.notes=new Set(notes);$("chordDurationSelect").value=String(item.duration);document.querySelectorAll(".chord-lane-block").forEach(itemBlock=>itemBlock.classList.toggle("selected",itemBlock===block));renderPiano();renderIdentity();renderProgression();renderVoicings();renderAnswers();renderTrends();renderProgressionIdeas();renderCadences();playNotes(notes)};block.ondblclick=event=>{event.preventDefault();event.stopPropagation();openChordTransform(index)};block.ondragstart=event=>{event.dataTransfer.setData("text/timeline-index",String(index));block.classList.add("dragging")};block.ondragend=()=>block.classList.remove("dragging");header.appendChild(block);
    notes.forEach(midi=>{if(midi<low||midi>high)return;const note=document.createElement("div");note.className="roll-note";note.style.left=`${left+3}px`;note.style.top=`${top+(high-midi)*rowHeight+1}px`;note.style.width=`${Math.max(12,width-3)}px`;canvas.appendChild(note)})});
  if(!state.progression.length){const empty=document.createElement("div");empty.className="empty-roll-message";empty.textContent="Ajoute ou importe des accords pour remplir la grille.";canvas.appendChild(empty)}
  document.querySelectorAll("[data-measures]").forEach(button=>button.classList.toggle("active",Number(button.dataset.measures)===state.timelineMeasures));
  if(state.selected!==null&&state.timeline[state.selected])$("chordDurationSelect").value=String(state.timeline[state.selected].duration);
}

function moveTimelineChord(index,clientX){
  const viewport=$("timelineViewport"),rect=$("timelineCanvas").getBoundingClientRect(),measureWidth=150,labelWidth=ROLL_KEY_WIDTH,x=clientX-rect.left+viewport.scrollLeft-labelWidth,start=Math.max(0,Math.min(state.timelineMeasures-1,Math.floor(x/measureWidth)));
  if(!state.timeline[index])return;state.timeline[index].start=start;if(start+state.timeline[index].duration>state.timelineMeasures)state.timeline[index].duration=Math.max(.25,state.timelineMeasures-start);state.selected=index;save();renderAll();toast(`Accord déplacé en mesure ${start+1}`);
}

function stopTimeline(){state.timelineTimers.forEach(clearTimeout);state.timelineTimers=[];if(state.timelineAnimation){state.timelineAnimation.cancel();state.timelineAnimation=null}const head=document.querySelector(".timeline-playhead");if(head)head.remove()}
function playTimeline(){
  stopTimeline();if(!state.progression.length)return;const bpm=Math.max(30,Math.min(260,Number($("timelineTempo").value)||100)),measureMs=240000/bpm,canvas=$("timelineCanvas"),head=document.createElement("div");head.className="timeline-playhead";head.style.left=`${ROLL_KEY_WIDTH}px`;canvas.appendChild(head);
  state.timeline.forEach((item,index)=>state.timelineTimers.push(setTimeout(()=>{state.selected=index;playNotes(state.progression[index],Math.min(1.4,item.duration*measureMs/1000*.85));renderProgression()},item.start*measureMs)));
  const end=Math.max(...state.timeline.map(item=>item.start+item.duration),1),distance=end*150;state.timelineAnimation=head.animate([{transform:"translateX(0)"},{transform:`translateX(${distance}px)`}],{duration:end*measureMs,easing:"linear",fill:"forwards"});state.timelineAnimation.onfinish=()=>{state.timelineAnimation=null;state.timelineTimers=[]};
}

function qualityFamily(q){return q.startsWith("min")?"minor":q.startsWith("dom")||q==="dom7"?"dominant":"major"}
function targetIdeas(source){
  const r=source.root,fam=qualityFamily(source.quality),tonicQuality=fam==="minor"?"min7":"maj7";
  const functional=fam==="dominant"?{offset:5,q:"maj7",role:"Résolution montante naturelle",why:"Les voix communes restent stables et les autres montent d’un ou deux demi-tons vers une arrivée lumineuse."}:fam==="minor"?{offset:5,q:"dom7",role:"Mouvement ii → V",why:"Le mineur prépare une dominante située une quarte plus haut."}:{offset:7,q:"dom7",role:"Appel vers la dominante",why:"Une dominante crée un nouvel élan avant le retour."};
  return [functional,{offset:5,q:tonicQuality,role:"Ouverture au IV",why:"Une réponse large et chantante sur le quatrième degré."},{offset:3,q:fam==="minor"?"maj7":"min7",role:"Couleur relative",why:"Des notes communes changent la lumière sans casser la phrase."},{offset:1,q:"dim7",role:"Approche chromatique",why:"Un accord diminué de passage crée une tension courte."},{offset:-2,q:"min7",role:"Recul modal",why:"Un pas descendant garde une conduite de voix très souple."},{offset:-1,q:"dom7",role:"Résolution par glissement",why:"Toutes les voix peuvent descendre d’un demi-ton avec impact."}];
}
function directedVoicing(root,quality,direction,sourceNotes){
  const source=[...sourceNotes].sort((a,b)=>a-b),intervals=[...new Set(QUALITY[quality].intervals.map(interval=>pc(interval)))].sort((a,b)=>a-b),candidates=[];
  for(let inversion=0;inversion<intervals.length;inversion++){
    const rotated=intervals.slice(inversion).concat(intervals.slice(0,inversion).map(interval=>interval+12));
    for(let anchor=36;anchor<=72;anchor+=12){
      let rootMidi=anchor;while(pc(rootMidi)!==root)rootMidi++;
      const notes=rotated.map(interval=>rootMidi+interval);
      if(Math.min(...notes)<45||Math.max(...notes)>84)continue;
      const compared=Math.min(notes.length,source.length),deltas=[];for(let i=0;i<compared;i++)deltas.push(notes[i]-source[i]);
      const wrongWay=deltas.reduce((sum,delta)=>sum+(direction==="up"?Math.max(0,-delta):Math.max(0,delta)),0);
      const average=deltas.reduce((sum,delta)=>sum+delta,0)/Math.max(1,deltas.length),rangePenalty=Math.abs(notes.length-source.length)*3;
      const directionPenalty=direction==="up"?(average<.5?(1-average)*16:0):(average>-.5?(1+average)*16:0);
      const score=deltas.reduce((sum,delta)=>sum+Math.abs(delta),0)+wrongWay*24+directionPenalty+rangePenalty;
      candidates.push({notes,score});
    }
  }
  candidates.sort((a,b)=>a.score-b.score);return candidates[0]?.notes||canonicalVoicing(root,quality,60);
}

function meanPitch(notes){return notes.reduce((sum,note)=>sum+note,0)/Math.max(1,notes.length)}
function movementCost(from,to){const a=[...from].sort((x,y)=>x-y),b=[...to].sort((x,y)=>x-y),count=Math.min(a.length,b.length);let cost=Math.abs(a.length-b.length)*4;for(let i=0;i<count;i++)cost+=Math.abs(a[i]-b[i]);return cost}
function responseDirection(from,to){return meanPitch(to)>=meanPitch(from)?"up":"down"}
function openMajorLift(root,sourceNotes){
  const triad=directedVoicing(root,"maj","up",sourceNotes);let top=root;while(top<=Math.max(...triad))top+=12;if(top<=84)return[...triad,top].sort((a,b)=>a-b);return triad;
}
function subtleNinth(sourceNotes,source){
  const notes=[...sourceNotes].sort((a,b)=>a-b);let ninth=source.root+2;while(ninth<=Math.max(...notes))ninth+=12;if(ninth>84)ninth-=12;if(!notes.includes(ninth))notes.push(ninth);return notes.sort((a,b)=>a-b);
}
function tonalResponseIdeas(sourceNotes,source){
  const tonic=inferTonic(),specs=tonic.minor?[[0,"min7","i"],[3,"maj7","♭III"],[5,"min7","iv"],[7,"dom7","V"],[8,"maj7","♭VI"],[10,"dom7","♭VII"]]:[[0,"maj7","I"],[2,"min7","ii"],[5,"maj7","IV"],[7,"dom7","V"],[9,"min7","vi"]];
  return specs.map(([offset,quality,degree])=>{const root=pc(tonic.root+offset),up=directedVoicing(root,quality,"up",sourceNotes),down=directedVoicing(root,quality,"down",sourceNotes),notes=movementCost(sourceNotes,up)<=movementCost(sourceNotes,down)?up:down;return{root,quality,notes,direction:responseDirection(sourceNotes,notes),role:`Dans la tonalité · ${degree}`,why:`Une réponse du centre tonal estimé en ${NOTE_FR[tonic.root]} ${tonic.minor?"mineur":"majeur"}, choisie avec le déplacement de voix le plus court.`}}).filter(item=>!(item.root===source.root&&qualityFamily(item.quality)===qualityFamily(source.quality))).sort((a,b)=>movementCost(sourceNotes,a.notes)-movementCost(sourceNotes,b.notes)).slice(0,4);
}
function inversionResponseIdeas(sourceNotes,source){
  return buildVoicingIdeas(sourceNotes,source).filter(idea=>idea.notes.join(",")!==[...sourceNotes].sort((a,b)=>a-b).join(",")).sort((a,b)=>movementCost(sourceNotes,a.notes)-movementCost(sourceNotes,b.notes)).slice(0,2).map(idea=>({root:source.root,quality:source.quality,notes:idea.notes,direction:responseDirection(sourceNotes,idea.notes),role:`Même accord · ${idea.label}`,why:`Aucune harmonie ne change : seule la disposition des voix crée une nouvelle respiration. ${idea.description}`}));
}
function progressionBridgeIdeas(sourceNotes){
  if(state.selected===null||state.selected<1||!state.progression[0])return[];const firstNotes=state.progression[0],first=detect(firstNotes);if(!first)return[];
  const specs=[{root:pc(first.root+7),quality:"dom7",role:"Pont vers l’accord 01",why:"Répond à l’accord actuel tout en préparant une résolution dominante vers le premier accord."},{root:pc(first.root+1),quality:"dom7",role:"Boucle tritonique vers l’accord 01",why:"Une dominante située un demi-ton au-dessus du premier accord crée un retour jazz très serré."},{root:pc(first.root-1),quality:"dim7",role:"Approche diminuée vers l’accord 01",why:"Le diminué relie la fin au début par demi-ton et transforme la progression en boucle fluide."}];
  return specs.map(spec=>{const up=directedVoicing(spec.root,spec.quality,"up",sourceNotes),down=directedVoicing(spec.root,spec.quality,"down",sourceNotes),score=notes=>movementCost(sourceNotes,notes)+movementCost(notes,firstNotes)*.85,chosen=score(up)<=score(down)?up:down;return{...spec,notes:chosen,direction:responseDirection(sourceNotes,chosen),previewTail:firstNotes,loopName:displayChordName(first,firstNotes),contextScore:score(chosen)}}).sort((a,b)=>a.contextScore-b.contextScore);
}
function suggestions(){
  if(state.selected===null||!state.progression[state.selected])return[];const sourceNotes=state.progression[state.selected],source=detect(sourceNotes);if(!source)return[];
  const items=[];
  if(qualityFamily(source.quality)==="dominant"){
    const liftedRoot=pc(source.root+1),majorNotes=openMajorLift(liftedRoot,sourceNotes),planedNotes=sourceNotes.map(note=>note+1);
    items.push({direction:"up",role:"Ouverture lumineuse",why:"La réponse que tu as dessinée : trois voix montent d’un demi-ton et la fondamentale est doublée en haut pour ouvrir l’accord.",root:liftedRoot,quality:"maj",notes:majorNotes});
    items.push({direction:"up",role:"Même forme · un demi-ton plus haut",why:"Tout l’accord dominant glisse d’un seul demi-ton : la couleur reste la même et la remontée reste parfaitement lisible.",root:liftedRoot,quality:source.quality,notes:planedNotes});
    const ninthNotes=subtleNinth(sourceNotes,source);items.push({direction:"up",role:"Même accord · couleur 9",why:"Toutes les notes restent en place ; seule la neuvième s’ajoute au-dessus pour une montée presque imperceptible.",root:source.root,quality:"dom9",notes:ninthNotes});
    const diminishedRoot=pc(source.root+1),diminishedNotes=directedVoicing(diminishedRoot,"dim7","up",sourceNotes),arrivalRoot=pc(source.root+2),arrivalNotes=directedVoicing(arrivalRoot,"min7","up",diminishedNotes);
    items.unshift({direction:"up",role:"Montée chromatique jazz",why:"Le diminué sert de pont, pas de destination : la basse monte d’un demi-ton puis se détend dans le mineur suivant.",root:arrivalRoot,quality:"min7",notes:arrivalNotes,sequence:[{root:diminishedRoot,quality:"dim7",notes:diminishedNotes},{root:arrivalRoot,quality:"min7",notes:arrivalNotes}]});
  }
  items.push(...progressionBridgeIdeas(sourceNotes),...tonalResponseIdeas(sourceNotes,source),...inversionResponseIdeas(sourceNotes,source));
  items.push(...targetIdeas(source).map((idea,i)=>{const direction=i<4?"up":"down",root=pc(source.root+idea.offset),notes=directedVoicing(root,idea.q,direction,sourceNotes);return{...idea,root,quality:idea.q,direction,notes}}));
  const seen=new Set();return items.filter(item=>{const signature=item.sequence?item.sequence.map(step=>`${step.root}:${step.quality}:${step.notes.join(".")}`).join("|"):`${item.root}:${item.quality}:${item.notes.join(".")}`;if(seen.has(signature))return false;seen.add(signature);return true});
}

// This site is static (no backend to proxy through), so the free-tier key is
// called directly from the browser - visible client-side, accepted tradeoff.
const HOOKTHEORY_ACTIVKEY="cfd1b00c230215ffa09efd8deb78eaeb";
const HOOKTHEORY_TRENDS_URL="https://api.hooktheory.com/v1/trends/nodes";
const trendsCache=new Map();

// Semitone offset from the progression's inferred tonic -> Hooktheory scale-
// degree node id. Only plain diatonic degrees + common borrowed (flat) ones -
// anything else falls back to "1" (treat as tonic).
const DEGREE_ID_BY_OFFSET={0:"1",2:"2",3:"b3",4:"3",5:"4",7:"5",8:"b6",9:"6",10:"b7",11:"7"};

// Roman numeral (as returned in chord_HTML) -> offset from tonic + chord
// quality, using the standard diatonic 7th-chord qualities of a major scale
// (I/IV: maj7, ii/iii/vi: min7, V: dom7). Only the clean, unambiguous cases
// are handled; anything else (inversions, secondary dominants, vii°) is
// skipped rather than guessed at.
const ROMAN_DEGREES={
  I:{offset:0,triad:"maj",seventh:"maj7"}, ii:{offset:2,triad:"min",seventh:"min7"},
  iii:{offset:4,triad:"min",seventh:"min7"}, IV:{offset:5,triad:"maj",seventh:"maj7"},
  V:{offset:7,triad:"maj",seventh:"dom7"}, vi:{offset:9,triad:"min",seventh:"min7"},
};
const BORROWED_DEGREES={"♭III":3,"♭VI":8,"♭VII":10};

function parseTrendChordHTML(html){
  const clean=html.replace(/&#9837;/g,"♭").replace(/&deg;/g,"°");
  const borrowedMatch=Object.keys(BORROWED_DEGREES).find(k=>clean===k);
  if(borrowedMatch)return{offset:BORROWED_DEGREES[borrowedMatch],quality:"maj"};
  const numeralOnly=clean.replace(/<sup>7<\/sup>$/,"");
  const degree=ROMAN_DEGREES[numeralOnly];
  if(!degree)return null;
  const hasSeventh=/<sup>7<\/sup>$/.test(clean);
  return{offset:degree.offset,quality:hasSeventh?degree.seventh:degree.triad};
}

async function fetchTrendSuggestions(){
  if(state.selected===null||!state.progression[state.selected])return[];
  const sourceNotes=state.progression[state.selected],source=detect(sourceNotes);
  if(!source)return[];
  const tonic=inferTonic();
  const through=state.progression.slice(0,state.selected+1).map(detect).filter(Boolean);
  const childPath=through.map(chord=>DEGREE_ID_BY_OFFSET[pc(chord.root-tonic.root)]||"1").slice(-5).join(",")||"1";

  if(trendsCache.has(childPath))return applyTrendResults(trendsCache.get(childPath),tonic.root,sourceNotes);
  try{
    const response=await fetch(`${HOOKTHEORY_TRENDS_URL}?cp=${encodeURIComponent(childPath)}`,{headers:{Authorization:`Bearer ${HOOKTHEORY_ACTIVKEY}`}});
    if(!response.ok)return[];
    const data=await response.json();
    trendsCache.set(childPath,data);
    return applyTrendResults(data,tonic.root,sourceNotes);
  }catch(_e){return[]}
}

function applyTrendResults(data,tonicRoot,sourceNotes){
  const results=[];
  for(const node of data){
    const parsed=parseTrendChordHTML(node.chord_HTML);
    if(!parsed)continue;
    const root=pc(tonicRoot+parsed.offset);
    const notes=directedVoicing(root,parsed.quality,"up",sourceNotes);
    results.push({root,quality:parsed.quality,probability:node.probability,notes});
    if(results.length>=4)break;
  }
  return results;
}

function renderTrends(){
  const wrap=$("trends");if(!wrap)return;
  if(state.selected===null){$("trendsSummary").textContent="Sélectionne un accord pour voir les statistiques réelles.";wrap.innerHTML="";return}
  $("trendsSummary").textContent="Chargement des tendances Hooktheory...";
  fetchTrendSuggestions().then(items=>{
    if(!items.length){$("trendsSummary").textContent="Pas de données claires pour cet accord.";wrap.innerHTML="";return}
    $("trendsSummary").innerHTML=`À partir de ta progression actuelle, <a href="https://www.hooktheory.com/trends" target="_blank" rel="noopener">Hooktheory Trends</a> observe le plus souvent ces suites :`;
    wrap.innerHTML="";
    items.forEach(item=>{
      const card=document.createElement("article");card.className="answer-card trend-card";
      card.innerHTML=`<div class="answer-top"><span>${Math.round(item.probability*100)}% des cas</span></div><h3>${chordName(item.root,item.quality)}</h3><div class="voice-line">${item.notes.map(n=>`<span>${midiLabel(n)}</span>`).join("")}</div><div class="answer-actions"><button class="listen-btn">Écouter la suite</button><button class="add-answer-btn">+ Ajouter</button></div>`;
      card.querySelector(".listen-btn").onclick=()=>playSequence(state.progression[state.selected],item.notes);
      card.querySelector(".add-answer-btn").onclick=()=>{state.progression.push(item.notes);state.selected=state.progression.length-1;state.notes=new Set(item.notes);save();renderAll();toast(`${chordName(item.root,item.quality)} ajouté à la progression`)};
      wrap.appendChild(card);
    });
  });
}
function renderAnswers(){
  const wrap=$("answers"),items=suggestions().filter(x=>state.direction==="both"||x.direction===state.direction);wrap.innerHTML="";
  if(state.selected===null){$("sourceSummary").textContent="Sélectionne un accord de la progression pour lancer le calcul.";return}
  const source=detect(state.progression[state.selected]);$("sourceSummary").innerHTML=`Après <strong>${chordName(source.root,source.quality)}</strong> : réponses dans la tonalité, glissements subtils et renversements du même accord. Écoute la couleur avant de l’ajouter.`;
  items.forEach(item=>{const card=document.createElement("article"),sequence=item.sequence||[{root:item.root,quality:item.quality,notes:item.notes}],title=sequence.map(step=>chordName(step.root,step.quality)).join(" → "),notesMarkup=item.sequence?sequence.map(step=>`<span>${chordName(step.root,step.quality)}</span>`).join(""):item.notes.map(note=>`<span>${midiLabel(note)}</span>`).join(""),voiceMarkup=item.previewTail?`${notesMarkup}<span>↻ ${item.loopName}</span>`:notesMarkup;card.className=`answer-card ${item.direction} ${item.previewTail?"context-card":""}`;card.innerHTML=`<div class="answer-top"><span>${item.direction==="up"?"↗ réponse montante":"↘ réponse descendante"}</span><span>${item.role}</span></div><h3>${title}</h3><p>${item.why}</p><div class="voice-line">${voiceMarkup}</div><div class="answer-actions"><button class="listen-btn">${item.previewTail?"Écouter la boucle":"Écouter la suite"}</button><button class="add-answer-btn">+ Ajouter</button></div>`;
    card.querySelector(".listen-btn").onclick=()=>playProgression([state.progression[state.selected],...sequence.map(step=>step.notes),...(item.previewTail?[item.previewTail]:[])]);card.querySelector(".add-answer-btn").onclick=()=>{state.progression.push(...sequence.map(step=>[...step.notes]));state.selected=state.progression.length-1;state.notes=new Set(state.progression[state.selected]);save();renderAll();toast(`${title} ajouté à la progression`)};wrap.appendChild(card)});
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

function centerVoicing(notes,reference){
  const target=reference.length?reference.reduce((sum,note)=>sum+note,0)/reference.length:60;
  let voiced=[...notes].sort((a,b)=>a-b),mean=voiced.reduce((sum,note)=>sum+note,0)/voiced.length;
  while(mean<target-6){voiced=voiced.map(note=>note+12);mean+=12}
  while(mean>target+6){voiced=voiced.map(note=>note-12);mean-=12}
  while(Math.min(...voiced)<45)voiced=voiced.map(note=>note+12);
  while(Math.max(...voiced)>84)voiced=voiced.map(note=>note-12);
  return voiced;
}

function buildVoicingIdeas(sourceNotes,found){
  const pitchIntervals=[...new Set(QUALITY[found.quality].intervals.map(interval=>pc(interval)))].sort((a,b)=>a-b);
  let rootMidi=60;while(pc(rootMidi)!==found.root)rootMidi++;
  const rootPosition=pitchIntervals.map(interval=>rootMidi+interval),ideas=[];
  const labels=["Position fondamentale","1er renversement","2e renversement","3e renversement","4e renversement","5e renversement"];
  for(let inversion=0;inversion<rootPosition.length;inversion++){
    const rotated=rootPosition.slice(inversion).concat(rootPosition.slice(0,inversion).map(note=>note+12));
    const notes=centerVoicing(rotated,sourceNotes),bass=NOTE_FR[pc(notes[0])];
    ideas.push({label:labels[inversion]||`${inversion}e renversement`,notes,description:inversion?`${bass} passe à la basse pour relier les accords avec moins de sauts.`:"La fondamentale reste à la basse : lecture stable et directe."});
  }
  if(rootPosition.length>=4){
    const close=centerVoicing(rootPosition,sourceNotes),drop=[...close],index=drop.length-2;drop[index]-=12;drop.sort((a,b)=>a-b);
    ideas.push({label:"Drop 2",notes:centerVoicing(drop,sourceNotes),description:"La deuxième voix la plus haute descend d’une octave : un voicing plus ouvert, très utilisé en jazz."});
  }
  const seen=new Set();return ideas.filter(idea=>{const signature=idea.notes.join(",");if(seen.has(signature))return false;seen.add(signature);return true});
}

function renderVoicings(){
  const wrap=$("voicings");if(!wrap)return;const sourceNotes=[...state.notes].sort((a,b)=>a-b),found=detect(sourceNotes);wrap.innerHTML="";
  if(!found||sourceNotes.length<3){wrap.innerHTML='<div class="voicing-empty"><strong>Pose ou joue un accord.</strong><span>Ses renversements apparaîtront ici, prêts à écouter et à ajouter.</span></div>';return}
  buildVoicingIdeas(sourceNotes,found).forEach(idea=>{
    const card=document.createElement("article");card.className="voicing-card";
    card.innerHTML=`<div class="voicing-top"><span>${idea.label}</span><strong>${displayChordName(found,idea.notes)}</strong></div><div class="voicing-notes">${idea.notes.map(note=>`<span>${midiLabel(note)}</span>`).join("")}</div><p>${idea.description}</p><div class="voicing-actions"><button type="button" class="listen-btn">Écouter</button><button type="button" class="add-answer-btn">+ Ajouter</button></div>`;
    card.querySelector(".listen-btn").onclick=()=>playNotes(idea.notes);
    card.querySelector(".add-answer-btn").onclick=()=>{state.progression.push([...idea.notes]);state.selected=state.progression.length-1;state.notes=new Set(idea.notes);save();renderAll();toast(`${idea.label} ajouté`)};
    wrap.appendChild(card);
  });
}

function closestVoicing(root,quality,reference){
  const refMean=reference.reduce((a,b)=>a+b,0)/reference.length;let best=null;
  for(let center=48;center<=72;center+=12){const notes=canonicalVoicing(root,quality,center),mean=notes.reduce((a,b)=>a+b,0)/notes.length,score=Math.abs(mean-refMean);if(!best||score<best.score)best={notes,score}}
  return best.notes;
}

function styleTransformIdeas(sourceNotes,found){
  const family=qualityFamily(found.quality);
  const specs=[
    {style:"Jazz",quality:family==="dominant"?"dom13":family==="minor"?"min9":"maj9",description:"Les extensions donnent plus de profondeur sans déplacer la fondamentale."},
    {style:"Bossa nova",quality:family==="dominant"?"dom9":family==="minor"?"min6":"maj69",description:"Une couleur douce en 6e ou 6/9, ronde et très naturelle sur un accompagnement bossa."},
    {style:"Blues",quality:family==="minor"?"min7":"dom7",description:"La septième apporte la petite tension expressive typique du blues."},
    {style:"Classique",quality:family==="minor"?"min":"maj",description:"Une triade nette et équilibrée, sans extension : la couleur la plus pure."}
  ];
  const seen=new Set();
  return specs.map(spec=>({...spec,root:found.root,notes:closestVoicing(found.root,spec.quality,sourceNotes)})).filter(idea=>{const signature=idea.notes.join(",");if(seen.has(signature))return false;seen.add(signature);return true});
}

function replaceProgressionChord(index,notes,message){
  if(index<0||index>=state.progression.length)return;
  state.progression[index]=[...notes].sort((a,b)=>a-b);state.selected=index;state.notes=new Set(state.progression[index]);save();renderAll();
  const dialog=$("chordTransformDialog");if(dialog.open)dialog.close();toast(message);
}

function transformCard({eyebrow,title,notes,description,index}){
  const card=document.createElement("article");card.className="transform-card";
  card.innerHTML=`<span class="transform-card-kicker">${eyebrow}</span><h3>${title}</h3><div class="transform-card-notes">${notes.map(note=>`<span>${midiLabel(note)} <small>${flMidiLabel(note)}</small></span>`).join("")}</div><p>${description}</p><div class="transform-card-actions"><button type="button" class="transform-listen">Écouter</button><button type="button" class="transform-apply">Appliquer</button></div>`;
  card.querySelector(".transform-listen").onclick=()=>playNotes(notes);
  card.querySelector(".transform-apply").onclick=()=>replaceProgressionChord(index,notes,`${title} appliqué à l’accord ${index+1}`);
  return card;
}

function openChordTransform(index){
  const sourceNotes=state.progression[index];if(!sourceNotes)return;const found=detect(sourceNotes);if(!found)return;
  state.selected=index;state.notes=new Set(sourceNotes);renderAll();
  $("transformTitle").textContent=`${displayChordName(found,sourceNotes)} — choisir une variation`;
  $("transformIntro").textContent=`Seul l’accord ${String(index+1).padStart(2,"0")} sera modifié. Sa place et sa durée restent exactement les mêmes.`;
  const voicings=$("transformVoicings"),styles=$("transformStyles");voicings.innerHTML="";styles.innerHTML="";
  const sourceSignature=[...sourceNotes].sort((a,b)=>a-b).join(",");
  const alternatives=buildVoicingIdeas(sourceNotes,found).filter(idea=>idea.notes.join(",")!==sourceSignature);
  alternatives.forEach(idea=>voicings.appendChild(transformCard({eyebrow:"Voicing",title:displayChordName(found,idea.notes),notes:idea.notes,description:`${idea.label}. ${idea.description}`,index})));
  if(!alternatives.length)voicings.innerHTML='<p class="transform-empty">Ce voicing est déjà la position la plus simple.</p>';
  styleTransformIdeas(sourceNotes,found).forEach(idea=>styles.appendChild(transformCard({eyebrow:idea.style,title:chordName(idea.root,idea.quality),notes:idea.notes,description:idea.description,index})));
  $("chordTransformDialog").showModal();
}

// One step of "add color": plain triads/7ths gain their 9th (or 13th for a
// dominant 7), already-extended chords are left alone - so clicking twice
// doesn't keep stacking indefinitely. Root and quality family (major/minor/
// dominant) are preserved, only the extension changes.
const JAZZIFY_MAP={maj:"maj9",min:"min9",dom7:"dom13",maj7:"maj9",min7:"min9"};
function jazzifyProgression(){
  if(!state.progression.length)return;
  let reference=state.progression[0],changed=0;
  state.progression=state.progression.map(notes=>{
    const source=detect(notes);
    if(!source||!JAZZIFY_MAP[source.quality]){reference=notes;return notes}
    changed++;
    const jazzed=closestVoicing(source.root,JAZZIFY_MAP[source.quality],reference);
    reference=jazzed;
    return jazzed;
  });
  if(state.selected!==null)state.notes=new Set(state.progression[state.selected]);
  save();renderAll();
  toast(changed?`${changed} accord${changed>1?"s":""} jazzifié${changed>1?"s":""}`:"Rien à jazzifier ici");
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

function renderMoodChips(){
  const wrap=$("moodChips");if(!wrap||!moodLibrary)return;wrap.innerHTML="";
  moodLibrary.moods.forEach((mood,index)=>{
    const btn=document.createElement("button");btn.type="button";btn.className="mood-chip"+(selectedMoods.has(index)?" active":"");
    btn.textContent=MOOD_FR[mood]||mood;
    btn.onclick=()=>{if(selectedMoods.has(index))selectedMoods.delete(index);else selectedMoods.add(index);renderMoodChips();renderMoodResults()};
    wrap.appendChild(btn);
  });
}
let transitionTable=null;
function buildTransitionTable(){
  if(transitionTable||!moodLibrary)return;
  transitionTable={};
  moodLibrary.items.forEach(item=>{
    const chords=item.c;
    for(let i=0;i<chords.length-1;i++){
      const from=detect(chords[i]),to=detect(chords[i+1]);
      if(!from||!to)continue;
      const offset=pc(to.root-from.root),toKey=`${offset}|${to.quality}`;
      transitionTable[from.quality]=transitionTable[from.quality]||{};
      transitionTable[from.quality][toKey]=(transitionTable[from.quality][toKey]||0)+1;
    }
  });
}
function localLibrarySuggestions(){
  if(state.selected===null||!state.progression[state.selected])return[];
  const sourceNotes=state.progression[state.selected],source=detect(sourceNotes);
  if(!source)return[];
  buildTransitionTable();
  const table=transitionTable&&transitionTable[source.quality];if(!table)return[];
  const total=Object.values(table).reduce((sum,count)=>sum+count,0);
  return Object.entries(table).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([key,count])=>{
    const[offsetStr,quality]=key.split("|"),offset=Number(offsetStr),root=pc(source.root+offset);
    return{root,quality,probability:count/total,notes:directedVoicing(root,quality,"up",sourceNotes)};
  });
}
function renderLibrarySuggestions(){
  const wrap=$("library");if(!wrap)return;
  if(state.selected===null){$("librarySummary").textContent="Sélectionne un accord pour voir ce que suggère la bibliothèque locale.";wrap.innerHTML="";return}
  const items=localLibrarySuggestions();
  if(!items.length){$("librarySummary").textContent=moodLibrary?"Pas assez de données locales pour cet accord.":"Chargement de la bibliothèque locale…";wrap.innerHTML="";return}
  $("librarySummary").innerHTML=`D'après ${moodLibrary.items.length} progressions réelles (licence MIT, <a href="https://github.com/ldrolez/free-midi-chords" target="_blank" rel="noopener">free-midi-chords</a>), voici ce qui suit le plus souvent :`;
  wrap.innerHTML="";
  items.forEach(item=>{
    const card=document.createElement("article");card.className="answer-card library-card";
    card.innerHTML=`<div class="answer-top"><span>${Math.round(item.probability*100)}% des cas</span></div><h3>${chordName(item.root,item.quality)}</h3><div class="voice-line">${item.notes.map(note=>`<span>${midiLabel(note)}</span>`).join("")}</div><div class="answer-actions"><button class="listen-btn">Écouter la suite</button><button class="add-answer-btn">+ Ajouter</button></div>`;
    card.querySelector(".listen-btn").onclick=()=>playSequence(state.progression[state.selected],item.notes);
    card.querySelector(".add-answer-btn").onclick=()=>{state.progression.push(item.notes);state.selected=state.progression.length-1;state.notes=new Set(item.notes);save();renderAll();toast(`${chordName(item.root,item.quality)} ajouté à la progression`)};
    wrap.appendChild(card);
  });
}
function loadMoodProgression(item){
  state.progression=item.c.map(notes=>[...notes]);
  state.timeline=[];state.selected=0;state.notes=new Set(state.progression[0]);
  normalizeTimeline();save();renderAll();
  toast(`Progression chargée : ${item.k} ${item.r}`);
}
function renderMoodResults(){
  const wrap=$("moodResults");if(!wrap)return;
  if(!moodLibrary){wrap.innerHTML="";return}
  let items=moodLibrary.items;
  if(selectedMoods.size)items=items.filter(item=>item.m.some(m=>selectedMoods.has(m)));
  const seen=new Set(),unique=[];
  for(const item of items){
    const key=item.s+"|"+item.r;if(seen.has(key))continue;seen.add(key);unique.push(item);
    if(unique.length>=24)break;
  }
  wrap.innerHTML="";
  if(!unique.length){wrap.innerHTML='<p class="mood-empty">Aucune progression pour cette combinaison d’ambiances.</p>';return}
  unique.forEach(item=>{
    const card=document.createElement("article");card.className="mood-card";
    const tags=item.m.map(m=>MOOD_FR[moodLibrary.moods[m]]||moodLibrary.moods[m]).join(", ");
    card.innerHTML=`<div class="mood-card-top"><strong>${item.k}</strong><span>${SCALE_FR[item.s]}</span></div><div class="mood-card-roman">${item.r}</div><div class="mood-card-tags">${item.m.map(m=>`<span>${MOOD_FR[moodLibrary.moods[m]]||moodLibrary.moods[m]}</span>`).join("")}</div><div class="voicing-actions"><button type="button" class="listen-btn">Écouter</button><button type="button" class="mood-load-btn">Charger</button></div>`;
    card.querySelector(".listen-btn").onclick=()=>playProgression(item.c);
    card.querySelector(".mood-load-btn").onclick=()=>loadMoodProgression(item);
    wrap.appendChild(card);
  });
}
function renderAll(){renderPiano();renderIdentity();renderProgression();renderTimeline();renderVoicings();renderAnswers();renderTrends();renderLibrarySuggestions();renderProgressionIdeas();renderCadences()}

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
const timelineViewport=$("timelineViewport");timelineViewport.addEventListener("scroll",()=>timelineCanvas.style.setProperty("--roll-scroll-x",`${timelineViewport.scrollLeft}px`),{passive:true});
document.querySelectorAll(".direction-btn").forEach(btn=>btn.onclick=()=>{state.direction=btn.dataset.direction;document.querySelectorAll(".direction-btn").forEach(b=>b.classList.toggle("active",b===btn));renderAnswers()});
$("jazzifyBtn").onclick=jazzifyProgression;
fetch("chord-moods.json").then(response=>response.json()).then(data=>{moodLibrary=data;renderMoodChips();renderMoodResults();renderLibrarySuggestions()}).catch(()=>{});
