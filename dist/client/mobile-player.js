"use strict";
(()=>{
  const $=s=>document.querySelector(s),body=document.body,highway=$("#mpHighway"),score=$("#mpScore"),hctx=highway.getContext("2d"),sctx=score.getContext("2d"),params=new URLSearchParams(location.search);
  const names=["Do","Do♯","Ré","Mi♭","Mi","Fa","Fa♯","Sol","La♭","La","Si♭","Si"],scales={blues:[0,3,5,6,7,10,12],major:[0,2,4,5,7,9,11,12],minor:[0,2,3,5,7,8,10,12],pentatonic:[0,2,4,7,9,12],minorPentatonic:[0,3,5,7,10,12]},scaleNames={blues:"Blues",major:"Majeure",minor:"Mineure",pentatonic:"Pentatonique majeure",minorPentatonic:"Pentatonique mineure"};
  const colors={low:["#1683cc","#064d87"],mid:["#69d8f7","#27a9d7"],high:["#fff087","#efc724"],very:["#ffb45f","#ed653b"],extreme:["#f6b6ff","#c75bdf"]};
  let song={melody:[],all:[],endBeat:1,bpm:92},audio=null,playing=false,pausedBeat=0,startTime=0,timer=0,nodes=[],scheduled=-1,scheduledSet=new Set(),metroBeat=-1,mode=params.get("mode")||"hero";
  const bpm=()=>Number($("#mpBpm").value),spb=()=>60/bpm(),beat=()=>playing?(audio.currentTime-startTime)/spb():pausedBeat,noteName=m=>`${names[m%12]}${Math.floor(m/12)-1}`;
  const loopOn=()=>$("#mpLoop").classList.contains("active");
  function windowed(list,now,back,ahead){
    if(!loopOn()||!(song.endBeat>0))return list.filter(n=>n.beat>=now-back&&n.beat<=now+ahead);
    const period=song.endBeat,c0=Math.max(0,Math.floor((now-back)/period)),c1=Math.floor((now+ahead)/period),out=[];
    for(let c=c0;c<=c1;c++)for(const n of list){const b=n.beat+c*period;if(b>=now-back&&b<=now+ahead)out.push({...n,beat:b})}
    return out;
  }
  function activeAt(list,now){
    if(!loopOn()||!(song.endBeat>0))return list.find(n=>n.beat<=now+.04&&n.beat+n.duration>now);
    const period=song.endBeat,c=Math.floor(now/period);
    for(let dc=0;dc>=-1;dc--){const cc=c+dc;if(cc<0)continue;for(const n of list){const b=n.beat+cc*period;if(b<=now+.04&&b+n.duration>now)return{...n,beat:b}}}
    return null;
  }
  function ensureAudio(){audio||=new(window.AudioContext||window.webkitAudioContext)();audio.resume()}
  function synth(midi,when,duration=.3,volume=.13){const o=audio.createOscillator(),g=audio.createGain();o.type="triangle";o.frequency.value=440*2**((midi-69)/12);g.gain.setValueAtTime(.001,when);g.gain.exponentialRampToValueAtTime(volume,when+.012);g.gain.exponentialRampToValueAtTime(.001,when+Math.max(.08,duration));o.connect(g).connect(audio.destination);o.start(when);o.stop(when+duration+.03);nodes.push(o)}
  function click(when,accent){const o=audio.createOscillator(),g=audio.createGain();o.type="square";o.frequency.value=accent?1250:900;g.gain.setValueAtTime(.035,when);g.gain.exponentialRampToValueAtTime(.001,when+.045);o.connect(g).connect(audio.destination);o.start(when);o.stop(when+.05);nodes.push(o)}
  function loadScale(){const root=Number(params.get("root")||2),key=params.get("scale")||"blues",requested=params.get("octave")||"auto",startOctave=requested==="auto"?(root>=7?3:4):Number(requested),base=12*(startOctave+1)+root,seq=[...scales[key],...scales[key].slice(0,-1).reverse()];const melody=seq.map((n,i)=>({beat:i,note:base+n,duration:.82,guide:true}));song={melody,all:melody,endBeat:seq.length,bpm:92};$("#mpTitle").textContent=`Gamme ${scaleNames[key]} · ${names[root]}${startOctave}`}
  async function loadTrack(id){if(!id||id==="demo"){const seq=[64,67,69,67,64,62,60,62,64,67,69,71,69,67,64,62];const melody=seq.map((n,i)=>({beat:i,note:n,duration:.82,guide:true}));song={melody,all:melody,endBeat:seq.length,bpm:92};$("#mpTitle").textContent="Premiers pas";return}const data=await fetch(`tracks/${encodeURIComponent(id)}.json`).then(r=>r.json()),rate=(Number(data.bpm)||120)/60,lead=data.stems?.find(s=>s.isLead),source=lead?.notes?.length?lead.notes:data.notes||[],melody=source.map((n,i)=>({beat:n.time*rate,note:n.midi,duration:Math.max(.1,(n.duration||.45)*rate),guide:true}));song={melody,all:melody,endBeat:Math.max(data.duration*rate,...melody.map(n=>n.beat+n.duration)),bpm:Number(data.bpm)||120};$("#mpTitle").textContent=data.name||id;$("#mpBpm").value=String(song.bpm);$("#mpBpmOut").textContent=String(Math.round(song.bpm))}
  function color(note){const oct=Math.floor(note/12)-1;return oct<=3?colors.low:oct===4?colors.mid:oct===5?colors.high:oct===6?colors.very:colors.extreme}
  function resize(){for(const c of[highway,score]){const r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);c.width=Math.round(r.width*d);c.height=Math.round(r.height*d);c.getContext("2d").setTransform(d,0,0,d,0,0)}draw()}
  function round(ctx,x,y,w,h,r=7){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
  function drawHero(now){const w=highway.clientWidth,h=highway.clientHeight,hit=h-34,ahead=9,lane=w/3;hctx.clearRect(0,0,w,h);hctx.strokeStyle="rgba(35,40,35,.12)";for(let i=1;i<3;i++){hctx.beginPath();hctx.moveTo(i*lane,0);hctx.lineTo(i*lane,hit);hctx.stroke()}for(const n of windowed(song.melody,now,.3,ahead)){const y=hit-(n.beat-now)/ahead*(hit-5),vals=window.TrumpetFingerings.primary(n.note),c=color(n.note),bh=Math.max(18,Math.min(72,n.duration*34));if(!vals.length){const g=hctx.createLinearGradient(18,0,w-18,0);g.addColorStop(0,c[1]);g.addColorStop(.5,c[0]);g.addColorStop(1,c[1]);hctx.fillStyle=g;round(hctx,18,y-bh,w-36,bh,7);hctx.fill()}else for(const v of vals){const x=(v-.5)*lane,g=hctx.createLinearGradient(0,y-bh,0,y);g.addColorStop(0,c[0]);g.addColorStop(1,c[1]);hctx.fillStyle=g;hctx.shadowColor=c[0];hctx.shadowBlur=8;round(hctx,x-lane*.18,y-bh,lane*.36,bh,7);hctx.fill();hctx.shadowBlur=0}}hctx.strokeStyle="#e0a01c";hctx.lineWidth=2;hctx.beginPath();hctx.moveTo(14,hit);hctx.lineTo(w-14,hit);hctx.stroke();const active=activeAt(song.melody,now),activeVals=active?window.TrumpetFingerings.primary(active.note):[];for(let i=0;i<3;i++){const on=activeVals.includes(i+1);hctx.save();if(on){hctx.shadowColor="#fff";hctx.shadowBlur=18;hctx.fillStyle="#fff"}else{hctx.fillStyle="#171a17"}hctx.beginPath();hctx.arc((i+.5)*lane,hit,21,0,Math.PI*2);hctx.fill();hctx.restore();hctx.fillStyle=on?"#171a17":"#fff";hctx.font="800 11px Segoe UI";hctx.textAlign="center";hctx.fillText(String(i+1),(i+.5)*lane,hit+4)}}
  function fit(m){let midi=m,octaves=0;while(midi>74){midi-=12;octaves++}while(midi<55){midi+=12;octaves--}return{midi,octaves}}
  function staffStep(midi){const diatonic=[0,0,1,1,2,3,3,4,4,5,5,6];return (Math.floor(midi/12)-5)*7+diatonic[midi%12]}
  function drawScore(now){const w=score.clientWidth,h=score.clientHeight,center=w*.42,top=h*.43,gap=9;sctx.clearRect(0,0,w,h);sctx.strokeStyle="rgba(34,39,34,.5)";for(let i=0;i<5;i++){sctx.beginPath();sctx.moveTo(55,top+i*gap);sctx.lineTo(w,top+i*gap);sctx.stroke()}sctx.strokeStyle="#e0a01c";sctx.lineWidth=3;sctx.beginPath();sctx.moveTo(center,top-35);sctx.lineTo(center,top+65);sctx.stroke();for(const n of windowed(song.melody,now,4,8)){const x=center+(n.beat-now)*46,fitted=fit(n.note),y=top+44-staffStep(fitted.midi)*gap/2;if(x<55||x>w+10)continue;if(y>top+gap*4+gap/2||y<top-gap/2){sctx.strokeStyle="rgba(34,39,34,.65)";sctx.lineWidth=1;sctx.beginPath();sctx.moveTo(x-10,y);sctx.lineTo(x+10,y);sctx.stroke()}sctx.fillStyle=n.beat<=now+.05&&n.beat+n.duration>now?"#df9d18":"#20241f";sctx.beginPath();sctx.ellipse(x,y,7,5,-.25,0,Math.PI*2);sctx.fill();sctx.strokeStyle="#20241f";sctx.lineWidth=1.4;sctx.beginPath();sctx.moveTo(x+6,y);sctx.lineTo(x+6,y-25);sctx.stroke();sctx.font="700 9px Segoe UI";sctx.textAlign="center";sctx.fillText(noteName(n.note),x,top+69);const vals=window.TrumpetFingerings.primary(n.note),fingerY=Math.max(12,y-30);sctx.font="800 8px Segoe UI";sctx.fillText(vals.length?vals.join(""):"0",x,fingerY);if(fitted.octaves){sctx.fillStyle="#9a6b12";sctx.font="800 7px Segoe UI";sctx.fillText(`${Math.abs(fitted.octaves)===1?"8":"15"}${fitted.octaves>0?"va":"vb"}`,x+13,y+3)}}}
  function draw(){const now=beat();drawHero(now);drawScore(now);if(playing)requestAnimationFrame(draw)}
  function performance(now){const active=activeAt(song.melody,now),vals=active?window.TrumpetFingerings.primary(active.note):[];$("#mpNote").textContent=active?noteName(active.note):"—";$("#mpFingers").innerHTML=(vals.length?vals:[0]).map(v=>`<i class="${v?`p${v}`:"off"}">${v}</i>`).join("");window.dispatchEvent(new CustomEvent("hero:performance-state",{detail:{valves:vals,note:active?noteName(active.note):"—"}}))}
  function tick(){
    if(!playing)return;
    const now=audio.currentTime,b=beat(),horizon=b+.25/spb(),period=song.endBeat;
    if(loopOn()&&period>0){
      const cLo=Math.max(0,Math.floor(b/period)),cHi=Math.floor(horizon/period);
      for(let c=cLo;c<=cHi;c++){
        song.all.forEach((n,i)=>{
          const key=`${c}:${i}`;if(scheduledSet.has(key))return;
          const shifted=n.beat+c*period;
          if(shifted>=b-.1&&shifted<=horizon){synth(n.note,Math.max(now,startTime+shifted*spb()),Math.min(.8,n.duration*spb()),.12);scheduledSet.add(key)}
        });
      }
    }else{
      song.all.forEach((n,i)=>{if(i<=scheduled||n.beat>horizon)return;if(n.beat>=b-.1){synth(n.note,Math.max(now,startTime+n.beat*spb()),Math.min(.8,n.duration*spb()),.12);scheduled=i}});
    }
    if($("#mpMetro").classList.contains("active")){let m=Math.max(metroBeat+1,Math.ceil(b-.001));while(m<=horizon){click(startTime+m*spb(),m%4===0);metroBeat=m;m++}}
    const left=Math.max(0,-b*spb());
    $("#mpCount").textContent=b<0?`DÉPART ${Math.max(1,Math.ceil(left))}`:"EN JEU";
    const displayBeat=loopOn()&&period>0?b-Math.floor(Math.max(0,b)/period)*period:b;
    $("#mpProgress").style.width=`${Math.max(0,Math.min(100,displayBeat/period*100))}%`;
    performance(b);
    if(!loopOn()&&b>=period){pause();pausedBeat=0;$("#mpCount").textContent="TERMINÉ"}
  }
  function play(count=true){ensureAudio();if(count&&pausedBeat===0)pausedBeat=-5/spb();startTime=audio.currentTime-pausedBeat*spb();playing=true;scheduled=song.all.findLastIndex?.(n=>n.beat<pausedBeat-.02)??-1;scheduledSet=new Set();metroBeat=Math.floor(pausedBeat)-1;$("#mpPlay").innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';$("#mpPlay").setAttribute("aria-label","Pause");timer=setInterval(tick,25);tick();draw()}
  function pause(){if(!playing)return;pausedBeat=beat();playing=false;clearInterval(timer);nodes.forEach(n=>{try{n.stop()}catch{}});nodes=[];$("#mpPlay").innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';$("#mpPlay").setAttribute("aria-label","Lecture");$("#mpCount").textContent="PAUSE";draw()}
  function setMode(next){mode=next;body.dataset.mode=mode;body.dataset.viewMode=mode;document.querySelectorAll("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));window.dispatchEvent(new CustomEvent("hero:view-mode",{detail:{mode}}));body.classList.remove("menu-open");setTimeout(resize,50)}
  $("#mpPlay").onclick=()=>playing?pause():play(pausedBeat===0);$("#mpMetro").onclick=()=>$("#mpMetro").classList.toggle("active");$("#mpLoop").onclick=()=>$("#mpLoop").classList.toggle("active");$("#mpBpm").oninput=()=>{$("#mpBpmOut").textContent=$("#mpBpm").value;const was=playing;if(was)pause();if(was)play(false)};document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$("#mpMenu").onclick=()=>body.classList.add("menu-open");$("#mpDrawerClose").onclick=()=>body.classList.remove("menu-open");window.addEventListener("resize",resize);
  (async()=>{setMode(mode);if(params.has("track"))await loadTrack(params.get("track"));else loadScale();resize();play(true)})().catch(()=>{$("#mpCount").textContent="TOUCHE PLAY"});
})();
