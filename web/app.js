/* Tessitural — estado, roteamento e ligação entre API e visualizações. */

const ROLL_GEOM = { height: 460, padTop: 8, padBottom: 24 };

const state = {
  settings: null,
  songs: [],
  song: null,        // análise completa carregada
  transpose: 0,
  jobs: new Map(),
  audioSrc: "mix",
};

/* ---------------- API ---------------- */

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

/* ---------------- Roteamento ---------------- */

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".tabs button").forEach(b => {
    if (b.dataset.view === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (name === "library") renderLibrary();
  if (name === "range") renderRangeView();
  if (name === "song" && state.song) renderSong();
}

document.querySelectorAll(".tabs button").forEach(b => {
  b.addEventListener("click", () => { location.hash = b.dataset.view; });
});

window.addEventListener("hashchange", route);

function route() {
  const h = location.hash.slice(1);
  if (h.startsWith("song/")) {
    openSong(h.slice(5));
    return;
  }
  showView(["library", "song", "new", "range"].includes(h) ? h : "library");
}

/* ---------------- Tema ---------------- */

const themeBtn = document.getElementById("theme-toggle");
/* O painel escuro é o padrão do produto, não uma preferência do sistema.
   O claro existe para quem quiser imprimir ou trabalhar no sol. */
themeBtn.addEventListener("click", () => {
  const light = document.documentElement.getAttribute("data-theme") === "light";
  if (light) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", "light");
  localStorage.setItem("tessitural-theme", light ? "dark" : "light");
  redrawEverything();
});
if (localStorage.getItem("tessitural-theme") === "light") {
  document.documentElement.setAttribute("data-theme", "light");
}

function drawRail() {
  const s = state.settings;
  if (!s) return;
  const open = state.song && state.song.stats && typeof state.song.stats.min_midi === "number"
    ? state.song.stats : null;
  Charts.registerRail(document.getElementById("register-rail"), s, open);
  document.getElementById("rail-readout").textContent =
    `${midiToName(s.comfort_low)}–${midiToName(s.comfort_high)}`;
}

function redrawEverything() {
  drawRail();
  PianoRoll.render();
  if (state.song) renderSong();
  renderLibrary();
  renderRangeView();
}

/* ---------------- Biblioteca ---------------- */

async function loadLibrary() {
  const { songs } = await api("/library");
  state.songs = songs;
  return songs;
}

function renderLibrary() {
  const s = state.settings;
  if (!s) return;
  // Uma análise pode não achar vocal nenhum (instrumental, separação ruim).
  // Essas músicas não têm tessitura para plotar — ficam de fora dos gráficos.
  const songs = state.songs.filter(x => typeof x.min_midi === "number");
  const failed = state.songs.length - songs.length;
  const empty = document.getElementById("library-empty");
  const chartCard = document.getElementById("library-chart-card");
  const insights = document.getElementById("library-insights");

  empty.hidden = songs.length > 0;
  chartCard.hidden = songs.length === 0;
  insights.hidden = songs.length === 0;
  if (!songs.length) return;

  const warn = document.getElementById("library-warning");
  if (failed) {
    warn.hidden = false;
    warn.innerHTML = `<div class="warn-strip">${failed} música${failed > 1 ? "s" : ""} sem vocal detectado — fora dos gráficos. Provável instrumental, ou separação que não encontrou voz.</div>`;
  } else {
    warn.hidden = true;
  }

  Charts.legend(document.getElementById("library-legend"), [
    { color: Charts.tagColor("comfortable"), label: "confortável para você" },
    { color: Charts.tagColor("hard"), label: "difícil para você" },
    { color: Charts.tagColor("neutral"), label: "sem classificação" },
    { color: cssVar("--zone-comfort"), label: "faixa acesa = seu confortável", outline: true },
  ]);

  const sorted = [...songs].sort((a, b) => a.median_midi - b.median_midi);
  Charts.rangeChart(document.getElementById("range-chart"), sorted, s, id => { location.hash = "song/" + id; });
  Charts.tagCompare(document.getElementById("tag-compare"), songs, s);
  Charts.climbChart(document.getElementById("climb-chart"), songs);

  const table = document.getElementById("library-table");
  table.innerHTML =
    `<thead><tr><th>Música</th><th>Classificação</th><th>Grave</th><th>Agudo</th><th>Extensão</th>` +
    `<th>90% do tempo</th><th>Tom</th><th>Sobe</th></tr></thead><tbody>` +
    sorted.map(x => `<tr>
        <td class="name">${escapeHtml(x.title)}${x.artist ? ` <span style="color:var(--text-muted)">· ${escapeHtml(x.artist)}</span>` : ""}</td>
        <td class="name">${Charts.TAG_LABEL[x.tag]}</td>
        <td>${x.min_note}</td><td>${x.max_note}</td>
        <td>${x.range_semitones} st</td>
        <td>${midiToName(x.core_low)}–${midiToName(x.core_high)}</td>
        <td>${x.key || "—"}</td>
        <td>${typeof x.climb === "number" ? fmtSemitones(x.climb) : "—"}</td>
      </tr>`).join("") + "</tbody>";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Música ---------------- */

async function openSong(id) {
  try {
    state.song = await api("/songs/" + id);
    state.transpose = 0;
    document.getElementById("transpose").value = 0;
    showView("song");   // já chama renderSong()
  } catch (e) {
    alert("Não consegui abrir a música: " + e.message);
  }
}

function rollRange(stats, settings, shift = 0) {
  let low = Math.min(stats.min_midi + shift, settings.comfort_low);
  let high = Math.max(stats.max_midi + shift, settings.comfort_high);
  // A faixa de extensão entra se não esticar demais a altura das linhas.
  if (settings.stretch_high - settings.stretch_low < 42) {
    low = Math.min(low, settings.stretch_low);
    high = Math.max(high, settings.stretch_high);
  }
  return { low: low - 1, high: high + 1 };
}

function renderSong() {
  const d = state.song, s = state.settings;
  if (!d || !s) return;
  document.getElementById("song-empty").hidden = true;
  document.getElementById("song-content").hidden = false;

  const meta = d.meta || {}, st = d.stats || {};
  document.getElementById("song-title").textContent = meta.title || "—";

  if (typeof st.min_midi !== "number") {
    document.getElementById("song-meta").textContent = meta.artist || "";
    document.getElementById("song-stats").innerHTML = "";
    document.getElementById("song-verdict").innerHTML =
      `<p class="verdict-lead">Nenhuma nota vocal <span class="hi">detectada</span>.</p>
       <ul class="verdict-notes"><li>Se a faixa tem canto, reanalise com a separação de stems
       ligada — sobre a mixagem completa o detector se perde entre os instrumentos.</li></ul>`;
    return;
  }

  document.getElementById("song-meta").textContent = [
    meta.artist,
    st.key && st.key.name ? `tom ${st.key.name}` : null,
    `${fmtTime(d.duration)} de música`,
    `${st.sung_seconds}s cantados`,
    meta.separated ? "vocal isolado com Demucs" : "analisado sobre a mixagem",
  ].filter(Boolean).join(" · ");

  document.querySelectorAll("#song-tag button").forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.tag === (meta.tag || "neutral")));
  });

  renderSongStats(st, s, d);
  renderVerdict(st, s, d);

  const range = rollRange(st, s, state.transpose);
  PianoRoll.setData({ notes: d.notes, contour: d.contour, duration: d.duration }, s, range);
  PianoRoll.setTranspose(state.transpose);

  Charts.legend(document.getElementById("roll-legend"), [
    { color: cssVar("--accent"), label: "no confortável" },
    { color: cssVar("--accent-soft"), label: "na esticada" },
    { color: cssVar("--alert"), label: "fora do alcance" },
  ]);

  drawRail();
  drawHistogram();
  Charts.profileChart(document.getElementById("profile-chart"), st.profile, s, document.getElementById("profile-legend"));
  drawTransposeChart();
  renderDemanding(st, s);

  const audio = document.getElementById("player");
  const src = `/api/songs/${meta.id}/audio/${state.audioSrc}`;
  if (!audio.src.endsWith(src)) { audio.src = src; }
}

