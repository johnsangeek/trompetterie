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

  // Quiz
  const QUESTIONS=[
    {q:"Combien de pistons a une trompette standard ?",options:["2","3","4"],correct:1},
    {q:"Comment joue-t-on un Do grave (Do4) à la trompette Sib ?",options:["Piston 1","Pistons 1+2","Aucun piston (note ouverte)"],correct:2},
    {q:"Quel piston, utilisé seul, baisse la note d'un demi-ton ?",options:["Piston 1","Piston 2","Piston 3"],correct:1},
    {q:"Quel piston, utilisé seul, baisse la note d'un ton et demi ?",options:["Piston 1","Piston 2","Piston 3"],correct:2},
    {q:"Sans piston, comment change-t-on de note (d'une harmonique à l'autre) ?",options:["C'est impossible sans piston","En changeant la vitesse de l'air et la tension des lèvres","En tournant la trompette"],correct:1},
    {q:"La trompette Sib est un instrument transpositeur. Quand le trompettiste joue un Do écrit, quelle note sonne réellement ?",options:["Un Do","Un Sib","Un Ré"],correct:1},
    {q:"Quel est le doigté du Ré4 (Ré du milieu de portée) ?",options:["Piston 1 seul","Pistons 1 et 3","Pistons 2 et 3"],correct:1},
    {q:"Et celui du Ré5, une octave plus haut ?",options:["Pistons 1 et 3, comme au grave","Piston 1 seul","Piston 2 seul"],correct:1},
    {q:"Comment s'appelle l'exercice qui fait passer d'une harmonique à l'autre sans piston, juste avec l'air et les lèvres ?",options:["Un vibrato","Un lip slur","Un trille"],correct:1},
    {q:"Entre Do4 et Sol5, combien d'harmoniques ouvertes utilise-t-on en pratique ?",options:["3","5","7"],correct:1},
    {q:"Sur une ressource en anglais, quelle lettre correspond au Ré français ?",options:["R","E","D"],correct:2},
    {q:"Et le Fa♯ en anglais, ça s'écrit comment ?",options:["F♯","S♯","Fa#"],correct:0},
  ];
  let quizScore=0,quizAnswered=0;
  function renderQuiz(){
    quizScore=0;quizAnswered=0;
    const body=$("#quizBody");body.innerHTML="";
    QUESTIONS.forEach((item,qi)=>{
      const card=document.createElement("div");card.className="ts-quiz-q";
      const p=document.createElement("p");p.textContent=`${qi+1}. ${item.q}`;card.appendChild(p);
      const opts=document.createElement("div");opts.className="ts-quiz-options";
      item.options.forEach((label,oi)=>{
        const btn=document.createElement("button");btn.type="button";btn.textContent=label;
        btn.addEventListener("click",()=>{
          if(btn.disabled)return;
          [...opts.children].forEach(b=>b.disabled=true);
          if(oi===item.correct){btn.classList.add("correct");quizScore++}
          else{btn.classList.add("wrong");opts.children[item.correct].classList.add("correct")}
          quizAnswered++;
          if(quizAnswered===QUESTIONS.length)showScore();
        });
        opts.appendChild(btn);
      });
      card.appendChild(opts);body.appendChild(card);
    });
  }
  function showScore(){
    const box=document.createElement("div");box.className="ts-quiz-score";
    box.innerHTML=`<strong>${quizScore} / ${QUESTIONS.length}</strong><span>bonnes réponses</span>`;
    const again=document.createElement("button");again.type="button";again.textContent="Recommencer le quiz";
    again.addEventListener("click",renderQuiz);
    box.appendChild(again);$("#quizBody").appendChild(box);
  }
  renderQuiz();
})();
