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

  function init(canvasEl, opts = {}) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    onSeek = opts.onSeek || null;

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
    render();
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
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
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
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = parseInt(canvas.getAttribute("height"), 10) || 440;
    canvas.style.height = h + "px";
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
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
      accentWash: cssVar("--accent-wash"),
      alert: cssVar("--alert"),
      alertWash: cssVar("--alert-wash"),
      plane: cssVar("--plane"),
    };

    ctx.fillStyle = C.surface;
    ctx.fillRect(0, 0, w, h);

    drawRows(p, rh, C);
    drawZones(p, C);
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
      ctx.fillStyle = C.plane;
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
    // Esticada primeiro (mais larga), confortável por cima (mais forte).
    band(settings.stretch_low, settings.stretch_high, C.accentWash);
    band(settings.comfort_low, settings.comfort_high, C.accentWash);

    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = C.accent;
    ctx.globalAlpha = 0.55;
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

    // Rótulo da faixa, encostado à direita para não competir com as notas.
    ctx.save();
    ctx.font = "500 10.5px " + cssVar("--font");
    ctx.fillStyle = C.accent;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    const yTop = midiToY(settings.comfort_high + 1);
    if (yTop > p.y && yTop < p.y + p.h - 12) {
      ctx.fillText("meu confortável", p.x + p.w - 8, yTop + 3);
    }
    ctx.restore();
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
    ctx.strokeStyle = C.secondary;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.25;
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

    for (const n of data.notes) {
      if (n.t1 < view.t0 || n.t0 > view.t1) continue;
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
      ctx.fillStyle = black ? C.axis : C.surface;
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
        ctx.font = (isC ? "600 " : "400 ") + Math.min(10.5, rh * 0.72) + "px " + cssVar("--font");
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
    ctx.font = "400 10.5px " + cssVar("--font");
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

  function handleWheel(ev) {
    ev.preventDefault();
    const { x } = localPos(ev);
    const p = plot();
    if (x < p.x) return;
    const anchor = xToTime(x);
    const factor = Math.exp(ev.deltaY * 0.0015);
    const dur = data.duration;
    let span = (view.t1 - view.t0) * factor;
    span = Math.min(dur, Math.max(1.5, span));
    const frac = (anchor - view.t0) / (view.t1 - view.t0);
    let t0 = anchor - frac * span;
    let t1 = t0 + span;
    if (t0 < 0) { t0 = 0; t1 = span; }
    if (t1 > dur) { t1 = dur; t0 = Math.max(0, dur - span); }
    view = { t0, t1 };
    render();
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

  return { init, setData, setTranspose, setRange, setSettings, setPlayhead, render, resetView, getRange, focusOn };
})();