function shiftedHistogram(hist, shift) {
  if (!shift) return hist;
  const out = {};
  for (const [k, v] of Object.entries(hist)) out[String(Number(k) + shift)] = v;
  return out;
}

function drawHistogram() {
  const d = state.song, s = state.settings;
  Charts.histChart(
    document.getElementById("hist-chart"),
    shiftedHistogram(d.stats.histogram || {}, state.transpose),
    s, PianoRoll.getRange(), ROLL_GEOM
  );
}

function drawTransposeChart() {
  const curve = Charts.transposeCurve(state.song.notes, state.settings);
  const best = Charts.transposeChart(
    document.getElementById("transpose-chart"), curve, state.transpose,
    shift => setTranspose(shift)
  );
  document.getElementById("transpose-best").dataset.shift = best.shift;
}

function renderSongStats(st, s, d) {
  const outLow = Math.max(0, s.comfort_low - st.min_midi);
  const outHigh = Math.max(0, st.max_midi - s.comfort_high);
  const beyond = Math.max(0, st.max_midi - s.stretch_high) || Math.max(0, s.stretch_low - st.min_midi);

  const cells = [
    {
      k: "Tessitura",
      v: `${st.min_note}–${st.max_note}`,
      f: `${st.range_semitones} semitons de extensão`,
    },
    {
      k: "90% do tempo",
      v: `${midiToName(st.core_low)}–${midiToName(st.core_high)}`,
      f: `mediana em ${st.median_note}`,
    },
    {
      k: "Mais aguda",
      v: st.max_note,
      f: `aos ${fmtTime(st.max_at)}` + (outHigh ? ` · ${outHigh} st acima do confortável` : " · dentro do confortável"),
      alarm: st.max_midi > s.stretch_high,
    },
    {
      k: "Mais grave",
      v: st.min_note,
      f: `aos ${fmtTime(st.min_at)}` + (outLow ? ` · ${outLow} st abaixo do confortável` : " · dentro do confortável"),
      alarm: st.min_midi < s.stretch_low,
    },
    {
      k: "Tom",
      v: st.key && st.key.name ? st.key.name : "—",
      f: st.key && st.key.name_pt ? st.key.name_pt : "",
    },
    {
      k: "Sobe",
      v: st.climb ? fmtSemitones(st.climb.delta) : "—",
      f: st.climb && st.climb.delta >= 2 ? "vai ficando mais aguda"
        : st.climb && st.climb.delta <= -2 ? "vai ficando mais grave" : "altura estável",
    },
  ];

  document.getElementById("song-stats").innerHTML = cells.map(c => `
    <div class="readout">
      <div class="k">${c.k}</div>
      <div class="v${c.alarm ? " alarm" : ""}">${c.v}</div>
      <div class="f">${c.f || ""}</div>
    </div>`).join("");
}

