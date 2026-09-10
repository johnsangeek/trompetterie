"use strict";
(() => {
  window.addEventListener("trompetterie:play", (event) => {
    const d = event.detail || {};
    const params = new URLSearchParams();
    params.set("mode", d.mode || "hero");
    if (d.source === "music" && d.music && d.music !== "demo") {
      params.set("track", d.music);
    } else if (d.source === "scale") {
      params.set("root", d.root ?? 2);
      params.set("scale", d.scale || "blues");
      params.set("octave", d.octave || "auto");
    }
    location.href = `hero.html?${params.toString()}`;
  });

  // No player/canvas lives on the homepage to import a MIDI into - send the
  // player straight to Hero mode, which has the real import button.
  document.getElementById("drawerImportMidi")?.addEventListener("click", (event) => {
    event.stopPropagation();
    location.href = "hero.html";
  });
})();
