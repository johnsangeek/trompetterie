"use strict";

const $ = (selector) => document.querySelector(selector);
const els = {
  canvas: $("#highway"), play: $("#playButton"), restart: $("#restartButton"),
  bpm: $("#bpmInput"), bpmOut: $("#bpmOutput"), metro: $("#metronomeToggle"), loop: $("#loopToggle"),
  title: $("#songTitle"), current: $("#currentNote"), next: $("#nextNote"), register: $("#registerLabel"),
  fingering: $("#fingeringText"), playState: $("#playState"), measure: $("#barCounter"),
  currentTime: $("#currentTime"), totalTime: $("#totalTime"), progress: $("#progress"),
  progressFill: $("#progressFill"), progressThumb: $("#progressThumb"), import: $("#importButton"),
  midiInput: $("#midiInput"), concert: $("#concertMidiToggle"), overlay: $("#dropOverlay"), toast: $("#toast"),
  shell: $(".highway-shell"), scoreCanvas: $("#scoreCanvas"), mixerWrap: $("#mixerWrap"),
  mixerButton: $("#mixerButton"), mixerPanel: $("#mixerPanel"), mixerClose: $("#mixerClose"), mixerTracks: $("#mixerTracks"),
};
const ctx2d = els.canvas.getContext("2d");
const scoreCtx = els.scoreCanvas.getContext("2d");
const NOTE_FR = ["Do", "Do♯", "Ré", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "La♭", "La", "Si♭", "Si"];
const COLORS = {1:"#ff655d",2:"#4fd0c1",3:"#f1be43"};

let audioCtx = null;
let playing = false;
let transportStart = 0;
let pausedBeat = 0;
let scheduler = null;
let scheduledThrough = -1;
let scheduledSet = new Set();
let scheduledMetro = -1;
let activeNodes = [];
let transposeImported = true;
let importedSong = false;
let currentViewMode = "hero";
const COUNT_IN_SECONDS = 5;

const demoMelody = [
  [0,64,1],[1,67,.75],[2,69,.75],[3,67,1],[4,64,1],[5,62,1],[6,60,1],[7,62,1],
  [8,64,.5],[8.5,67,.5],[9,69,1],[10,71,1],[11,69,1],[12,67,1],[13,64,1],[14,62,1],[15,60,1],
  [16,64,1],[17,67,1],[18,72,1],[19,71,1],[20,69,1],[21,67,1],[22,64,1],[23,62,1],
  [24,60,.75],[25,64,.75],[26,67,.75],[27,69,.75],[28,67,1],[29,64,1],[30,62,1],[31,60,1]
].map(([beat,note,duration])=>({beat,note,duration,track:1,channel:0,velocity:.88,isGuide:true}));
const chordRoots=[48,53,45,55,48,53,55,48];
const demoStem={instrument:"Piano",muted:false,volume:.55};
const demoBacking=chordRoots.flatMap((root,bar)=>[0,4,7].map(interval=>({beat:bar*4,note:root+interval,duration:3.55,track:2,channel:1,velocity:.22,stem:demoStem})));
const demoSong={melody:demoMelody,all:[...demoMelody,...demoBacking].sort((a,b)=>a.beat-b.beat),stems:[demoStem],endBeat:32,ppq:480,sourceBpm:92};
let song=demoSong;
const SCALE_INTERVALS={blues:[0,3,5,6,7,10,12],major:[0,2,4,5,7,9,11,12],minor:[0,2,3,5,7,8,10,12],pentatonic:[0,2,4,7,9,12],minorPentatonic:[0,3,5,7,10,12]};
const SCALE_LABELS={blues:"Blues",major:"Majeure",minor:"Mineure naturelle",pentatonic:"Pentatonique majeure",minorPentatonic:"Pentatonique mineure",allOctaves:"Toutes les octaves"};