/* A leitura em texto do que os gráficos mostram — é o que responde
   "por que essa música é difícil pra mim?". */
function renderVerdict(st, s, d) {
  const notes = d.notes;
  let inComfort = 0, inStretch = 0, out = 0, total = 0;
  for (const n of notes) {
    const dur = n.t1 - n.t0;
    total += dur;
    const z = zoneOf(n.midi, s);
    if (z === "comfort") inComfort += dur;
    else if (z === "stretch") inStretch += dur;
    else out += dur;
  }
  const pct = v => Math.round((total ? v / total : 0) * 100);
  const curve = Charts.transposeCurve(notes, s);
  const best = curve.reduce((a, b) => (b.comfort > a.comfort ? b : a), curve[0]);
  const now = curve.find(c => c.shift === 0);

  const above = st.max_midi - s.comfort_high;
  const below = s.comfort_low - st.min_midi;

  // A manchete diz onde aperta. É a resposta que a pessoa veio buscar.
  let lead;
  if (above > 0 && below > 0) {
    lead = `Puxa <span class="hi">${above} semitons</span> acima e <span class="hi">${below}</span> abaixo do seu confortável.`;
  } else if (above > 0) {
    lead = `Pede <span class="hi">${above} semitons</span> acima do seu confortável.`;
  } else if (below > 0) {
    lead = `Desce <span class="hi">${below} semitons</span> abaixo do seu confortável.`;
  } else {
    lead = `Cabe <span class="ok">inteira</span> no seu confortável.`;
  }

  const lines = [];
  lines.push(`Do tempo cantado, <b>${pct(inComfort)}%</b> cai no confortável, <b>${pct(inStretch)}%</b> na esticada e <b>${pct(out)}%</b> fora do alcance.`);

  if (best.shift !== 0 && best.comfort - now.comfort > 0.05) {
    lines.push(`Transpondo <b>${best.shift > 0 ? "+" : ""}${best.shift} semitons</b>, o confortável sobe para <b>${Math.round(best.comfort * 100)}%</b>.`);
  } else {
    lines.push(`O tom original já é o melhor para a sua voz. Transpor não ajuda.`);
  }

  if (st.climb && st.climb.delta >= 2) {
    lines.push(`Sobe <b>${fmtSemitones(st.climb.delta)}</b> do início para o fim — o esforço se concentra no final.`);
  } else if (st.climb && st.climb.delta <= -2) {
    lines.push(`Desce <b>${fmtSemitones(st.climb.delta)}</b> do início para o fim — começa no ponto mais alto.`);
  }

  const longest = (st.demanding || [])[0];
  if (longest) {
    lines.push(`O agudo mais exposto é <b>${midiToName(longest.midi)}</b> aos <b>${fmtTime(longest.t0)}</b>.`);
  }

  document.getElementById("song-verdict").innerHTML =
    `<p class="verdict-lead">${lead}</p>` +
    `<ul class="verdict-notes">${lines.map(n => `<li>${n}</li>`).join("")}</ul>`;
}

