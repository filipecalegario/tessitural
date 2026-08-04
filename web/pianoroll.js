/* Piano roll estilo Melodyne, em canvas.

   Eixo Y = altura (um semitom por linha), eixo X = tempo.
   A faixa sombreada é o alcance do cantor: a posição vertical de cada nota já
   diz se ela cabe ou não — a cor apenas reforça, destacando o que estoura. */

const PianoRoll = (() => {
  const GUTTER = 58;   // teclado à esquerda
  const AXIS_H = 24;   // régua de tempo embaixo
  const PAD_T = 8;

  let canvas, ctx, tooltipHost;
  let data = null;      // { notes, contour, duration }
  let settings = null;
  let lowMidi = 48, highMidi = 72;
  let view = { t0: 0, t1: 1 };
  let transpose = 0;
  let playhead = null;
  let hitRects = [];
  let onSeek = null;
  let drag = null;
  let reveal = 1;       // 0→1: as notas entram da esquerda, como a música tocando
  let revealRAF = null;
  let cssHeight = 460;  // altura em pixels de CSS, fixa — ver render()

  function init(canvasEl, opts = {}) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    onSeek = opts.onSeek || null;
    cssHeight = parseInt(canvasEl.getAttribute("height"), 10) || 460;

    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseleave", () => { Tooltip.hide(); });
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleDown);
    window.addEventListener("mouseup", () => { drag = null; });
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("resize", () => render());
  }

  function setData(payload, cfg, range) {
    data = payload;
    settings = cfg;
    lowMidi = range.low;
    highMidi = range.high;
    view = { t0: 0, t1: payload.duration || 1 };
    transpose = 0;
    playhead = null;
    startReveal();
  }

  /* Um único momento de movimento em toda a interface: ao abrir uma música,
     as notas aparecem no sentido do tempo. Quem pediu menos movimento no
     sistema recebe o desenho pronto. */
  function startReveal() {
    if (revealRAF) cancelAnimationFrame(revealRAF);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reveal = 1;
      render();
      return;
    }
    reveal = 0;
    const t0 = performance.now();
    const DUR = 620;
    const step = now => {
      const k = Math.min(1, (now - t0) / DUR);
      reveal = 1 - Math.pow(1 - k, 3);   // desacelera no fim
      render();
      revealRAF = k < 1 ? requestAnimationFrame(step) : null;
    };
    revealRAF = requestAnimationFrame(step);
  }

  function setTranspose(v) { transpose = v; render(); }
  function setRange(range) { lowMidi = range.low; highMidi = range.high; render(); }
  function setSettings(cfg) { settings = cfg; render(); }
  function setPlayhead(t) { playhead = t; render(); }
  function getRange() { return { low: lowMidi, high: highMidi }; }
  function resetView() {
    if (data) view = { t0: 0, t1: data.duration || 1 };
    render();
  }

  /* ---- geometria ---- */

  function plot() {
    // Sempre em pixels de CSS. Ler canvas.width/height aqui traria o bitmap
    // já multiplicado pelo dpr e desalinharia tudo.
    const w = canvas.clientWidth || 800;
    const h = cssHeight;
    return { x: GUTTER, y: PAD_T, w: w - GUTTER, h: h - PAD_T - AXIS_H, W: w, H: h };
  }

  function rowCount() { return highMidi - lowMidi + 1; }
  function rowH() { return plot().h / rowCount(); }

  // Uma nota MIDI ocupa a linha [yTop, yTop + rowH). O centro fica em midi + 0.5.
  function midiToY(m) {
    const p = plot();
    return p.y + (highMidi + 1 - m) * (p.h / rowCount());
  }

  function timeToX(t) {
    const p = plot();
    return p.x + ((t - view.t0) / (view.t1 - view.t0)) * p.w;
  }

  function xToTime(x) {
    const p = plot();
    return view.t0 + ((x - p.x) / p.w) * (view.t1 - view.t0);
  }

  function yToMidi(y) {
    const p = plot();
    return highMidi + 1 - (y - p.y) / (p.h / rowCount());
  }

  /* ---- render ---- */

  function render() {
    if (!canvas || !data) return;
    // A altura vem de `cssHeight`, NUNCA do atributo `height` do canvas.
    // Escrever em canvas.height reflete no atributo, então lê-lo de volta e
    // multiplicar pelo dpr outra vez faz o bitmap dobrar a cada quadro: em tela
    // Retina isso chegava a milhões de pixels de altura e derrubava a aba.
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = cssHeight;
    canvas.style.height = h + "px";
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const p = plot();
    const rh = rowH();
    const C = {
      surface: cssVar("--surface-1"),
      grid: cssVar("--grid"),
      axis: cssVar("--axis"),
      muted: cssVar("--text-muted"),
      secondary: cssVar("--text-secondary"),
      primary: cssVar("--text-primary"),
      accent: cssVar("--accent"),
      accentSoft: cssVar("--accent-soft"),
      alert: cssVar("--alert"),
      plane: cssVar("--plane"),
      keyShade: cssVar("--key-shade"),
      zoneComfort: cssVar("--zone-comfort"),
      zoneStretch: cssVar("--zone-stretch"),
      lamp: cssVar("--lamp"),
    };

    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, w, h);

    // Ordem importa: as faixas do cantor são o chão (superfícies opacas), e as
    // teclas pretas são uma sombra por cima delas — não o contrário.
    drawZones(p, C);
    drawRows(p, rh, C);
    drawTimeGrid(p, C);
    drawContour(p, C);
    drawNotes(p, rh, C);
    drawPlayhead(p, C);
    drawKeyboard(p, rh, C);
    drawTimeAxis(p, C);
  }

  function drawRows(p, rh, C) {
    // Linhas de tecla preta levemente rebaixadas dão a leitura de "teclado deitado".
    for (let m = lowMidi; m <= highMidi; m++) {
      if (!isBlackKey(m)) continue;
      ctx.fillStyle = C.keyShade;
      ctx.fillRect(p.x, midiToY(m + 1), p.w, rh);
    }
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let m = lowMidi; m <= highMidi + 1; m++) {
      if (m % 12 !== 0) continue; // só as oitavas, para não poluir
      const y = Math.round(midiToY(m)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
    }
  }

  function drawZones(p, C) {
    if (!settings) return;
    const band = (lo, hi, fill) => {
      const yTop = midiToY(Math.min(hi + 1, highMidi + 1));
      const yBot = midiToY(Math.max(lo, lowMidi));
      ctx.fillStyle = fill;
      ctx.fillRect(p.x, yTop, p.w, yBot - yTop);
    };
    // Penumbra da extensão primeiro, faixa acesa do confortável por cima.
    band(settings.stretch_low, settings.stretch_high, C.zoneStretch);
    band(settings.comfort_low, settings.comfort_high, C.zoneComfort);

    // Fio firme marcando onde o confortável termina — é a fronteira que importa.
    ctx.save();
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    for (const m of [settings.comfort_low, settings.comfort_high + 1]) {
      const y = Math.round(midiToY(m)) + 0.5;
      if (y < p.y || y > p.y + p.h) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
    }
    ctx.restore();

    // Sem rótulo dentro do gráfico: a régua no cabeçalho, a legenda e a própria
    // faixa acesa já dizem o que ela é, e um texto aqui cairia sobre as notas.
  }

  function drawTimeGrid(p, C) {
    const span = view.t1 - view.t0;
    const step = niceTimeStep(span, p.w);
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
      const x = Math.round(timeToX(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, p.y);
      ctx.lineTo(x, p.y + p.h);
      ctx.stroke();
    }
  }

  function niceTimeStep(span, width) {
    const target = span / Math.max(3, width / 90);
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    for (const s of steps) if (s >= target) return s;
    return 600;
  }

  function drawContour(p, C) {
    if (!data.contour || !data.contour.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.strokeStyle = C.muted;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let pen = false;
    ctx.beginPath();
    for (const [t, m] of data.contour) {
      if (m === null) { pen = false; continue; }
      if (t < view.t0 - 1 || t > view.t1 + 1) { pen = false; continue; }
      const x = timeToX(t);
      const y = midiToY(m + transpose + 0.5);
      if (!pen) { ctx.moveTo(x, y); pen = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawNotes(p, rh, C) {
    hitRects = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();

    // 2px de folga na superfície separam linhas vizinhas sem desenhar borda.
    const barH = Math.max(2, rh - 2);
    const radius = Math.min(3, barH / 2);

    const revealUntil = view.t0 + (view.t1 - view.t0) * reveal;

    for (const n of data.notes) {
      if (n.t1 < view.t0 || n.t0 > view.t1) continue;
      if (reveal < 1 && n.t0 > revealUntil) continue;
      const m = n.midi + transpose;
      if (m < lowMidi - 1 || m > highMidi + 1) continue;

      const x0 = timeToX(n.t0);
      const x1 = timeToX(n.t1);
      const wpx = Math.max(2, x1 - x0);
      const y = midiToY(m + 1) + (rh - barH) / 2;

      const zone = zoneOf(m, settings);
      ctx.fillStyle = zone === "out" ? C.alert : zone === "stretch" ? C.accentSoft : C.accent;
      roundRect(x0, y, wpx, barH, radius);
      ctx.fill();

      hitRects.push({ x: x0, y, w: wpx, h: barH, note: n, midi: m, zone });
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawPlayhead(p, C) {
    if (playhead === null || playhead < view.t0 || playhead > view.t1) return;
    const x = Math.round(timeToX(playhead)) + 0.5;
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, p.y);
    ctx.lineTo(x, p.y + p.h);
    ctx.stroke();
    ctx.fillStyle = C.primary;
    ctx.beginPath();
    ctx.moveTo(x - 4, p.y);
    ctx.lineTo(x + 4, p.y);
    ctx.lineTo(x, p.y + 5);
    ctx.closePath();
    ctx.fill();
  }

  function drawKeyboard(p, rh, C) {
    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, GUTTER, p.H);

    const showEveryNote = rh >= 15;
    for (let m = lowMidi; m <= highMidi; m++) {
      const y = midiToY(m + 1);
      const black = isBlackKey(m);
      ctx.fillStyle = black ? C.plane : C.surface;
      ctx.fillRect(black ? GUTTER - 22 : 0, y + 0.5, black ? 22 : GUTTER, Math.max(1, rh - 1));
      if (!black) {
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(GUTTER, Math.round(y) + 0.5);
        ctx.stroke();
      }
      const isC = ((m % 12) + 12) % 12 === 0;
      if ((isC || showEveryNote) && !black && rh >= 8) {
        ctx.fillStyle = isC ? C.secondary : C.muted;
        ctx.font = (isC ? "600 " : "400 ") + Math.min(10, rh * 0.7) + "px " + cssVar("--mono");
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(midiToName(m), 5, y + rh / 2);
      }
    }
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GUTTER + 0.5, 0);
    ctx.lineTo(GUTTER + 0.5, p.H);
    ctx.stroke();
  }

  function drawTimeAxis(p, C) {
    const y = p.y + p.h;
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, y + 0.5);
    ctx.lineTo(p.x + p.w, y + 0.5);
    ctx.stroke();

    const step = niceTimeStep(view.t1 - view.t0, p.w);
    ctx.fillStyle = C.muted;
    ctx.font = "400 10px " + cssVar("--mono");
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let t = Math.ceil(view.t0 / step) * step; t <= view.t1; t += step) {
      const x = timeToX(t);
      if (x < p.x + 12 || x > p.x + p.w - 12) continue;
      ctx.fillText(fmtTime(t), x, y + 6);
    }
  }

  /* ---- interação ---- */

  function localPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  function handleMove(ev) {
    const { x, y } = localPos(ev);
    const p = plot();
    if (x < p.x || y < p.y || y > p.y + p.h) { Tooltip.hide(); return; }

    // Procura de trás para frente: as últimas desenhadas ficam por cima.
    let hit = null;
    for (let i = hitRects.length - 1; i >= 0; i--) {
      const r = hitRects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h + 1) { hit = r; break; }
    }

    if (hit) {
      const n = hit.note;
      const cents = Math.round(n.cents);
      Tooltip.show(
        `<div class="tt-title">${midiToName(hit.midi)} · ${midiToNamePt(hit.midi)}</div>` +
        `<div class="tt-row"><span>momento</span><b>${fmtTime(n.t0)}</b></div>` +
        `<div class="tt-row"><span>duração</span><b>${n.dur ? n.dur.toFixed(2) : (n.t1 - n.t0).toFixed(2)}s</b></div>` +
        `<div class="tt-row"><span>afinação</span><b>${cents > 0 ? "+" : ""}${cents} cents</b></div>` +
        `<div class="tt-row"><span>alcance</span><b>${ZONE_LABEL[hit.zone]}</b></div>`,
        ev.clientX, ev.clientY
      );
    } else {
      const m = Math.floor(yToMidi(y));
      Tooltip.show(
        `<div class="tt-title">${midiToName(m)} · ${midiToNamePt(m)}</div>` +
        `<div class="tt-row"><span>tempo</span><b>${fmtTime(xToTime(x))}</b></div>`,
        ev.clientX, ev.clientY
      );
    }
  }

  function handleDown(ev) {
    const { x, y } = localPos(ev);
    const p = plot();
    if (x < p.x) return;
    if (ev.shiftKey) {
      drag = { startX: x, t0: view.t0, t1: view.t1 };
      return;
    }
    if (onSeek) onSeek(Math.max(0, xToTime(x)));
  }

  function handleDragMove(ev) {
    if (!drag) return;
    const { x } = localPos(ev);
    const p = plot();
    const span = drag.t1 - drag.t0;
    const shift = ((drag.startX - x) / p.w) * span;
    let t0 = drag.t0 + shift;
    let t1 = drag.t1 + shift;
    const dur = data.duration;
    if (t0 < 0) { t1 -= t0; t0 = 0; }
    if (t1 > dur) { t0 -= t1 - dur; t1 = dur; if (t0 < 0) t0 = 0; }
    view = { t0, t1 };
    render();
  }

  /* Aproxima em torno de um instante, mantendo-o parado sob o cursor. */
  function applyZoom(anchor, factor) {
    if (!data) return;
    const dur = data.duration || 1;
    const frac = (anchor - view.t0) / (view.t1 - view.t0);
    let span = Math.min(dur, Math.max(1.5, (view.t1 - view.t0) * factor));
    let t0 = anchor - frac * span;
    let t1 = t0 + span;
    if (t0 < 0) { t0 = 0; t1 = span; }
    if (t1 > dur) { t1 = dur; t0 = Math.max(0, dur - span); }
    view = { t0, t1 };
    render();
  }

  function zoomBy(factor) {
    if (!data) return;
    // Sem cursor envolvido, ancora no que estiver tocando; senão, no centro.
    const anchor = playhead !== null && playhead >= view.t0 && playhead <= view.t1
      ? playhead : (view.t0 + view.t1) / 2;
    applyZoom(anchor, factor);
  }

  function handleWheel(ev) {
    // Rolar a página é da página. O zoom fica no gesto de pinça — que o macOS
    // entrega como wheel com ctrlKey — e nos modificadores. Sequestrar toda
    // rolagem sobre o gráfico prendia a pessoa no meio da tela.
    if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) return;
    ev.preventDefault();
    const { x } = localPos(ev);
    const p = plot();
    if (x < p.x) return;
    applyZoom(xToTime(x), Math.exp(ev.deltaY * 0.0015));
  }

  function focusOn(t, pad = 4) {
    if (!data) return;
    const span = Math.min(data.duration, Math.max(8, pad * 2));
    let t0 = Math.max(0, t - span / 2);
    let t1 = Math.min(data.duration, t0 + span);
    t0 = Math.max(0, t1 - span);
    view = { t0, t1 };
    render();
  }

  return { init, setData, setTranspose, setRange, setSettings, setPlayhead, render,
           resetView, getRange, focusOn, zoomBy };
})();
