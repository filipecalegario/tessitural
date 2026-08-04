/* Conversões de nota e utilitários compartilhados. */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_PT = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function midiToName(m) {
  const n = Math.round(m);
  return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

function midiToNamePt(m) {
  const n = Math.round(m);
  return NOTE_NAMES_PT[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
}

function nameToMidi(text) {
  if (text === null || text === undefined) return null;
  let raw = String(text).trim().replace("♯", "#").replace("♭", "b");
  if (!raw) return null;
  for (let i = 0; i < NOTE_NAMES_PT.length; i++) {
    const pt = NOTE_NAMES_PT[i];
    if (raw.toLowerCase().startsWith(pt.toLowerCase())) {
      const oct = parseInt(raw.slice(pt.length), 10);
      if (Number.isNaN(oct)) return null;
      return (oct + 1) * 12 + i;
    }
  }
  const letters = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = letters[raw[0].toUpperCase()];
  if (base === undefined) return null;
  let idx = base, pos = 1;
  while (pos < raw.length && (raw[pos] === "#" || raw[pos] === "b")) {
    idx += raw[pos] === "#" ? 1 : -1;
    pos++;
  }
  const oct = parseInt(raw.slice(pos), 10);
  if (Number.isNaN(oct)) return null;
  return (oct + 1) * 12 + idx;
}

function isBlackKey(m) {
  return BLACK_KEYS.has(((Math.round(m) % 12) + 12) % 12);
}

function fmtTime(sec) {
  if (!isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtSemitones(n) {
  const v = Math.round(n * 10) / 10;
  return (v > 0 ? "+" : "") + v + " st";
}

/* Classificação de uma altura contra o alcance do cantor.
   A posição vertical no gráfico já diz isso; a cor só reforça. */
function zoneOf(midi, s) {
  if (midi >= s.comfort_low && midi <= s.comfort_high) return "comfort";
  if (midi >= s.stretch_low && midi <= s.stretch_high) return "stretch";
  return "out";
}

const ZONE_LABEL = {
  comfort: "dentro do confortável",
  stretch: "na esticada",
  out: "fora do alcance",
};

/* Tooltip único compartilhado por todas as visualizações. */
const Tooltip = (() => {
  const el = document.getElementById("tooltip");
  return {
    show(html, x, y) {
      el.innerHTML = html;
      el.classList.add("show");
      const r = el.getBoundingClientRect();
      let left = x + 14, top = y + 14;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
      el.style.left = Math.max(8, left) + "px";
      el.style.top = Math.max(8, top) + "px";
    },
    hide() { el.classList.remove("show"); },
  };
})();

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  return e;
}

function clearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/* Largura útil do container de um gráfico.
   `clientWidth` inclui o padding, então usá-lo direto faz o SVG vazar do card. */
function availWidth(el, fallback = 480) {
  const parent = el.parentElement;
  if (!parent) return fallback;
  const cs = getComputedStyle(parent);
  const w = parent.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
  return w > 40 ? w : fallback;
}
