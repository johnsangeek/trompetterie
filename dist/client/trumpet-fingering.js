"use strict";

// Primary written-note fingerings for a standard three-valve B-flat trumpet.
// MIDI values here are written pitches (not concert pitches).
window.TrumpetFingerings=(()=>{
  const exact=new Map([
    [54,[1,2,3]],[55,[1,3]],[56,[2,3]],[57,[1,2]],[58,[1]],[59,[2]],
    [60,[]],[61,[1,2,3]],[62,[1,3]],[63,[2,3]],[64,[1,2]],[65,[1]],[66,[2]],[67,[]],
    [68,[2,3]],[69,[1,2]],[70,[1]],[71,[2]],[72,[]],
    [73,[1,2]],[74,[1]],[75,[2]],[76,[]],[77,[1]],[78,[2]],[79,[]],
    [80,[2,3]],[81,[1,2]],[82,[1]],[83,[2]],[84,[]]
  ]);
  const upper=[[],[1,2],[1],[2],[],[1],[2],[],[2,3],[1,2],[1],[2]];

  function primary(writtenMidi){
    let midi=Math.round(Number(writtenMidi));
    if(!Number.isFinite(midi))return[];
    if(exact.has(midi))return[...exact.get(midi)];
    while(midi<54)midi+=12;
    if(exact.has(midi))return[...exact.get(midi)];
    return[...upper[((midi%12)+12)%12]];
  }

  return Object.freeze({primary,lowestWrittenMidi:54});
})();