function renderDemanding(st, s) {
  const rows = (st.demanding || []);
  const table = document.getElementById("demanding-table");
  if (!rows.length) {
    table.innerHTML = `<tbody><tr><td class="name" style="color:var(--text-muted)">Nada de excepcional — a música não tem agudos sustentados.</td></tr></tbody>`;
    return;
  }
  table.innerHTML =
    `<thead><tr><th>Momento</th><th>Nota</th><th>Duração</th><th>Situação para você</th><th></th></tr></thead><tbody>` +
    rows.map(r => {
      const z = zoneOf(r.midi, s);
      const color = z === "out" ? "var(--alert)" : z === "stretch" ? "var(--accent)" : "var(--text-secondary)";
      return `<tr>
        <td>${fmtTime(r.t0)}</td>
        <td>${midiToName(r.midi)} <span style="color:var(--text-muted)">${midiToNamePt(r.midi)}</span></td>
        <td>${(r.t1 - r.t0).toFixed(2)}s</td>
        <td class="name" style="color:${color}">${ZONE_LABEL[z]}</td>
        <td><button class="ghost" data-seek="${r.t0}">Ouvir</button></td>
      </tr>`;
    }).join("") + "</tbody>";

  table.querySelectorAll("[data-seek]").forEach(b => {
    b.addEventListener("click", () => {
      const t = parseFloat(b.dataset.seek);
      const audio = document.getElementById("player");
      audio.currentTime = Math.max(0, t - 1);
      audio.play();
      PianoRoll.focusOn(t, 6);
    });
  });
}

/* ---------------- Transposição e áudio ---------------- */

function setTranspose(v) {
  state.transpose = v;
  document.getElementById("transpose").value = v;
  document.getElementById("transpose-out").textContent = fmtSemitones(v).replace(".0", "");
  if (state.song) {
    const range = rollRange(state.song.stats, state.settings, v);
    PianoRoll.setRange(range);
    PianoRoll.setTranspose(v);
    drawHistogram();
    drawTransposeChart();
  }
}