function displayMidi(note){ return note + (importedSong && transposeImported ? 2 : 0); }
function noteName(note){ const midi=displayMidi(note); return `${NOTE_FR[(midi%12+12)%12]}${Math.floor(midi/12)-1}`; }
function fingering(note){ return window.TrumpetFingerings.primary(displayMidi(note)); }
function noteOctave(note){ return Math.floor(displayMidi(note)/12)-1; }
function registerName(note){
  const octave=noteOctave(note);
  if(octave<=3)return "octave 3 · air souple";
  if(octave===4)return "octave 4 · air stable";
  if(octave===5)return "octave 5 · air soutenu";
  if(octave===6)return "octave 6 · forte compression";
  return `octave ${octave} · pression extrême`;
}
function registerColor(note){
  const octave=noteOctave(note);
  if(octave<=3)return {top:"#1683cc",bottom:"#064d87",glow:"rgba(9,100,172,.55)"};
  if(octave===4)return {top:"#69d8f7",bottom:"#27a9d7",glow:"rgba(74,201,240,.62)"};
  if(octave===5)return {top:"#fff087",bottom:"#efc724",glow:"rgba(255,224,75,.68)"};
  if(octave===6)return {top:"#ffb45f",bottom:"#ed653b",glow:"rgba(255,119,58,.72)"};
  return {top:"#fff4ff",bottom:"#df75f0",glow:"rgba(235,132,255,.82)"};
}
function formatTime(seconds){ seconds=Math.max(0,Math.round(seconds)); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`; }
function bpm(){ return Number(els.bpm.value); }
function secondsPerBeat(){ return 60/bpm(); }
function totalSeconds(){ return song.endBeat*secondsPerBeat(); }
function loopOn(){ return els.loop.checked; }
function windowed(list,now,back,ahead){
  if(!loopOn()||!(song.endBeat>0))return list.filter(n=>n.beat>=now-back&&n.beat<=now+ahead);
  const period=song.endBeat,c0=Math.max(0,Math.floor((now-back)/period)),c1=Math.floor((now+ahead)/period),out=[];
  for(let c=c0;c<=c1;c++)for(const n of list){const b=n.beat+c*period;if(b>=now-back&&b<=now+ahead)out.push({...n,beat:b})}
  return out;
}
function activeAt(list,now){
  if(!loopOn()||!(song.endBeat>0))return list.find(n=>n.beat<=now+.055&&n.beat+n.duration>now);
  const period=song.endBeat,c=Math.floor(now/period);
  for(let dc=0;dc>=-1;dc--){const cc=c+dc;if(cc<0)continue;for(const n of list){const b=n.beat+cc*period;if(b<=now+.055&&b+n.duration>now)return{...n,beat:b}}}
  return null;
}

function resizeCanvas(){
  const rect=els.canvas.getBoundingClientRect(),scoreRect=els.scoreCanvas.getBoundingClientRect(); const dpr=Math.min(devicePixelRatio||1,2);
  els.canvas.width=Math.round(rect.width*dpr); els.canvas.height=Math.round(rect.height*dpr);
  ctx2d.setTransform(dpr,0,0,dpr,0,0); draw();
  els.scoreCanvas.width=Math.round(scoreRect.width*dpr);els.scoreCanvas.height=Math.round(scoreRect.height*dpr);scoreCtx.setTransform(dpr,0,0,dpr,0,0);drawScore(currentBeat());
}

function currentBeat(){ return playing ? (audioCtx.currentTime-transportStart)/secondsPerBeat() : pausedBeat; }

function draw(){
  const w=els.canvas.clientWidth,h=els.canvas.clientHeight; ctx2d.clearRect(0,0,w,h);
  const beat=currentBeat(), hitY=h*.68, topY=12, travel=hitY-topY, ahead=7;
  const laneLeft=w*.14,laneWidth=w*.72,laneStep=laneWidth/3;
  const visible=windowed(song.melody,beat,.45,ahead+.5);
  for(const n of visible){
    const y=hitY-((n.beat-beat)/ahead)*travel;
    const barH=Math.min(124,Math.max(20,n.duration*43));
    const active=n.beat<=beat+.06&&n.beat+n.duration>beat;
    const fingers=fingering(n.note);
    const color=registerColor(n.note);
    const fadeIn=Math.max(0,Math.min(1,(y-topY)/82));
    const fadeOut=y<=hitY?1:Math.max(0,1-(y-hitY)/52);
    ctx2d.save();ctx2d.globalAlpha=Math.min(fadeIn,fadeOut);
    ctx2d.shadowColor=active?color.glow:"transparent";ctx2d.shadowBlur=active?26:0;
    if(fingers.length===0){
      const x=laneLeft+4,width=laneWidth-8,openGrad=ctx2d.createLinearGradient(x,0,x+width,0);
      openGrad.addColorStop(0,color.bottom);openGrad.addColorStop(.18,color.top);openGrad.addColorStop(.5,color.top);openGrad.addColorStop(.82,color.top);openGrad.addColorStop(1,color.bottom);ctx2d.fillStyle=openGrad;
      roundedRect(ctx2d,x,y-barH,width,barH,3);ctx2d.fill();
      paintBarDetail(ctx2d,x,y-barH,width,barH);
    }else{
      const grad=ctx2d.createLinearGradient(0,y-barH,0,y);grad.addColorStop(0,color.top);grad.addColorStop(1,color.bottom);ctx2d.fillStyle=grad;
      const width=Math.min(38,laneStep*.34);
      fingers.forEach(val=>{const center=laneLeft+(val-.5)*laneStep,x=center-width/2;roundedRect(ctx2d,x,y-barH,width,barH,3);ctx2d.fill();paintBarDetail(ctx2d,x,y-barH,width,barH);});
    }
    ctx2d.restore();
  }
  drawScore(beat);
  if(playing) requestAnimationFrame(draw);
}
function roundedRect(c,x,y,w,h,r){c.beginPath();c.roundRect?c.roundRect(x,y,w,h,r):(c.rect(x,y,w,h));}
function paintBarDetail(c,x,y,w,h){
  c.shadowBlur=0;c.save();roundedRect(c,x+.5,y+.5,w-1,h-1,3);c.clip();
  const soft=c.createLinearGradient(x,y,x+w,y);soft.addColorStop(0,"rgba(0,0,0,.13)");soft.addColorStop(.24,"rgba(255,255,255,.08)");soft.addColorStop(.72,"rgba(255,255,255,.04)");soft.addColorStop(1,"rgba(0,0,0,.12)");c.fillStyle=soft;c.fillRect(x,y,w,h);
  c.fillStyle="rgba(255,255,255,.18)";c.fillRect(x+2,y+1,w-4,1);c.restore();
}
function drawScore(beat){
  const w=els.scoreCanvas.clientWidth,h=els.scoreCanvas.clientHeight,top=5,bottom=h-6,playX=w*.5,lineGap=9;
  const staffTop=Math.max(28,(h-lineGap*4)/2-4),staffBottom=staffTop+4*lineGap;
  scoreCtx.clearRect(0,0,w,h);
  const staffInk=scoreCtx.createLinearGradient(0,0,w,0);staffInk.addColorStop(0,"rgba(44,48,45,0)");staffInk.addColorStop(.08,"rgba(44,48,45,.72)");staffInk.addColorStop(.92,"rgba(44,48,45,.72)");staffInk.addColorStop(1,"rgba(44,48,45,0)");
  scoreCtx.strokeStyle=staffInk;scoreCtx.lineWidth=1;
  for(let i=0;i<5;i++){const y=staffTop+i*lineGap;scoreCtx.beginPath();scoreCtx.moveTo(0,y);scoreCtx.lineTo(w,y);scoreCtx.stroke();}
  scoreCtx.save();scoreCtx.strokeStyle="#e1a31d";scoreCtx.lineWidth=3;scoreCtx.shadowColor="#e7ae29";scoreCtx.shadowBlur=13;scoreCtx.beginPath();scoreCtx.moveTo(playX,top);scoreCtx.lineTo(playX,bottom);scoreCtx.stroke();scoreCtx.restore();
  const beatSpacing=Math.max(40,Math.min(76,w/16));
  const scoreNotes=windowed(song.melody,beat,5.8,10);
  let previousOctaveShift=0;
  for(const n of scoreNotes){
    const x=playX+(n.beat-beat)*beatSpacing,midi=displayMidi(n.note),fitted=fitPitchToCompactStaff(midi),rawY=staffTop+lineGap*3.9-(fitted.midi-60)*2.4,y=Math.max(top+10,Math.min(h-25,rawY));
    const edgeFade=Math.max(0,Math.min(1,(x-4)/90,(w-4-x)/90));if(edgeFade<=0)continue;scoreCtx.save();scoreCtx.globalAlpha=edgeFade;
    scoreCtx.strokeStyle=staffInk;scoreCtx.lineWidth=1;drawLedgerLines(x,y,staffTop,staffBottom,lineGap);
    scoreCtx.save();scoreCtx.translate(x,y);scoreCtx.rotate(-.22);scoreCtx.scale(1.45,.9);scoreCtx.beginPath();scoreCtx.arc(0,0,5.2,0,Math.PI*2);scoreCtx.fillStyle=n.beat<=beat+.04&&n.beat+n.duration>beat?"#d99a13":"#252a25";scoreCtx.shadowColor=n.beat<=beat+.04&&n.beat+n.duration>beat?"#e7ae29":"transparent";scoreCtx.shadowBlur=12;scoreCtx.fill();scoreCtx.restore();
    scoreCtx.strokeStyle="#252a25";scoreCtx.lineWidth=1.4;scoreCtx.beginPath();scoreCtx.moveTo(x+5,y);scoreCtx.lineTo(x+5,y-24);scoreCtx.stroke();
    if(fitted.octaves&&fitted.octaves!==previousOctaveShift){scoreCtx.fillStyle="#9a6b12";scoreCtx.font="800 8px Segoe UI";scoreCtx.textAlign="left";scoreCtx.fillText(octaveMark(fitted.octaves),x+9,y+4)}
    scoreCtx.fillStyle="rgba(37,42,37,.86)";scoreCtx.font="700 10px Segoe UI";scoreCtx.textAlign="center";scoreCtx.fillText(noteName(n.note),x,bottom-1);
    const badgeStemTop=Math.max(top+18,y-24);drawFingeringBadges(x+5,badgeStemTop,fingering(n.note));
    scoreCtx.restore();
    previousOctaveShift=fitted.octaves;
  }
}
function fitPitchToCompactStaff(midi){
  let fitted=midi,octaves=0;
  while(fitted>74){fitted-=12;octaves++}
  while(fitted<55){fitted+=12;octaves--}
  return{midi:fitted,octaves};
}
function octaveMark(octaves){
  const amount=Math.abs(octaves),label=amount===1?"8":amount===2?"15":amount===3?"22":`${amount*7+1}`;
  return `${label}${octaves>0?"va":"vb"}`;
}
function drawLedgerLines(x,y,staffTop,staffBottom,lineGap){
  const half=9;
  if(y<staffTop-lineGap/2){
    for(let ly=staffTop-lineGap;ly>=y-lineGap/2;ly-=lineGap){scoreCtx.beginPath();scoreCtx.moveTo(x-half,ly);scoreCtx.lineTo(x+half,ly);scoreCtx.stroke();}
  }else if(y>staffBottom+lineGap/2){
    for(let ly=staffBottom+lineGap;ly<=y+lineGap/2;ly+=lineGap){scoreCtx.beginPath();scoreCtx.moveTo(x-half,ly);scoreCtx.lineTo(x+half,ly);scoreCtx.stroke();}
  }
}
function drawFingeringBadges(x,stemTopY,fingers){
  const values=fingers.length?fingers:[0],r=6.5,gap=2,fy=stemTopY-r-4;
  let cx=x-((values.length*(r*2)+(values.length-1)*gap)/2)+r;
  values.forEach(v=>{
    scoreCtx.beginPath();scoreCtx.arc(cx,fy,r,0,Math.PI*2);
    scoreCtx.fillStyle=v===0?"#9aa1b2":COLORS[v];scoreCtx.fill();
    scoreCtx.fillStyle="#fff";scoreCtx.font="800 8px Segoe UI";scoreCtx.textAlign="center";scoreCtx.textBaseline="middle";
    scoreCtx.fillText(String(v),cx,fy+.5);
    cx+=r*2+gap;
  });
  scoreCtx.textBaseline="alphabetic";
}

function ensureAudio(){ if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==="suspended")audioCtx.resume(); }
function remember(node){ activeNodes.push(node); node.addEventListener?.("ended",()=>{activeNodes=activeNodes.filter(n=>n!==node)}); }
function stopNodes(){ activeNodes.forEach(n=>{try{n.stop()}catch{}});activeNodes=[]; }

function synthNote(event,when,duration,isMelody){
  const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
  osc.type=isMelody?"triangle":event.note<52?"sine":"triangle";
  osc.frequency.value=440*Math.pow(2,(event.note-69)/12);
  const stemVolume=event.stem?.volume??1;
  const volume=(isMelody?.09:Math.min(.035,event.velocity*.05))*stemVolume,gate=Math.min(Math.max(duration*.78,.07),.86);
  gain.gain.setValueAtTime(.0001,when);gain.gain.exponentialRampToValueAtTime(volume,when+.018);
  gain.gain.setValueAtTime(volume,Math.max(when+.02,when+gate-.055));gain.gain.exponentialRampToValueAtTime(.0001,when+gate);
  osc.connect(gain).connect(audioCtx.destination);osc.start(when);osc.stop(when+gate+.02);remember(osc);
}
function click(when,accent){
  const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type="square";osc.frequency.value=accent?1320:920;
  gain.gain.setValueAtTime(.045,when);gain.gain.exponentialRampToValueAtTime(.0001,when+.045);osc.connect(gain).connect(audioCtx.destination);osc.start(when);osc.stop(when+.05);remember(osc);
}

function scheduleAudio(){
  if(!playing)return; const now=audioCtx.currentTime, beatNow=currentBeat(), horizon=beatNow+.3/secondsPerBeat();
  if(loopOn()&&song.endBeat>0){
    const period=song.endBeat,cLo=Math.max(0,Math.floor((horizon-.7)/period)),cHi=Math.floor(horizon/period);
    for(let c=cLo;c<=cHi;c++){
      song.all.forEach((n,index)=>{
        const key=`${c}:${index}`;if(scheduledSet.has(key))return;
        const shifted=n.beat+c*period;
        if(shifted<horizon-.7)return;
        if(shifted<=horizon){const when=transportStart+shifted*secondsPerBeat();if(when>=now-.03&&!n.stem?.muted)synthNote(n,Math.max(now,when),n.duration*secondsPerBeat(),Boolean(n.isGuide));scheduledSet.add(key);}
      });
    }
  }else{
    song.all.forEach((n,index)=>{
      if(index<=scheduledThrough||n.beat<horizon-.7)return;
      if(n.beat<=horizon){const when=transportStart+n.beat*secondsPerBeat();if(when>=now-.03&&!n.stem?.muted)synthNote(n,Math.max(now,when),n.duration*secondsPerBeat(),Boolean(n.isGuide));scheduledThrough=index;}
    });
  }
  if(els.metro.checked){
    let tick=Math.max(scheduledMetro+1,Math.ceil(beatNow-.001));
    while(tick<=horizon){click(transportStart+tick*secondsPerBeat(),tick%4===0);scheduledMetro=tick;tick++;}
  }
  updateUI(beatNow);
  if(!loopOn()&&beatNow>=song.endBeat) pause(true);
}

function play(withCountIn=pausedBeat===0){
  ensureAudio();if(pausedBeat>=song.endBeat)pausedBeat=0;if(withCountIn&&pausedBeat===0)pausedBeat=-COUNT_IN_SECONDS/secondsPerBeat();transportStart=audioCtx.currentTime-pausedBeat*secondsPerBeat();
  scheduledThrough=song.all.findLastIndex?.(n=>n.beat<pausedBeat-.02)??-1;scheduledSet=new Set();scheduledMetro=Math.floor(pausedBeat)-1;
  playing=true;els.play.classList.add("playing");els.playState.textContent=pausedBeat<0?`DÉPART ${COUNT_IN_SECONDS}`:"EN LECTURE";scheduler=setInterval(scheduleAudio,25);scheduleAudio();draw();
}
function pause(finished=false){
  if(!audioCtx)return;pausedBeat=finished?song.endBeat:currentBeat();playing=false;clearInterval(scheduler);stopNodes();els.play.classList.remove("playing");els.playState.textContent=finished?"TERMINÉ":"EN PAUSE";updateUI(pausedBeat);draw();
}
function restart(autoPlay=false){
  if(playing)pause();pausedBeat=0;scheduledThrough=-1;scheduledMetro=-1;updateUI(0);draw();if(autoPlay)setTimeout(()=>play(false),130);
}

function updateUI(beat){
  const period=song.endBeat,displayBeat=loopOn()&&period>0?beat-Math.floor(Math.max(0,beat)/period)*period:beat;
  const progress=Math.min(1,Math.max(0,displayBeat/period));els.progressFill.style.width=`${progress*100}%`;els.progressThumb.style.left=`${progress*100}%`;els.progress.setAttribute("aria-valuenow",String(Math.round(progress*100)));
  els.currentTime.textContent=formatTime(displayBeat*secondsPerBeat());els.totalTime.textContent=formatTime(totalSeconds());els.measure.textContent=`MESURE ${Math.floor(Math.max(0,displayBeat)/4)+1}`;
  if(beat<0){const count=Math.max(1,Math.ceil(-beat*secondsPerBeat()));els.playState.textContent=`DÉPART ${count}`;els.current.textContent="—";els.register.textContent=`La musique commence dans ${count} s`;els.shell.dataset.energy="off";els.shell.dataset.open="false";setValves([]);return}
  if(playing)els.playState.textContent="EN LECTURE";
  const active=(!playing&&beat<=.0001)?null:activeAt(song.melody,beat);
  let next=song.melody.find(n=>n.beat>beat+.055);
  if(!next&&loopOn()&&song.melody.length)next=song.melody[0];
  els.next.textContent=next?noteName(next.note):"Fin";
  if(!active){els.current.textContent="—";els.register.textContent=playing?"Écoute le tempo":"Prépare-toi";els.shell.dataset.energy="off";els.shell.dataset.open="false";setValves([]);return;}
  els.current.textContent=noteName(active.note);els.register.textContent=registerName(active.note);
  const activeFingering=fingering(active.note),octave=noteOctave(active.note);els.shell.dataset.energy=octave>=7?"extreme":octave===6?"very-high":octave===5?"high":octave<=3?"low":"mid";els.shell.dataset.open=String(activeFingering.length===0);setValves(activeFingering);
}
function setValves(values){
  document.querySelectorAll(".valve").forEach(v=>v.classList.toggle("active",values.includes(Number(v.dataset.valve))));
  document.querySelectorAll(".piston-targets span").forEach(v=>v.classList.toggle("active",values.includes(Number(v.dataset.target))));
  els.fingering.textContent=values.length?`Pistons ${values.join(" + ")}`:"Pistons libres";
  window.dispatchEvent(new CustomEvent("hero:performance-state",{detail:{mode:currentViewMode,valves:values,note:els.current.textContent}}));
}

function readVLQ(view,state){let value=0,b;do{b=view.getUint8(state.i++);value=(value<<7)|(b&127);}while(b&128);return value;}
function parseMidi(buffer){
  const view=new DataView(buffer),state={i:0};
  const text=n=>{let s="";while(n--)s+=String.fromCharCode(view.getUint8(state.i++));return s};
  if(text(4)!=="MThd")throw new Error("Ce fichier n’est pas un MIDI standard.");
  const headerLength=view.getUint32(state.i);state.i+=4;const format=view.getUint16(state.i),tracks=view.getUint16(state.i+2),division=view.getUint16(state.i+4);state.i+=headerLength;
  if(division&0x8000)throw new Error("Le format temporel SMPTE n’est pas encore pris en charge.");
  const notes=[],trackInfo=[];let tempo=500000;
  for(let tr=0;tr<tracks;tr++){
    if(text(4)!=="MTrk")throw new Error("Piste MIDI illisible.");const end=state.i+4+view.getUint32(state.i);state.i+=4;let tick=0,running=0,name=`Piste ${tr+1}`,trackNotes=[];const open=new Map();
    while(state.i<end){tick+=readVLQ(view,state);let status=view.getUint8(state.i++);if(status<128){state.i--;status=running}else if(status<0xf0)running=status;
      if(status===0xff){const type=view.getUint8(state.i++),len=readVLQ(view,state);if(type===0x51&&len===3)tempo=(view.getUint8(state.i)<<16)|(view.getUint8(state.i+1)<<8)|view.getUint8(state.i+2);if(type===0x03)name=text(len);else state.i+=len;continue}
      if(status===0xf0||status===0xf7){const len=readVLQ(view,state);state.i+=len;continue}
      const kind=status&0xf0,ch=status&15,d1=view.getUint8(state.i++),d2=(kind===0xc0||kind===0xd0)?0:view.getUint8(state.i++),key=`${ch}:${d1}`;
      if(kind===0x90&&d2>0){(open.get(key)||open.set(key,[]).get(key)).push({tick,note:d1,velocity:d2/127,channel:ch})}
      else if(kind===0x80||(kind===0x90&&d2===0)){const stack=open.get(key);if(stack?.length){const start=stack.shift();trackNotes.push({beat:start.tick/division,note:start.note,duration:Math.max(.08,(tick-start.tick)/division),velocity:start.velocity,channel:start.channel,track:tr})}}
    }
    notes.push(...trackNotes);trackInfo.push({index:tr,name,notes:trackNotes});state.i=end;
  }
  const candidates=trackInfo.filter(t=>t.notes.length>2&&t.notes.some(n=>n.channel!==9));
  if(!candidates.length)throw new Error("Aucune ligne mélodique détectée dans ce MIDI.");
  candidates.sort((a,b)=>scoreTrack(b)-scoreTrack(a));const melody=candidates[0].notes.filter(n=>n.channel!==9).sort((a,b)=>a.beat-b.beat);melody.forEach(n=>n.isGuide=true);
  notes.sort((a,b)=>a.beat-b.beat);return{melody,all:notes,stems:[],endBeat:Math.max(...notes.map(n=>n.beat+n.duration)),ppq:division,sourceBpm:Math.round(60000000/tempo),trackName:candidates[0].name,format};
}
function scoreTrack(t){const avg=t.notes.reduce((s,n)=>s+n.note,0)/t.notes.length;return avg+t.notes.length*.035-t.notes.filter(n=>n.duration>8).length*4;}

async function importMidi(file){
  try{const parsed=parseMidi(await file.arrayBuffer());if(playing)pause();song=parsed;importedSong=true;pausedBeat=0;els.title.textContent=file.name.replace(/\.midi?$/i,"");els.bpm.value=Math.min(200,Math.max(30,parsed.sourceBpm));els.bpmOut.textContent=els.bpm.value;renderMixer();toast(`Mélodie détectée : ${parsed.trackName} • ${parsed.melody.length} notes`);updateUI(0);draw();}
  catch(error){toast(error.message||"Impossible de lire ce MIDI.",true)}
}
let toastTimer;function toast(message,error=false){clearTimeout(toastTimer);els.toast.textContent=message;els.toast.style.background=error?"#9d312c":"#171a17";els.toast.classList.add("show");toastTimer=setTimeout(()=>els.toast.classList.remove("show"),3500)}

function renderMixer(){
  const stems=song.stems||[];els.mixerWrap.hidden=!stems.length;els.mixerTracks.innerHTML="";
  stems.forEach(stem=>{
    const row=document.createElement("label");row.className=`mixer-track${stem.muted?" muted":""}`;
    const toggle=document.createElement("input");toggle.type="checkbox";toggle.checked=!stem.muted;toggle.setAttribute("aria-label",`Activer ${stem.instrument}`);
    toggle.addEventListener("change",()=>{stem.muted=!toggle.checked;row.classList.toggle("muted",stem.muted)});
    const name=document.createElement("span");name.textContent=stem.instrument;
    const volume=document.createElement("input");volume.type="range";volume.min="0";volume.max="100";volume.value=String(Math.round(stem.volume*100));volume.setAttribute("aria-label",`Volume ${stem.instrument}`);
    volume.addEventListener("input",()=>{stem.volume=Number(volume.value)/100});row.append(toggle,name,volume);els.mixerTracks.appendChild(row);
  });
}

function catalogEntryToSong(entry){
  const sourceBpm=Math.max(20,Number(entry.bpm)||120),beatsPerSecond=sourceBpm/60;
  const leadStem=(entry.stems||[]).find(stem=>stem.isLead)||null;
  const leadSource=leadStem?.notes?.length?leadStem.notes:(entry.notes||[]);
  const melody=leadSource.map((note,index)=>{
    const next=leadSource[index+1];const fallback=next?Math.max(.08,Math.min(.9,next.time-note.time)):.6;
    return{beat:note.time*beatsPerSecond,note:note.midi,duration:Math.max(.08,(note.duration||fallback)*beatsPerSecond),velocity:.88,isGuide:true};
  }).sort((a,b)=>a.beat-b.beat);
  const stems=(entry.stems||[]).filter(stem=>stem!==leadStem&&!stem.isLead).map(stem=>({instrument:stem.instrument||"Accompagnement",muted:false,volume:.58}));
  const backing=[];stems.forEach((stem,index)=>{
    const source=(entry.stems||[]).filter(item=>item!==leadStem&&!item.isLead)[index];
    (source.notes||[]).forEach(note=>backing.push({beat:note.time*beatsPerSecond,note:note.midi,duration:Math.max(.05,(note.duration||.2)*beatsPerSecond),velocity:.55,stem}));
  });
  const all=[...melody,...backing].sort((a,b)=>a.beat-b.beat);
  const endBeat=Math.max(Number(entry.duration||0)*beatsPerSecond,...all.map(note=>note.beat+note.duration),1);
  return{melody,all,stems,endBeat,ppq:480,sourceBpm};
}

async function loadCatalogTrack(id,autoPlay=false){
  try{
    if(playing)pause();els.playState.textContent="CHARGEMENT";
    const response=await fetch(`tracks/${encodeURIComponent(id)}.json`);if(!response.ok)throw new Error("Morceau introuvable");
    const entry=await response.json(),loaded=catalogEntryToSong(entry);if(!loaded.melody.length)throw new Error("Aucune piste trompette exploitable");
    song=loaded;importedSong=true;pausedBeat=0;scheduledThrough=-1;scheduledMetro=-1;els.title.textContent=entry.name||id;
    els.bpm.value=Math.min(200,Math.max(30,loaded.sourceBpm));els.bpmOut.textContent=els.bpm.value;renderMixer();updateUI(0);resizeCanvas();
    toast(`${loaded.melody.length} notes de trompette · ${loaded.stems.length} pistes d’accompagnement`);if(autoPlay)play(true);return true;
  }catch(error){els.playState.textContent="PRÊT";toast(error.message||"Impossible de charger ce morceau.",true);return false}
}

function loadScaleExercise(root,scaleKey,octave="auto"){
  if(playing)pause();
  let base,melody,startOctave=null;
  if(scaleKey==="allOctaves"){
    const notes=[];for(let midi=54;midi<=90;midi++)if(midi%12===root)notes.push(midi);
    const sequence=[...notes,...notes.slice(0,-1).reverse()];
    base=notes[0];melody=sequence.map((note,beat)=>({beat,note,duration:.82,track:1,channel:0,velocity:.88}));
  }else{
    startOctave=octave==="auto"?(root>=7?3:4):Number(octave);base=12*(startOctave+1)+root;
    const up=SCALE_INTERVALS[scaleKey]||SCALE_INTERVALS.blues,sequence=[...up,...up.slice(0,-1).reverse()];
    melody=sequence.map((interval,beat)=>({beat,note:base+interval,duration:.82,track:1,channel:0,velocity:.88}));
  }
  const tonic=[0,4,7].map(interval=>({beat:0,note:base-12+interval,duration:melody.length-.15,track:2,channel:1,velocity:.2}));
  melody.forEach(note=>note.isGuide=true);const scaleStem={instrument:"Accord de référence",muted:false,volume:.45};tonic.forEach(note=>note.stem=scaleStem);
  song={melody,all:[...melody,...tonic].sort((a,b)=>a.beat-b.beat),stems:[scaleStem],endBeat:melody.length,ppq:480,sourceBpm:bpm()};importedSong=false;pausedBeat=0;scheduledThrough=-1;scheduledMetro=-1;
  els.title.textContent=scaleKey==="allOctaves"?`${NOTE_FR[root]} trompette · toutes les octaves`:`Gamme ${SCALE_LABELS[scaleKey]} · ${NOTE_FR[root]}${startOctave} trompette`;
  renderMixer();updateUI(0);resizeCanvas();
}
function setLearningMode(mode){
  currentViewMode=mode;document.body.dataset.viewMode=mode;const suffix=document.querySelector(".brand i");if(suffix)suffix.textContent=mode==="partition"?"Partition":mode==="instrument"?"Instrument":"Hero";
  $("#heroInstrument")?.setAttribute("aria-hidden",String(mode!=="instrument"));window.dispatchEvent(new CustomEvent("hero:view-mode",{detail:{mode}}));setTimeout(resizeCanvas,40);return true;
}
window.addEventListener("trompetterie:play",async event=>{
  const choice=event.detail;if(!setLearningMode(choice.mode))return;
  ensureAudio();if(choice.source==="scale"){loadScaleExercise(choice.root,choice.scale,choice.octave);play(true);}
  else if(choice.music==="demo"){if(playing)pause();song=demoSong;importedSong=false;pausedBeat=0;els.title.textContent="Premiers pas — démo originale";renderMixer();restart(false);play(true);}
  else await loadCatalogTrack(choice.music,true);
});

els.play.addEventListener("click",()=>playing?pause():play());els.restart.addEventListener("click",()=>restart(false));
els.bpm.addEventListener("input",()=>{const was=playing,beat=currentBeat();if(was)pause();pausedBeat=beat;els.bpmOut.textContent=els.bpm.value;updateUI(beat);if(was)play()});
els.import.addEventListener("click",()=>els.midiInput.click());els.midiInput.addEventListener("change",()=>els.midiInput.files[0]&&importMidi(els.midiInput.files[0]));
els.mixerButton.addEventListener("click",()=>{const open=els.mixerPanel.hidden;els.mixerPanel.hidden=!open;els.mixerButton.setAttribute("aria-expanded",String(open))});
els.mixerClose.addEventListener("click",()=>{els.mixerPanel.hidden=true;els.mixerButton.setAttribute("aria-expanded","false")});
els.concert.addEventListener("change",()=>{transposeImported=els.concert.checked;updateUI(currentBeat());draw()});
els.progress.addEventListener("click",e=>{const rect=els.progress.getBoundingClientRect(),was=playing;if(was)pause();pausedBeat=Math.max(0,Math.min(song.endBeat,(e.clientX-rect.left)/rect.width*song.endBeat));updateUI(pausedBeat);draw();if(was)play()});
$("#fullscreenBtn").addEventListener("click",()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());
for(const event of ["dragenter","dragover"]){window.addEventListener(event,e=>{e.preventDefault();els.overlay.hidden=false})}window.addEventListener("dragleave",e=>{if(!e.relatedTarget)els.overlay.hidden=true});window.addEventListener("drop",e=>{e.preventDefault();els.overlay.hidden=true;const file=[...e.dataTransfer.files].find(f=>/\.midi?$/i.test(f.name));file?importMidi(file):toast("Dépose un fichier .mid ou .midi",true)});
window.addEventListener("resize",resizeCanvas);els.bpmOut.textContent=els.bpm.value;renderMixer();updateUI(0);resizeCanvas();
(()=>{
  const params=new URLSearchParams(location.search),mode=params.get("mode"),track=params.get("track"),root=params.get("root"),scale=params.get("scale"),octave=params.get("octave")||"auto";
  if(track){window.dispatchEvent(new CustomEvent("trompetterie:play",{detail:{source:"music",mode:mode||"hero",music:track}}));}
  else if(root!==null&&scale){window.dispatchEvent(new CustomEvent("trompetterie:play",{detail:{source:"scale",mode:mode||"hero",root:Number(root),scale,octave}}));}
  else if(mode){setLearningMode(mode);}
})();
