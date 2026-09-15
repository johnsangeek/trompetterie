"use strict";
(()=>{
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const NAMES=["Do","Do♯","Ré","Mi♭","Mi","Fa","Fa♯","Sol","La♭","La","Si♭","Si"];
  const NAMES_EN=["C","C♯","D","E♭","E","F","F♯","G","A♭","A","B♭","B"];
  const noteName=midi=>`${NAMES[midi%12]}${Math.floor(midi/12)-1}`;

  let audio=null;
  function ensureAudio(){audio||=new(window.AudioContext||window.webkitAudioContext)();audio.resume()}
  function tone(midi,when,duration=.85,volume=.16){
    const o=audio.createOscillator(),g=audio.createGain();
    o.type="triangle";o.frequency.value=440*2**((midi-69)/12);
    g.gain.setValueAtTime(.0001,when);g.gain.exponentialRampToValueAtTime(volume,when+.03);
    g.gain.setValueAtTime(volume,when+Math.max(.05,duration-.15));g.gain.exponentialRampToValueAtTime(.0001,when+duration);
    o.connect(g).connect(audio.destination);o.start(when);o.stop(when+duration+.05);
  }

  // Tabs
  $$(".ts-tabs button").forEach(btn=>btn.addEventListener("click",()=>{
    $$(".ts-tabs button").forEach(b=>{b.classList.toggle("active",b===btn);b.setAttribute("aria-selected",String(b===btn))});
    $$(".ts-panel").forEach(p=>p.classList.toggle("active",p.dataset.panel===btn.dataset.tab));
  }));

  // Natural harmonics row (open partials, in practical range)
  const HARMONICS=[
    {midi:60,label:"2ᵉ harmonique"},
    {midi:67,label:"3ᵉ harmonique"},
    {midi:72,label:"4ᵉ harmonique"},
    {midi:76,label:"5ᵉ harmonique"},
    {midi:79,label:"6ᵉ harmonique"},
  ];
  const harmonicRow=$("#harmonicRow");
  HARMONICS.forEach(h=>{
    const card=document.createElement("button");
    card.type="button";card.className="ts-harmonic-note";
    card.innerHTML=`<strong>${noteName(h.midi)}</strong><small>${h.label}</small>`;
    card.addEventListener("click",()=>{
      ensureAudio();tone(h.midi,audio.currentTime,.9);
      card.classList.add("sounding");setTimeout(()=>card.classList.remove("sounding"),900);
    });
    harmonicRow.appendChild(card);
  });

  // Notes FR/EN
  const translateGrid=$("#translateGrid");
  NAMES.forEach((label,i)=>{
    const midi=60+i,card=document.createElement("button");
    card.type="button";card.className="ts-harmonic-note";
    card.innerHTML=`<strong>${label}</strong><small>${NAMES_EN[i]}</small>`;
    card.addEventListener("click",()=>{
      ensureAudio();tone(midi,audio.currentTime,.7);
      card.classList.add("sounding");setTimeout(()=>card.classList.remove("sounding"),700);
    });
    translateGrid.appendChild(card);
  });

  // Casse-tête FR -> EN
  const EN_CANON=["C","C#","D","EB","E","F","F#","G","AB","A","BB","B"];
  const puzzleGrid=$("#puzzleGrid"),puzzleScore=$("#puzzleScore");
  function normalizeAnswer(s){return s.trim().toUpperCase().replace(/♭/g,"B").replace(/♯/g,"#")}
  function shuffledIndices(){const a=[0,1,2,3,4,5,6,7,8,9,10,11];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
  function renderPuzzle(){
    puzzleGrid.innerHTML="";puzzleScore.textContent="";
    shuffledIndices().forEach(i=>{
      const cell=document.createElement("div");cell.className="ts-puzzle-cell";cell.dataset.index=String(i);
      cell.innerHTML=`<strong>${NAMES[i]}</strong><input type="text" maxlength="3" autocomplete="off" aria-label="Nom anglais de ${NAMES[i]}">`;
      cell.querySelector("input").addEventListener("keydown",e=>{if(e.key==="Enter")checkPuzzle()});
      puzzleGrid.appendChild(cell);
    });
  }
  function checkPuzzle(){
    let correct=0;const cells=$$("#puzzleGrid .ts-puzzle-cell");
    cells.forEach(cell=>{
      const i=Number(cell.dataset.index),input=cell.querySelector("input"),ok=normalizeAnswer(input.value)===EN_CANON[i];
      cell.classList.toggle("correct",ok&&input.value.trim()!=="");cell.classList.toggle("wrong",!ok&&input.value.trim()!=="");
      if(ok&&input.value.trim()!=="")correct++;
    });
    puzzleScore.textContent=`${correct} / ${cells.length} correctes`;
  }
  renderPuzzle();
  $("#puzzleCheck").addEventListener("click",checkPuzzle);
  $("#puzzleReset").addEventListener("click",renderPuzzle);

  // Toutes les notes (full chromatic reference, F#3 to C6)
  const chromGrid=$("#chromGrid");
  const ALL_NOTES=[];
  for(let midi=54;midi<=84;midi++)ALL_NOTES.push(midi);
  const chromCards=new Map();
  ALL_NOTES.forEach(midi=>{
    const vals=window.TrumpetFingerings.primary(midi);
    const card=document.createElement("button");
    card.type="button";card.className="ts-harmonic-note ts-chrom-card";
    card.innerHTML=`<strong>${noteName(midi)}</strong><small>${vals.length?vals.join("+"):"ouvert"}</small>`;
    card.addEventListener("click",()=>{
      ensureAudio();tone(midi,audio.currentTime,.7);
      card.classList.add("sounding");setTimeout(()=>card.classList.remove("sounding"),700);
    });
    chromCards.set(midi,card);
    chromGrid.appendChild(card);
  });
  let chromTimer=null;
  function stopChrom(){clearTimeout(chromTimer);chromTimer=null;chromCards.forEach(c=>c.classList.remove("sounding"))}
  function playChromSequence(sequence){
    ensureAudio();stopChrom();
    let i=0;
    const step=()=>{
      chromCards.forEach(c=>c.classList.remove("sounding"));
      if(i>=sequence.length)return;
      const midi=sequence[i],card=chromCards.get(midi);
      card.classList.add("sounding");card.scrollIntoView({block:"nearest",behavior:"smooth"});
      tone(midi,audio.currentTime,.42);
      i++;chromTimer=setTimeout(step,460);
    };
    step();
  }
  $("#chromUp").addEventListener("click",()=>playChromSequence(ALL_NOTES));
  $("#chromDown").addEventListener("click",()=>playChromSequence([...ALL_NOTES].reverse()));
  $("#chromStop").addEventListener("click",stopChrom);

  // Harmonic-ladder drill
  const drillLadder=$("#drillLadder"),drillNote=$("#drillNote");
  let drillLevel=2,drillTimer=null;
  function ladderNotes(){return HARMONICS.slice(0,drillLevel)}
  function renderLadder(activeIndex=-1){
    drillLadder.innerHTML="";
    ladderNotes().forEach((h,i)=>{
      const span=document.createElement("span");
      span.textContent=noteName(h.midi);
      span.className=i===activeIndex?"on":"";
      drillLadder.appendChild(span);
    });
  }
  renderLadder();
  $$("#drillLevels button").forEach(btn=>btn.addEventListener("click",()=>{
    $$("#drillLevels button").forEach(b=>b.classList.toggle("active",b===btn));
    drillLevel=Number(btn.dataset.level);renderLadder();
  }));
  function stopDrill(){clearTimeout(drillTimer);drillTimer=null;drillNote.textContent="—";renderLadder()}
  function playSequence(sequence){
    ensureAudio();stopDrill();
    let i=0;
    const step=()=>{
      if(i>=sequence.length){drillNote.textContent="—";renderLadder();return}
      const h=sequence[i];
      drillNote.textContent=noteName(h.midi);
      renderLadder(ladderNotes().indexOf(h));
      tone(h.midi,audio.currentTime,.85);
      i++;drillTimer=setTimeout(step,950);
    };
    step();
  }
  $("#drillDown").addEventListener("click",()=>playSequence([...ladderNotes()].reverse()));
  $("#drillUp").addEventListener("click",()=>playSequence(ladderNotes()));
  $("#drillStop").addEventListener("click",stopDrill);

  // Trois harmoniques sur les sept longueurs de tube
  const FLEX_POSITIONS=[
    {label:"Ouvert",valves:[],drop:0},
    {label:"Piston 2",valves:[2],drop:1},
    {label:"Piston 1",valves:[1],drop:2},
    {label:"Pistons 1 + 2",valves:[1,2],drop:3},
    {label:"Pistons 2 + 3",valves:[2,3],drop:4},
    {label:"Pistons 1 + 3",valves:[1,3],drop:5},
    {label:"Pistons 1 + 2 + 3",valves:[1,2,3],drop:6},
  ];
  const flexSequence=$("#flexSequence"),flexNow=$("#flexNow");
  let flexStepMs=1450,flexTimer=null,flexRun=0;
  const flexNotes=position=>[60-position.drop,67-position.drop,72-position.drop];
  const flexValveHTML=valves=>valves.length?valves.map(v=>`<span class="ts-mini-dot v${v}">${v}</span>`).join(""):'<span class="ts-mini-dot v0">0</span>';
  function renderFlex(activeIndex=-1){
    flexSequence.innerHTML="";
    FLEX_POSITIONS.forEach((position,index)=>{
      const notes=flexNotes(position),card=document.createElement("button");
      card.type="button";card.className="ts-flex-card"+(index===activeIndex?" active":"");
      card.innerHTML=`<small>${index+1}</small><span class="ts-flex-valves">${flexValveHTML(position.valves)}</span><strong>${notes.map(noteName).join(" · ")}</strong>`;
      card.setAttribute("aria-label",`${position.label} : ${notes.map(noteName).join(", ")}`);
      card.addEventListener("click",()=>playFlexPosition(index));
      flexSequence.appendChild(card);
    });
  }
  function soundFlexNotes(notes){
    ensureAudio();
    [notes[0],notes[1],notes[2],notes[1],notes[0]].forEach((midi,i)=>tone(midi,audio.currentTime+i*.22,.38,.13));
  }
  function showFlexPosition(index,withSound=true){
    const position=FLEX_POSITIONS[index],notes=flexNotes(position);
    renderFlex(index);
    flexNow.innerHTML=`<small>POSITION ${index+1} / 7</small><strong>${position.label}</strong><span>${notes.map(noteName).join(" · ")}</span><div class="ts-drill-fingers">${flexValveHTML(position.valves)}</div>`;
    if(withSound)soundFlexNotes(notes);
  }
  function stopFlex(reset=true){
    flexRun++;clearTimeout(flexTimer);flexTimer=null;
    if(reset){renderFlex();flexNow.innerHTML="<small>POSITION</small><strong>Prêt</strong><span>Do4 · Sol4 · Do5</span>"}
  }
  function playFlexPosition(index){stopFlex(false);showFlexPosition(index)}
  function playFlexSequence(sequence){
    stopFlex(false);const run=flexRun;let index=0;
    const step=()=>{
      if(run!==flexRun)return;
      if(index>=sequence.length){flexTimer=setTimeout(()=>stopFlex(),500);return}
      showFlexPosition(sequence[index++]);flexTimer=setTimeout(step,flexStepMs);
    };
    step();
  }
  renderFlex();
  $$("#flexTempo button").forEach(btn=>btn.addEventListener("click",()=>{
    $$("#flexTempo button").forEach(b=>b.classList.toggle("active",b===btn));
    flexStepMs=Number(btn.dataset.ms);
  }));
  $("#flexDown").addEventListener("click",()=>playFlexSequence([0,1,2,3,4,5,6]));
  $("#flexUp").addEventListener("click",()=>playFlexSequence([6,5,4,3,2,1,0]));
  $("#flexStop").addEventListener("click",()=>stopFlex());

  // Une note dans toutes ses octaves
  const notePicker=$("#notePicker"),noteOctaveNow=$("#noteOctaveNow"),noteOctaveLadder=$("#noteOctaveLadder");
  let notePitchClass=2;
  NAMES.forEach((label,i)=>{
    const btn=document.createElement("button");btn.type="button";btn.textContent=label;btn.className=i===notePitchClass?"active":"";
    btn.addEventListener("click",()=>{notePitchClass=i;$$("#notePicker button").forEach(b=>b.classList.toggle("active",b===btn));renderNoteLadder()});
    notePicker.appendChild(btn);
  });
  const noteOctaveFingers=$("#noteOctaveFingers");
  function fingerBadgesHTML(midi){
    const vals=window.TrumpetFingerings.primary(midi);
    return vals.length?vals.map(v=>`<span class="ts-mini-dot v${v}">${v}</span>`).join(""):'<span class="ts-mini-dot v0">0</span>';
  }
  function isHard(midi){return midi>window.TrumpetFingerings.highestWrittenMidi||midi<window.TrumpetFingerings.lowestWrittenMidi}
  function noteOctaveMidis(){const out=[];for(let midi=54;midi<=90;midi++)if(midi%12===notePitchClass)out.push(midi);return out}
  let noteOctaveTimer=null;
  function renderNoteLadder(activeIndex=-1){
    noteOctaveLadder.innerHTML="";
    noteOctaveMidis().forEach((midi,i)=>{
      const span=document.createElement("span");span.textContent=noteName(midi);
      span.className=(i===activeIndex?"on ":"")+(isHard(midi)?"hard":"");
      if(isHard(midi))span.title="Au-delà de la tessiture standard";
      noteOctaveLadder.appendChild(span);
    });
  }
  renderNoteLadder();
  function stopNoteOctave(){clearTimeout(noteOctaveTimer);noteOctaveTimer=null;noteOctaveNow.textContent="—";noteOctaveFingers.innerHTML="";renderNoteLadder()}
  function playNoteOctaveSequence(sequence){
    ensureAudio();stopNoteOctave();
    const all=noteOctaveMidis();let i=0;
    const step=()=>{
      if(i>=sequence.length){noteOctaveNow.textContent="—";noteOctaveFingers.innerHTML="";renderNoteLadder();return}
      const midi=sequence[i];
      noteOctaveNow.textContent=noteName(midi);
      noteOctaveFingers.innerHTML=fingerBadgesHTML(midi);
      renderNoteLadder(all.indexOf(midi));
      tone(midi,audio.currentTime,.85);
      i++;noteOctaveTimer=setTimeout(step,950);
    };
    step();
  }
  $("#noteOctaveDown").addEventListener("click",()=>playNoteOctaveSequence([...noteOctaveMidis()].reverse()));
  $("#noteOctaveUp").addEventListener("click",()=>playNoteOctaveSequence(noteOctaveMidis()));
  $("#noteOctaveStop").addEventListener("click",stopNoteOctave);

  // Quiz renouvelé : une seule question à la fois, avec une sélection différente à chaque partie.
  const QUIZ_BASE=[
    {q:"Combien de pistons a une trompette standard ?",answer:"3",wrong:["2","4"],why:"Les trois pistons donnent sept longueurs de tube principales."},
    {q:"Quel piston baisse la note d'un demi-ton ?",answer:"Le piston 2",wrong:["Le piston 1","Le piston 3"],why:"Le piston 2 est le plus court : il abaisse d'un demi-ton."},
    {q:"Quel piston baisse la note d'un ton ?",answer:"Le piston 1",wrong:["Le piston 2","Le piston 3"],why:"Le piston 1 ajoute assez de tube pour descendre d'un ton."},
    {q:"Comment change-t-on d'harmonique sans piston ?",answer:"Avec la vitesse de l'air et les lèvres",wrong:["En tournant l'instrument","En changeant de coulisse"],why:"L'air et l'embouchure sélectionnent un autre partiel du même tube."},
    {q:"Quand une trompette Sib joue un Do écrit, quelle note sonne au concert ?",answer:"Sib",wrong:["Do","Ré"],why:"La trompette Sib sonne un ton plus bas que la note écrite."},
    {q:"Comment appelle-t-on une liaison entre harmoniques sans coup de langue ?",answer:"Un lip slur",wrong:["Un trille","Un vibrato"],why:"Le lip slur développe la souplesse entre les partiels."},
    {q:"Quel est l'ordre chromatique des deux premières positions après l'ouvert ?",answer:"2 puis 1",wrong:["1 puis 2","1+2 puis 3"],why:"Le piston 2 abaisse d'un demi-ton, puis le piston 1 d'un ton."},
    {q:"Quelle combinaison donne la plus grande longueur de tube ?",answer:"1 + 2 + 3",wrong:["1 + 3","2 + 3"],why:"Les trois coulisses sont alors ajoutées au tube principal."},
    {q:"Pourquoi faut-il parfois sortir la coulisse du 3e piston ?",answer:"Pour corriger la justesse de certaines notes graves",wrong:["Pour jouer plus fort","Pour changer de tonalité"],why:"Les combinaisons 1+3 et 1+2+3 ont naturellement tendance à sonner trop haut."},
    {q:"Une noire vaut combien de temps en 4/4 ?",answer:"1 temps",wrong:["2 temps","4 temps"],why:"En 4/4, la noire est l'unité de pulsation."},
    {q:"Que signifie le symbole ♭ ?",answer:"Baisser d'un demi-ton",wrong:["Monter d'un demi-ton","Jouer plus doucement"],why:"Le bémol abaisse la hauteur d'un demi-ton."},
    {q:"Quel conseil protège le mieux les lèvres pendant les exercices de souplesse ?",answer:"Se reposer au moins autant que l'on joue",wrong:["Appuyer davantage l'embouchure","Toujours jouer au maximum"],why:"La qualité et le repos comptent plus que la force ou la durée."},
  ];
  const QUIZ_COMBOS=["ouvert","2","1","1 + 2","2 + 3","1 + 3","1 + 2 + 3"];
  const shuffle=array=>{const out=[...array];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out};
  function fingeringLabel(midi){const values=window.TrumpetFingerings.primary(midi);return values.length?values.join(" + "):"ouvert"}
  function makeQuizPool(){
    const pool=[...QUIZ_BASE];
    for(let midi=54;midi<=84;midi++){
      const answer=fingeringLabel(midi),wrong=shuffle(QUIZ_COMBOS.filter(value=>value!==answer)).slice(0,2);
      pool.push({q:`Quel est le doigté principal de ${noteName(midi)} ?`,answer,wrong,why:`${noteName(midi)} se joue ${answer}. Le doigté peut changer selon l'octave.`});
    }
    NAMES.forEach((name,index)=>{
      pool.push({q:`Comment écrit-on ${name} en notation anglaise ?`,answer:NAMES_EN[index],wrong:shuffle(NAMES_EN.filter((_,i)=>i!==index)).slice(0,2),why:`${name} correspond à ${NAMES_EN[index]}.`});
    });
    return pool;
  }
  let quizRound=[],quizIndex=0,quizScore=0,quizStreak=0,quizLocked=false;
  function startQuiz(){quizRound=shuffle(makeQuizPool()).slice(0,8);quizIndex=0;quizScore=0;quizStreak=0;quizLocked=false;renderQuizQuestion()}
  function renderQuizQuestion(){
    if(quizIndex>=quizRound.length){showQuizScore();return}
    const item=quizRound[quizIndex],options=shuffle([item.answer,...item.wrong]),body=$("#quizBody");
    body.innerHTML=`<div class="ts-quiz-hud"><span>Question ${quizIndex+1} / ${quizRound.length}</span><span id="quizScoreHud">${quizScore} point${quizScore>1?"s":""} · série ${quizStreak}</span></div><div class="ts-quiz-progress"><i id="quizProgressBar" style="width:${quizIndex/quizRound.length*100}%"></i></div>`;
    const card=document.createElement("div");card.className="ts-quiz-q ts-quiz-q--game";
    card.innerHTML=`<p>${item.q}</p><div class="ts-quiz-options"></div><div class="ts-quiz-feedback" aria-live="polite"></div>`;
    const optionsBox=card.querySelector(".ts-quiz-options");
    options.forEach(label=>{
      const btn=document.createElement("button");btn.type="button";btn.textContent=label;
      btn.addEventListener("click",()=>answerQuiz(btn,label,item,optionsBox,card));optionsBox.appendChild(btn);
    });
    body.appendChild(card);
  }
  function answerQuiz(button,label,item,optionsBox,card){
    if(quizLocked)return;quizLocked=true;
    const correct=label===item.answer;
    [...optionsBox.children].forEach(btn=>{btn.disabled=true;if(btn.textContent===item.answer)btn.classList.add("correct")});
    if(correct){quizScore++;quizStreak++}else{quizStreak=0;button.classList.add("wrong")}
    $("#quizScoreHud").textContent=`${quizScore} point${quizScore>1?"s":""} · série ${quizStreak}`;
    $("#quizProgressBar").style.width=`${(quizIndex+1)/quizRound.length*100}%`;
    const feedback=card.querySelector(".ts-quiz-feedback");
    feedback.innerHTML=`<strong>${correct?"Bien joué !":"Pas tout à fait."}</strong><span>${item.why}</span>`;
    const next=document.createElement("button");next.type="button";next.className="ts-quiz-next";next.textContent=quizIndex===quizRound.length-1?"Voir mon score":"Question suivante";
    next.addEventListener("click",()=>{quizIndex++;quizLocked=false;renderQuizQuestion()});feedback.appendChild(next);next.focus();
  }
  function showQuizScore(){
    const message=quizScore===8?"Sans-faute !":quizScore>=6?"Très solide.":quizScore>=4?"Bonne base, continue.":"Encore une partie et ça va rentrer.";
    $("#quizBody").innerHTML=`<div class="ts-quiz-score"><small>PARTIE TERMINÉE</small><strong>${quizScore} / ${quizRound.length}</strong><span>${message}</span><button type="button" id="quizAgain">Nouvelle partie</button></div>`;
    $("#quizAgain").addEventListener("click",startQuiz);
  }
  startQuiz();
})();