document.getElementById("transpose").addEventListener("input", e => setTranspose(parseInt(e.target.value, 10)));
document.getElementById("zoom-in").addEventListener("click", () => PianoRoll.zoomBy(0.55));
document.getElementById("zoom-out").addEventListener("click", () => PianoRoll.zoomBy(1.8));
document.getElementById("zoom-fit").addEventListener("click", () => PianoRoll.resetView());

document.getElementById("transpose-best").addEventListener("click", e => {
  setTranspose(parseInt(e.currentTarget.dataset.shift || "0", 10));
});

const player = document.getElementById("player");
const playBtn = document.getElementById("play-btn");
playBtn.addEventListener("click", () => {
  if (player.paused) player.play(); else player.pause();
});
player.addEventListener("play", () => { playBtn.textContent = "❚❚ Pausar"; startTick(); });
player.addEventListener("pause", () => { playBtn.textContent = "▶ Tocar"; });
player.addEventListener("ended", () => { playBtn.textContent = "▶ Tocar"; });

let tickRAF = null;
function startTick() {
  if (tickRAF) cancelAnimationFrame(tickRAF);
  const step = () => {
    if (player.paused) { tickRAF = null; return; }
    PianoRoll.setPlayhead(player.currentTime);
    tickRAF = requestAnimationFrame(step);
  };
  tickRAF = requestAnimationFrame(step);
}

document.querySelectorAll("#audio-src button").forEach(b => {
  b.addEventListener("click", () => {
    state.audioSrc = b.dataset.src;
    document.querySelectorAll("#audio-src button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if (state.song) {
      const at = player.currentTime, wasPlaying = !player.paused;
      player.src = `/api/songs/${state.song.meta.id}/audio/${state.audioSrc}`;
      player.currentTime = at;
      if (wasPlaying) player.play();
    }
  });
});

