"use strict";
(()=>{
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const NAMES=["Do","Do♯","Ré","Mi♭","Mi","Fa","Fa♯","Sol","La♭","La","Si♭","Si"];
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