document.querySelectorAll("#song-tag button").forEach(b => {
  b.addEventListener("click", async () => {
    if (!state.song) return;
    const tag = b.dataset.tag;
    await api("/songs/" + state.song.meta.id, { method: "PATCH", body: JSON.stringify({ tag }) });
    state.song.meta.tag = tag;
    document.querySelectorAll("#song-tag button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    await loadLibrary();
  });
});

document.getElementById("song-delete").addEventListener("click", async () => {
  if (!state.song) return;
  if (!confirm(`Excluir "${state.song.meta.title}" e todos os arquivos de áudio dela?`)) return;
  await api("/songs/" + state.song.meta.id, { method: "DELETE" });
  state.song = null;
  await loadLibrary();
  location.hash = "library";
});

/* ---------------- Nova análise ---------------- */

let sourceMode = "youtube", newTag = "neutral", doSeparate = true;

document.querySelectorAll("#source-mode button").forEach(b => {
  b.addEventListener("click", () => {
    sourceMode = b.dataset.mode;
    document.querySelectorAll("#source-mode button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    document.getElementById("field-url").hidden = sourceMode !== "youtube";
    document.getElementById("field-file").hidden = sourceMode !== "upload";
  });
});
document.querySelectorAll("#in-tag button").forEach(b => {
  b.addEventListener("click", () => {
    newTag = b.dataset.tag;
    document.querySelectorAll("#in-tag button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
});
document.querySelectorAll("#in-separate button").forEach(b => {
  b.addEventListener("click", () => {
    doSeparate = b.dataset.sep === "1";
    document.querySelectorAll("#in-separate button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
});

/* O campo aceita várias linhas. Uma linha = uma música; título e artista só
   fazem sentido quando é uma só, então somem quando vira lista. */
function queryLines() {
  return document.getElementById("in-url").value
    .split("\n").map(l => l.trim()).filter(Boolean);
}

function syncBatchUI() {
  const n = sourceMode === "upload"
    ? (document.getElementById("in-file").files || []).length
    : queryLines().length;
  const batch = n > 1;
  document.getElementById("single-only").hidden = batch || sourceMode === "upload";
  const note = document.getElementById("batch-note");
  note.hidden = !batch;
  if (batch) note.textContent = `${n} músicas na fila — os títulos vêm da fonte.`;
  document.getElementById("btn-analyze").textContent = batch ? `Analisar ${n}` : "Analisar";
}

document.getElementById("in-url").addEventListener("input", syncBatchUI);
document.getElementById("in-file").addEventListener("change", syncBatchUI);

document.getElementById("btn-analyze").addEventListener("click", async () => {
  const btn = document.getElementById("btn-analyze");
  btn.disabled = true;
  try {
    if (sourceMode === "youtube") {
      const lines = queryLines();
      if (!lines.length) { alert("Escreva ao menos uma música — link ou nome."); return; }

      if (lines.length === 1) {
        await enqueue({
          url: lines[0],
          title: document.getElementById("in-title").value.trim() || null,
          artist: document.getElementById("in-artist").value.trim() || null,
          tag: newTag, separate: doSeparate,
        });
      } else {
        const { jobs: created } = await api("/analyze/batch", {
          method: "POST",
          body: JSON.stringify({ queries: lines, tag: newTag, separate: doSeparate }),
        });
        for (const j of created) {
          state.jobs.set(j.job_id, { id: j.job_id, label: j.label, status: "queued", progress: [] });
        }
        renderJobs();
        pollQueue();
      }
      document.getElementById("in-url").value = "";
      document.getElementById("in-title").value = "";
      document.getElementById("in-artist").value = "";
    } else {
      const files = [...(document.getElementById("in-file").files || [])];
      if (!files.length) { alert("Escolha ao menos um arquivo de áudio."); return; }
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`falha ao enviar ${f.name}`);
        const up = await res.json();
        await enqueue({
          file_path: up.file_path,
          title: files.length === 1
            ? (document.getElementById("in-title").value.trim() || up.title)
            : up.title,
          artist: files.length === 1 ? (document.getElementById("in-artist").value.trim() || null) : null,
          tag: newTag, separate: doSeparate,
        });
      }
      document.getElementById("in-file").value = "";
    }
    syncBatchUI();
  } catch (e) {
    alert("Não consegui enfileirar: " + e.message);
  } finally {
    btn.disabled = false;
  }
});

async function enqueue(body) {
  const { job_id } = await api("/analyze", { method: "POST", body: JSON.stringify(body) });
  state.jobs.set(job_id, {
    id: job_id, label: body.title || body.url || "análise", status: "queued", progress: [],
  });
  renderJobs();
  pollQueue();
}

/* Um único polling para a fila inteira, em vez de um por job: com 20 músicas
   enfileiradas, vinte timers seriam vinte requisições por segundo. */
let queueTimer = null;
async function pollQueue() {
  if (queueTimer) return;
  const tick = async () => {
    let live = 0;
    try {
      const { jobs: all } = await api("/jobs");
      for (const j of all) state.jobs.set(j.id, j);
      live = all.filter(j => j.status === "queued" || j.status === "running").length;
      const finished = all.filter(j => j.status === "done" && !j._seen);
      for (const j of finished) {
        j._seen = true;
        state.jobs.set(j.id, j);
      }
      if (finished.length) { await loadLibrary(); renderLibrary(); }
      renderJobs();
    } catch { live = 1; }
    if (live > 0) {
      queueTimer = setTimeout(tick, 1500);
    } else {
      queueTimer = null;
    }
  };
  queueTimer = setTimeout(tick, 200);
}

async function cancelJob(id) {
  try {
    const r = await api("/jobs/" + id, { method: "DELETE" });
    if (r.outcome === "stopping") {
      const j = state.jobs.get(id);
      if (j) j.progress = [...(j.progress || []), { message: "parando ao fim da etapa atual" }];
    }
    pollQueue();
    renderJobs();
  } catch (e) {
    alert("Não consegui cancelar: " + e.message);
  }
}

const JOB_STATUS = {
  queued: "na fila", running: "processando", done: "concluída",
  error: "erro", cancelled: "cancelada",
};

function renderJobs() {
  const host = document.getElementById("jobs");
  const jobs = [...state.jobs.values()].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  const wrap = document.getElementById("jobs-wrap");
  wrap.hidden = jobs.length === 0;
  if (!jobs.length) { host.innerHTML = ""; return; }

  const live = jobs.filter(j => j.status === "queued" || j.status === "running");
  const count = st => jobs.filter(j => j.status === st).length;

  const summary = [
    count("running") ? "1 processando" : null,
    count("queued") ? `${count("queued")} esperando` : null,
    count("done") ? `${count("done")} concluída${count("done") > 1 ? "s" : ""}` : null,
    count("error") ? `${count("error")} com erro` : null,
    count("cancelled") ? `${count("cancelled")} cancelada${count("cancelled") > 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ") || "fila vazia";
  document.getElementById("queue-summary").textContent = summary;
  document.getElementById("btn-clear-jobs").hidden = jobs.length === live.length;

  host.innerHTML = jobs.map(j => {
    const running = j.status === "running";
    const queued = j.status === "queued";
    const lines = (j.progress || []).slice(-4)
      .map(p => `<div>${escapeHtml(p.message)}</div>`).join("");
    const marker = running
      ? '<div class="spinner"></div>'
      : `<span class="job-mark ${j.status}">${queued ? j.queue_position ?? "·" : ""}</span>`;
    const body = j.status === "error"
      ? `<div class="job-log err">${escapeHtml(j.error || "")}</div>`
      : queued
        ? ""
        : `<div class="job-log">${lines}</div>`;
    const link = j.status === "done" && j.result && j.result.id
      ? `<button class="ghost" data-open="${j.result.id}">Abrir</button>` : "";
    const stop = (running || queued)
      ? `<button class="ghost" data-cancel="${j.id}">${running ? "Parar" : "Tirar da fila"}</button>` : "";
    return `<div class="job ${j.status}">
      <div class="job-head">
        ${marker}
        <span class="job-title">${escapeHtml(j.label || "análise")}</span>
        <span class="job-status">${JOB_STATUS[j.status] || j.status}</span>
        ${link}${stop}
      </div>
      ${body}
    </div>`;
  }).join("");

  host.querySelectorAll("[data-cancel]").forEach(b =>
    b.addEventListener("click", () => cancelJob(b.dataset.cancel)));
  host.querySelectorAll("[data-open]").forEach(b =>
    b.addEventListener("click", () => { location.hash = "song/" + b.dataset.open; }));
}

document.getElementById("btn-clear-jobs").addEventListener("click", async () => {
  await api("/jobs/clear", { method: "POST" });
  for (const [id, j] of [...state.jobs]) {
    if (j.status !== "queued" && j.status !== "running") state.jobs.delete(id);
  }
  renderJobs();
});

/* ---------------- Meu alcance ---------------- */

const rangeFields = {
  comfort_low: "set-comfort-low",
  comfort_high: "set-comfort-high",
  stretch_low: "set-stretch-low",
  stretch_high: "set-stretch-high",
};

function renderRangeView() {
  const s = state.settings;
  if (!s) return;
  for (const [key, id] of Object.entries(rangeFields)) {
    const el = document.getElementById(id);
    if (document.activeElement !== el) el.value = midiToName(s[key]);
  }
  Charts.rangePreview(document.getElementById("range-preview"), s);
  renderSuggestion();
}

Object.values(rangeFields).forEach(id => {
  document.getElementById(id).addEventListener("input", () => {
    const draft = draftSettings();
    if (draft) Charts.rangePreview(document.getElementById("range-preview"), draft);
  });
});

function draftSettings() {
  const out = { ...state.settings };
  for (const [key, id] of Object.entries(rangeFields)) {
    const m = nameToMidi(document.getElementById(id).value);
    if (m === null) return null;
    out[key] = m;
  }
  if (out.comfort_low >= out.comfort_high) return null;
  if (out.stretch_low > out.comfort_low || out.stretch_high < out.comfort_high) return null;
  return out;
}

document.getElementById("btn-save-range").addEventListener("click", async () => {
  const draft = draftSettings();
  const msg = document.getElementById("range-saved");
  if (!draft) {
    msg.textContent = "Confira as notas: a extensão precisa englobar o confortável (ex.: A2 · C3 · E4 · A4).";
    msg.style.color = "var(--alert)";
    return;
  }
  state.settings = await api("/settings", { method: "PUT", body: JSON.stringify(draft) });
  msg.textContent = "Alcance salvo.";
  msg.style.color = "var(--text-muted)";
  drawRail();
  renderRangeView();
  renderLibrary();
  if (state.song) { PianoRoll.setSettings(state.settings); renderSong(); }
  setTimeout(() => { msg.textContent = ""; }, 2500);
});

/* Estimativa do alcance a partir do que o usuário já classificou como
   confortável: o confortável é a interseção, a extensão é a união. */
function renderSuggestion() {
  const host = document.getElementById("range-suggestion");
  const easy = state.songs.filter(s => s.tag === "comfortable" && typeof s.min_midi === "number");
  if (!easy.length) {
    host.innerHTML = `<div class="empty">Marque ao menos uma música como confortável e eu estimo seu alcance a partir dela.</div>`;
    return;
  }
  const low = Math.round(easy.reduce((a, s) => a + s.core_low, 0) / easy.length);
  const high = Math.round(easy.reduce((a, s) => a + s.core_high, 0) / easy.length);
  const absLow = Math.min(...easy.map(s => s.min_midi));
  const absHigh = Math.max(...easy.map(s => s.max_midi));

  host.innerHTML = `
    <p class="suggestion">
      Em <b>${easy.length}</b> música${easy.length > 1 ? "s" : ""} que você marcou como confortável,
      o núcleo fica entre <b>${midiToName(low)}</b> e <b>${midiToName(high)}</b>,
      e os extremos vão de <b>${midiToName(absLow)}</b> a <b>${midiToName(absHigh)}</b>.
    </p>
    <button class="ghost" id="apply-suggestion">Usar esses valores</button>`;

  document.getElementById("apply-suggestion").addEventListener("click", () => {
    document.getElementById("set-comfort-low").value = midiToName(low);
    document.getElementById("set-comfort-high").value = midiToName(high);
    document.getElementById("set-stretch-low").value = midiToName(Math.min(absLow, low - 3));
    document.getElementById("set-stretch-high").value = midiToName(Math.max(absHigh, high + 3));
    Charts.rangePreview(document.getElementById("range-preview"), draftSettings() || state.settings);
  });
}

/* ---------------- Início ---------------- */

window.addEventListener("resize", () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => {
    PianoRoll.render();
    if (state.song) { drawHistogram(); drawTransposeChart(); Charts.profileChart(document.getElementById("profile-chart"), state.song.stats.profile, state.settings, document.getElementById("profile-legend")); }
    renderLibrary();
    renderRangeView();
  }, 150);
});

(async function start() {
  PianoRoll.init(document.getElementById("roll"), {
    onSeek: t => {
      player.currentTime = Math.max(0, t);
      PianoRoll.setPlayhead(t);
    },
  });

  try {
    const health = await api("/health");
    document.getElementById("demucs-note").textContent = health.demucs
      ? "Demucs disponível — a separação do vocal roda na GPU do seu Mac (MPS) e leva alguns minutos por música."
      : "Demucs não está instalado: a análise vai usar a mixagem completa, o que confunde o detector com a melodia dos instrumentos.";
  } catch {}

  state.settings = await api("/settings");
  await loadLibrary();
  drawRail();

  // Retoma a fila que já estava rodando quando a página foi recarregada.
  try {
    const { jobs } = await api("/jobs");
    for (const j of jobs) state.jobs.set(j.id, j);
    if (jobs.length) { renderJobs(); pollQueue(); }
  } catch {}

  syncBatchUI();

  setTranspose(0);
  route();
})();
