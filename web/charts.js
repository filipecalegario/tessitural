/* Gráficos em SVG.

   Convenção de cor em todo o app:
     azul     = a voz, o contexto normal
     vermelho = o que estoura o alcance do cantor
     cinza    = sem classificação / de-ênfase
   A posição no eixo de altura já carrega o sentido; a cor reforça. */

const Charts = (() => {

  const PITCH_PAD = 2;

  function pitchTicks(low, high) {
    const out = [];
    for (let m = Math.ceil(low / 12) * 12; m <= high; m += 12) out.push(m);
    if (out.length < 2) {
      for (let m = Math.ceil(low / 6) * 6; m <= high; m += 6) out.push(m);
    }
    return out;
  }

  function legend(el, items) {
    clearEl(el);
    for (const it of items) {
      const span = document.createElement("span");
      span.className = "item";
      const sw = document.createElement("span");
      sw.className = "swatch" + (it.line ? " line" : "");
      sw.style.background = it.color;
      if (it.hollow) {
        sw.style.background = "transparent";
        sw.style.border = "2px solid " + it.color;
      }
      // Superfícies quase somem contra o painel: um contorno as torna visíveis.
      if (it.outline) sw.style.boxShadow = "inset 0 0 0 1px var(--rule-firm)";
      span.appendChild(sw);
      span.appendChild(document.createTextNode(it.label));
      el.appendChild(span);
    }
  }

  /* =========================================================
     Régua de registro — permanente no cabeçalho

     Sua voz é desenhada como superfície (uma faixa acesa), não como cor:
     é o chão contra o qual as músicas são medidas. A música aberta se
     sobrepõe como tinta — azul o que alcança, coral o que estoura.
     ========================================================= */

  const RAIL_LO = 36;   // C2
  const RAIL_HI = 84;   // C6

  function registerRail(svg, settings, song) {
    clearEl(svg);
    const width = +svg.getAttribute("width") || 300;
    const height = +svg.getAttribute("height") || 30;
    const KEY_TOP = 11, KEY_H = height - KEY_TOP - 1;

    const X = m => ((m - RAIL_LO) / (RAIL_HI - RAIL_LO + 1)) * width;

    // Chão: penumbra da extensão, depois a faixa acesa do confortável.
    const slab = (lo, hi, fill) => svg.appendChild(svgEl("rect", {
      x: X(Math.max(lo, RAIL_LO)), y: KEY_TOP,
      width: Math.max(1, X(Math.min(hi, RAIL_HI) + 1) - X(Math.max(lo, RAIL_LO))),
      height: KEY_H, fill,
    }));
    svg.appendChild(svgEl("rect", { x: 0, y: KEY_TOP, width, height: KEY_H, fill: cssVar("--ink") }));
    slab(settings.stretch_low, settings.stretch_high, cssVar("--lit-soft"));
    slab(settings.comfort_low, settings.comfort_high, cssVar("--lit"));

    // Teclas pretas como sombra fina — dão endereço à régua sem virar ruído.
    for (let m = RAIL_LO; m <= RAIL_HI; m++) {
      if (!isBlackKey(m)) continue;
      svg.appendChild(svgEl("rect", {
        x: X(m) + 0.5, y: KEY_TOP, width: Math.max(1, X(m + 1) - X(m) - 1),
        height: KEY_H * 0.55, fill: cssVar("--key-shade"),
      }));
    }
    for (let m = Math.ceil(RAIL_LO / 12) * 12; m <= RAIL_HI; m += 12) {
      svg.appendChild(svgEl("line", {
        x1: X(m), y1: KEY_TOP, x2: X(m), y2: KEY_TOP + KEY_H,
        stroke: cssVar("--rule-firm"), "stroke-width": 1,
      }));
    }

    if (!song || typeof song.min_midi !== "number") return;

    // Tinta: a música aberta, sobreposta ao seu alcance.
    const lo = Math.max(song.min_midi, RAIL_LO), hi = Math.min(song.max_midi, RAIL_HI);
    svg.appendChild(svgEl("line", {
      x1: X(lo), y1: 4.5, x2: X(hi + 1), y2: 4.5,
      stroke: cssVar("--silk-3"), "stroke-width": 1,
    }));
    const seg = (a, b, fill) => {
      if (b < a) return;
      svg.appendChild(svgEl("rect", {
        x: X(a), y: 1, width: Math.max(1.5, X(b + 1) - X(a)), height: 7, fill,
      }));
    };
    // Reparte o núcleo pelo que cabe e pelo que estoura.
    const c0 = Math.round(song.core_low), c1 = Math.round(song.core_high);
    seg(Math.max(c0, settings.stretch_low), Math.min(c1, settings.stretch_high), cssVar("--voice"));
    if (c0 < settings.stretch_low) seg(c0, Math.min(c1, settings.stretch_low - 1), cssVar("--strain"));
    if (c1 > settings.stretch_high) seg(Math.max(c0, settings.stretch_high + 1), c1, cssVar("--strain"));
  }

  function tagColor(tag) {
    if (tag === "comfortable") return cssVar("--accent");
    if (tag === "hard") return cssVar("--alert");
    return cssVar("--neutral-mark");
  }

  const TAG_LABEL = { comfortable: "confortável", hard: "difícil", neutral: "sem classificação" };

  /* =========================================================
     Comparação da biblioteca — o gráfico que testa a hipótese
     ========================================================= */

  function rangeChart(svg, songs, settings, onPick) {
    clearEl(svg);
    if (!songs.length) return;

    const LABEL_W = 210;
    const END_PAD = 42;          // espaço para os rótulos de nota nas pontas
    const ROW_H = 38;            // duas linhas de rótulo precisam de ar
    const TOP = 28, BOTTOM = 10;

    let lo = Math.min(settings.stretch_low, ...songs.map(s => s.min_midi)) - PITCH_PAD;
    let hi = Math.max(settings.stretch_high, ...songs.map(s => s.max_midi)) + PITCH_PAD;

    const width = Math.max(720, availWidth(svg, 900));
    const height = TOP + songs.length * ROW_H + BOTTOM;
    const x0 = LABEL_W + END_PAD;
    const x1 = width - END_PAD;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const X = m => x0 + ((m - lo) / (hi - lo)) * (x1 - x0);

    // Faixas do cantor, atrás de tudo.
    const zoneG = svgEl("g");
    zoneG.appendChild(svgEl("rect", {
      x: X(settings.stretch_low), y: TOP - 6, width: X(settings.stretch_high + 1) - X(settings.stretch_low),
      height: height - TOP - BOTTOM + 6, fill: cssVar("--zone-stretch"),
    }));
    zoneG.appendChild(svgEl("rect", {
      x: X(settings.comfort_low), y: TOP - 6, width: X(settings.comfort_high + 1) - X(settings.comfort_low),
      height: height - TOP - BOTTOM + 6, fill: cssVar("--zone-comfort"),
    }));
    svg.appendChild(zoneG);

    // Eixo de altura.
    for (const m of pitchTicks(lo, hi)) {
      svg.appendChild(svgEl("line", { x1: X(m), y1: TOP - 6, x2: X(m), y2: height - BOTTOM, class: "tick-line" }));
      const t = svgEl("text", { x: X(m), y: TOP - 12, class: "tick", "text-anchor": "middle" });
      t.textContent = midiToName(m);
      svg.appendChild(t);
    }

    songs.forEach((s, i) => {
      const y = TOP + i * ROW_H + ROW_H / 2;
      const color = tagColor(s.tag);
      const g = svgEl("g");

      const bg = svgEl("rect", { x: 0, y: y - ROW_H / 2, width, height: ROW_H, fill: "transparent" });
      g.appendChild(bg);

      const label = svgEl("text", { x: 0, y: y - 3, class: "row-label" });
      label.textContent = s.title.length > 30 ? s.title.slice(0, 29) + "…" : s.title;
      g.appendChild(label);

      const sub = svgEl("text", { x: 0, y: y + 12, class: "row-sub" });
      sub.textContent = [s.artist, s.key ? "tom " + s.key : null, TAG_LABEL[s.tag]]
        .filter(Boolean).join(" · ").slice(0, 44);
      g.appendChild(sub);

      // Extremos absolutos: linha fina.
      g.appendChild(svgEl("line", {
        x1: X(s.min_midi), y1: y, x2: X(s.max_midi + 1), y2: y,
        stroke: color, "stroke-width": 1.5, "stroke-linecap": "round", opacity: 0.45,
      }));

      // Núcleo p5–p95: barra grossa, cantos arredondados.
      const cx0 = X(s.core_low), cx1 = X(s.core_high + 1);
      g.appendChild(svgEl("rect", {
        x: cx0, y: y - 6, width: Math.max(3, cx1 - cx0), height: 12, rx: 4, fill: color,
      }));

      // Mediana: ponto com anel na cor da superfície.
      g.appendChild(svgEl("circle", {
        cx: X(s.median_midi + 0.5), cy: y, r: 4.5,
        fill: color, stroke: cssVar("--surface-1"), "stroke-width": 2,
      }));

      // Rótulos diretos nas pontas — são justamente os extremos que interessam.
      const lmin = svgEl("text", { x: X(s.min_midi) - 7, y: y + 4, class: "value-label", "text-anchor": "end" });
      lmin.textContent = s.min_note;
      g.appendChild(lmin);
      const lmax = svgEl("text", { x: X(s.max_midi + 1) + 7, y: y + 4, class: "value-label" });
      lmax.textContent = s.max_note;
      g.appendChild(lmax);

      const outLow = s.min_midi < settings.stretch_low;
      const outHigh = s.max_midi > settings.stretch_high;
      if (outLow || outHigh) {
        lmin.setAttribute("fill", outLow ? cssVar("--alert") : cssVar("--text-secondary"));
        lmax.setAttribute("fill", outHigh ? cssVar("--alert") : cssVar("--text-secondary"));
      }

      const hit = svgEl("rect", { x: 0, y: y - ROW_H / 2, width, height: ROW_H, class: "hit" });
      hit.addEventListener("mousemove", ev => {
        bg.setAttribute("fill", cssVar("--plane"));
        Tooltip.show(tooltipForSong(s, settings), ev.clientX, ev.clientY);
      });
      hit.addEventListener("mouseleave", () => { bg.setAttribute("fill", "transparent"); Tooltip.hide(); });
      hit.addEventListener("click", () => onPick && onPick(s.id));
      g.appendChild(hit);

      svg.appendChild(g);
    });
  }

  function tooltipForSong(s, settings) {
    const below = Math.max(0, settings.comfort_low - s.min_midi);
    const above = Math.max(0, s.max_midi - settings.comfort_high);
    return `<div class="tt-title">${s.title}</div>` +
      (s.artist ? `<div class="tt-row"><span>${s.artist}</span></div>` : "") +
      `<div class="tt-row"><span>extremos</span><b>${s.min_note} – ${s.max_note}</b></div>` +
      `<div class="tt-row"><span>extensão</span><b>${s.range_semitones} semitons</b></div>` +
      `<div class="tt-row"><span>90% do tempo</span><b>${midiToName(s.core_low)} – ${midiToName(s.core_high)}</b></div>` +
      (s.key ? `<div class="tt-row"><span>tom</span><b>${s.key}</b></div>` : "") +
      (below ? `<div class="tt-row"><span>abaixo do confortável</span><b>${below} st</b></div>` : "") +
      (above ? `<div class="tt-row"><span>acima do confortável</span><b>${above} st</b></div>` : "");
  }

  /* =========================================================
     Histograma marginal — alinhado ao piano roll
     ========================================================= */

  function histChart(svg, histogram, settings, range, geom) {
    clearEl(svg);
    const width = Math.max(120, availWidth(svg, 180));
    const height = geom.height;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const plotTop = geom.padTop, plotH = height - geom.padTop - geom.padBottom;
    const rows = range.high - range.low + 1;
    const rowH = plotH / rows;
    const x0 = 14, x1 = width - 14;

    const vals = [];
    for (let m = range.low; m <= range.high; m++) vals.push(histogram[String(m)] || 0);
    const max = Math.max(0.001, ...vals);

    const title = svgEl("text", { x: x0, y: 12, class: "tick" });
    title.textContent = "segundos por nota";
    svg.appendChild(title);

    // Faixa confortável, para o histograma contar a mesma história do roll.
    const yFor = m => plotTop + (range.high + 1 - m) * rowH;
    svg.appendChild(svgEl("rect", {
      x: x0, y: yFor(Math.min(settings.comfort_high + 1, range.high + 1)),
      width: x1 - x0,
      height: Math.max(0, yFor(Math.max(settings.comfort_low, range.low)) - yFor(Math.min(settings.comfort_high + 1, range.high + 1))),
      fill: cssVar("--zone-comfort"),
    }));

    for (let m = range.low; m <= range.high; m++) {
      const v = histogram[String(m)] || 0;
      if (v <= 0) continue;
      const barH = Math.max(1.5, rowH - 2);
      const w = ((x1 - x0) * v) / max;
      const zone = zoneOf(m, settings);
      const r = svgEl("rect", {
        x: x0, y: yFor(m + 1) + (rowH - barH) / 2,
        width: Math.max(1.5, w), height: barH,
        rx: Math.min(3, barH / 2),
        fill: zone === "out" ? cssVar("--alert") : zone === "stretch" ? cssVar("--accent-soft") : cssVar("--accent"),
      });
      r.style.cursor = "default";
      r.addEventListener("mousemove", ev => Tooltip.show(
        `<div class="tt-title">${midiToName(m)} · ${midiToNamePt(m)}</div>` +
        `<div class="tt-row"><span>cantado por</span><b>${v.toFixed(1)}s</b></div>` +
        `<div class="tt-row"><span>alcance</span><b>${ZONE_LABEL[zone]}</b></div>`,
        ev.clientX, ev.clientY));
      r.addEventListener("mouseleave", Tooltip.hide);
      svg.appendChild(r);
    }

    svg.appendChild(svgEl("line", {
      x1: x0, y1: plotTop, x2: x0, y2: plotTop + plotH, class: "axis-line",
    }));
  }

  /* =========================================================
     Perfil temporal — "a música sobe?"
     ========================================================= */

  function profileChart(svg, profile, settings, legendEl) {
    clearEl(svg);
    if (!profile || profile.length < 2) {
      const t = svgEl("text", { x: 10, y: 30, class: "tick" });
      t.textContent = "Poucos dados vocais para traçar o perfil.";
      svg.appendChild(t);
      svg.setAttribute("height", 50);
      return;
    }

    const width = Math.max(320, availWidth(svg, 500));
    const height = 240;
    const L = 44, R = 54, T = 14, B = 28;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const lo = Math.min(settings.comfort_low, ...profile.map(p => p.median)) - PITCH_PAD;
    const hi = Math.max(settings.comfort_high, ...profile.map(p => p.p90)) + PITCH_PAD;
    const tMax = profile[profile.length - 1].t;

    const X = t => L + (t / tMax) * (width - L - R);
    const Y = m => T + (1 - (m - lo) / (hi - lo)) * (height - T - B);

    svg.appendChild(svgEl("rect", {
      x: L, y: Y(settings.comfort_high + 1), width: width - L - R,
      height: Math.max(0, Y(settings.comfort_low) - Y(settings.comfort_high + 1)),
      fill: cssVar("--zone-comfort"),
    }));

    for (const m of pitchTicks(lo, hi)) {
      svg.appendChild(svgEl("line", { x1: L, y1: Y(m), x2: width - R, y2: Y(m), class: "tick-line" }));
      const t = svgEl("text", { x: L - 8, y: Y(m) + 4, class: "tick", "text-anchor": "end" });
      t.textContent = midiToName(m);
      svg.appendChild(t);
    }
    for (let i = 0; i <= 4; i++) {
      const tv = (tMax * i) / 4;
      const t = svgEl("text", { x: X(tv), y: height - 8, class: "tick", "text-anchor": "middle" });
      t.textContent = fmtTime(tv);
      svg.appendChild(t);
    }
    svg.appendChild(svgEl("line", { x1: L, y1: height - B, x2: width - R, y2: height - B, class: "axis-line" }));

    // Ênfase: a mediana é o assunto, o teto é contexto em cinza.
    const path = (key, color, w = 2) => {
      const d = profile.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(" ");
      svg.appendChild(svgEl("path", {
        d, fill: "none", stroke: color, "stroke-width": w,
        "stroke-linejoin": "round", "stroke-linecap": "round",
      }));
      const last = profile[profile.length - 1];
      svg.appendChild(svgEl("circle", {
        cx: X(last.t), cy: Y(last[key]), r: 4,
        fill: color, stroke: cssVar("--surface-1"), "stroke-width": 2,
      }));
      const lab = svgEl("text", { x: X(last.t) + 9, y: Y(last[key]) + 4, class: "value-label" });
      lab.textContent = midiToName(last[key]);
      svg.appendChild(lab);
    };
    path("p90", cssVar("--series-2"), 1.5);
    path("median", cssVar("--accent"), 2);

    // Camada de hover: crosshair + tooltip com os dois valores.
    const cross = svgEl("line", {
      x1: 0, y1: T, x2: 0, y2: height - B, stroke: cssVar("--axis"), "stroke-width": 1, opacity: 0,
    });
    svg.appendChild(cross);
    const hit = svgEl("rect", { x: L, y: T, width: width - L - R, height: height - T - B, class: "hit" });
    hit.addEventListener("mousemove", ev => {
      const box = svg.getBoundingClientRect();
      const sx = ((ev.clientX - box.left) / box.width) * width;
      const t = ((sx - L) / (width - L - R)) * tMax;
      let best = profile[0];
      for (const p of profile) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
      cross.setAttribute("x1", X(best.t));
      cross.setAttribute("x2", X(best.t));
      cross.setAttribute("opacity", 1);
      Tooltip.show(
        `<div class="tt-title">${fmtTime(best.t)}</div>` +
        `<div class="tt-row"><span>altura mediana</span><b>${midiToName(best.median)}</b></div>` +
        `<div class="tt-row"><span>teto (p90)</span><b>${midiToName(best.p90)}</b></div>` +
        `<div class="tt-row"><span>nota mais alta</span><b>${midiToName(best.max)}</b></div>`,
        ev.clientX, ev.clientY);
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); Tooltip.hide(); });
    svg.appendChild(hit);

    if (legendEl) legend(legendEl, [
      { color: cssVar("--accent"), label: "altura mediana", line: true },
      { color: cssVar("--series-2"), label: "teto: 90% das notas abaixo", line: true },
    ]);
  }

  /* =========================================================
     Curva de transposição — ênfase no melhor tom
     ========================================================= */

  function transposeCurve(notes, settings) {
    const out = [];
    for (let shift = -12; shift <= 12; shift++) {
      let inComfort = 0, inStretch = 0, total = 0;
      for (const n of notes) {
        const dur = n.t1 - n.t0;
        const z = zoneOf(n.midi + shift, settings);
        total += dur;
        if (z === "comfort") inComfort += dur;
        else if (z === "stretch") inStretch += dur;
      }
      out.push({
        shift,
        comfort: total ? inComfort / total : 0,
        reachable: total ? (inComfort + inStretch) / total : 0,
      });
    }
    return out;
  }

  function transposeChart(svg, curve, current, onPick) {
    clearEl(svg);
    const width = Math.max(320, availWidth(svg, 500));
    const height = 240;
    const L = 40, R = 12, T = 26, B = 34;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const best = curve.reduce((a, b) => (b.comfort > a.comfort ? b : a), curve[0]);
    const plotW = width - L - R, plotH = height - T - B;
    const bandW = plotW / curve.length;
    const barW = Math.min(24, bandW - 2);

    for (let p = 0; p <= 100; p += 25) {
      const y = T + (1 - p / 100) * plotH;
      svg.appendChild(svgEl("line", { x1: L, y1: y, x2: width - R, y2: y, class: "tick-line" }));
      const t = svgEl("text", { x: L - 8, y: y + 4, class: "tick", "text-anchor": "end" });
      t.textContent = p + "%";
      svg.appendChild(t);
    }

    curve.forEach((c, i) => {
      const cx = L + i * bandW + bandW / 2;
      const h = c.comfort * plotH;
      const isBest = c.shift === best.shift;
      const isCurrent = c.shift === current;

      const rect = svgEl("rect", {
        x: cx - barW / 2, y: T + plotH - h, width: barW, height: Math.max(1, h),
        rx: Math.min(4, barW / 2),
        fill: isBest ? cssVar("--accent") : cssVar("--neutral-mark"),
      });
      svg.appendChild(rect);

      if (isCurrent && !isBest) {
        svg.appendChild(svgEl("rect", {
          x: cx - barW / 2 - 2, y: T + plotH - h - 2, width: barW + 4, height: Math.max(1, h) + 4,
          rx: 5, fill: "none", stroke: cssVar("--text-primary"), "stroke-width": 1.5,
        }));
      }

      if (c.shift % 3 === 0) {
        const t = svgEl("text", { x: cx, y: height - 16, class: "tick", "text-anchor": "middle" });
        t.textContent = c.shift > 0 ? "+" + c.shift : String(c.shift);
        svg.appendChild(t);
      }

      const hit = svgEl("rect", { x: cx - bandW / 2, y: T, width: bandW, height: plotH, class: "hit" });
      hit.addEventListener("mousemove", ev => Tooltip.show(
        `<div class="tt-title">${c.shift === 0 ? "tom original" : (c.shift > 0 ? "+" : "") + c.shift + " semitons"}</div>` +
        `<div class="tt-row"><span>no confortável</span><b>${Math.round(c.comfort * 100)}%</b></div>` +
        `<div class="tt-row"><span>ao alcance</span><b>${Math.round(c.reachable * 100)}%</b></div>`,
        ev.clientX, ev.clientY));
      hit.addEventListener("mouseleave", Tooltip.hide);
      hit.addEventListener("click", () => onPick && onPick(c.shift));
      svg.appendChild(hit);
    });

    // Rótulo direto só no melhor — rótulo em tudo vira ruído.
    const bi = curve.indexOf(best);
    const bx = L + bi * bandW + bandW / 2;
    const by = T + plotH - best.comfort * plotH;
    const lab = svgEl("text", {
      x: Math.min(width - R - 4, Math.max(L + 30, bx)), y: Math.max(12, by - 8),
      class: "value-label", "text-anchor": "middle", fill: cssVar("--text-primary"),
    });
    lab.textContent = `${Math.round(best.comfort * 100)}% em ${best.shift === 0 ? "tom original" : (best.shift > 0 ? "+" : "") + best.shift}`;
    svg.appendChild(lab);

    const ax = svgEl("text", { x: L + plotW / 2, y: height - 2, class: "tick", "text-anchor": "middle" });
    ax.textContent = "semitons de transposição";
    svg.appendChild(ax);
    svg.appendChild(svgEl("line", { x1: L, y1: T + plotH, x2: width - R, y2: T + plotH, class: "axis-line" }));
    return best;
  }

  /* =========================================================
     Quanto cada música sobe — barra divergente em torno de zero
     ========================================================= */

  function climbChart(svg, songs) {
    clearEl(svg);
    const items = songs.filter(s => typeof s.climb === "number");
    if (!items.length) {
      svg.setAttribute("height", 40);
      const t = svgEl("text", { x: 4, y: 24, class: "tick" });
      t.textContent = "Sem dados suficientes.";
      svg.appendChild(t);
      return;
    }
    items.sort((a, b) => b.climb - a.climb);

    const LABEL_W = 150, ROW_H = 24, T = 22, B = 22;
    const width = Math.max(340, availWidth(svg, 480));
    const height = T + items.length * ROW_H + B;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const span = Math.max(2, ...items.map(s => Math.abs(s.climb)));
    const x0 = LABEL_W, x1 = width - 34;
    const mid = (x0 + x1) / 2;
    const X = v => mid + (v / span) * ((x1 - x0) / 2);

    svg.appendChild(svgEl("line", { x1: mid, y1: T - 8, x2: mid, y2: height - B, class: "axis-line" }));
    const zl = svgEl("text", { x: mid, y: T - 12, class: "tick", "text-anchor": "middle" });
    zl.textContent = "estável";
    svg.appendChild(zl);
    const rl = svgEl("text", { x: x1, y: T - 12, class: "tick", "text-anchor": "end" });
    rl.textContent = "sobe →";
    svg.appendChild(rl);
    const ll = svgEl("text", { x: x0, y: T - 12, class: "tick" });
    ll.textContent = "← desce";
    svg.appendChild(ll);

    items.forEach((s, i) => {
      const y = T + i * ROW_H + ROW_H / 2;
      const lab = svgEl("text", { x: 0, y: y + 4, class: "row-label", "font-size": 12 });
      lab.textContent = s.title.length > 22 ? s.title.slice(0, 21) + "…" : s.title;
      svg.appendChild(lab);

      const v = s.climb;
      const bx = v >= 0 ? mid : X(v);
      const bw = Math.abs(X(v) - mid);
      svg.appendChild(svgEl("rect", {
        x: bx, y: y - 6, width: Math.max(1.5, bw), height: 12,
        rx: 4, fill: v >= 0 ? cssVar("--alert") : cssVar("--accent"),
      }));

      const val = svgEl("text", {
        x: v >= 0 ? mid + bw + 6 : mid - bw - 6, y: y + 4,
        class: "value-label", "text-anchor": v >= 0 ? "start" : "end",
      });
      val.textContent = fmtSemitones(v);
      svg.appendChild(val);
    });

    const foot = svgEl("text", { x: LABEL_W, y: height - 6, class: "tick" });
    foot.textContent = "diferença de altura entre o terço final e o inicial";
    svg.appendChild(foot);
  }

  /* =========================================================
     Prévia do alcance do cantor
     ========================================================= */

  function rangePreview(svg, settings) {
    clearEl(svg);
    const width = Math.max(400, availWidth(svg, 600));
    const height = 96;
    const L = 12, R = 12, T = 30;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);

    const lo = Math.min(settings.stretch_low, settings.comfort_low) - 5;
    const hi = Math.max(settings.stretch_high, settings.comfort_high) + 5;
    const X = m => L + ((m - lo) / (hi - lo)) * (width - L - R);

    const KEY_H = 34;

    // As faixas são o chão; o teclado se desenha por cima delas, como grade.
    // A escala é cromática (um semitom = uma largura) para que a faixa continue
    // linear — as pretas ficam mais estreitas e curtas, e é isso que faz o
    // desenho ser lido como teclado.
    const band = (l, h, fill, y, hgt) => svg.appendChild(svgEl("rect", {
      x: X(l), y, width: X(h + 1) - X(l), height: hgt, fill,
    }));
    band(settings.stretch_low, settings.stretch_high, cssVar("--zone-stretch"), T - 10, KEY_H + 20);
    band(settings.comfort_low, settings.comfort_high, cssVar("--zone-comfort"), T - 10, KEY_H + 20);

    for (let m = Math.ceil(lo); m <= hi; m++) {
      if (isBlackKey(m)) continue;
      svg.appendChild(svgEl("line", {
        x1: X(m), y1: T, x2: X(m), y2: T + KEY_H,
        stroke: cssVar("--rule-firm"), "stroke-width": 1,
      }));
    }
    for (let m = Math.ceil(lo); m <= hi; m++) {
      if (!isBlackKey(m)) continue;
      const w = X(m + 1) - X(m);
      svg.appendChild(svgEl("rect", {
        x: X(m) + w * 0.2, y: T, width: Math.max(1.5, w * 0.6), height: KEY_H * 0.6,
        fill: cssVar("--key-ink"),
      }));
    }
    svg.appendChild(svgEl("line", {
      x1: L, y1: T + KEY_H, x2: width - R, y2: T + KEY_H, class: "axis-line",
    }));

    // Dó de cada oitava rotulado: sem isso o teclado não tem endereço.
    for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) {
      const t = svgEl("text", {
        x: X(m) + (X(m + 1) - X(m)) / 2, y: T + KEY_H - 4,
        class: "tick", "text-anchor": "middle",
      });
      t.textContent = midiToName(m);
      svg.appendChild(t);
    }

    band(settings.comfort_low, settings.comfort_high, cssVar("--silk-2"), T + KEY_H + 6, 4);

    const mk = (m, text, anchor) => {
      const t = svgEl("text", { x: X(m), y: 16, class: "tick", "text-anchor": anchor, fill: cssVar("--text-secondary") });
      t.textContent = text;
      svg.appendChild(t);
    };
    mk(settings.stretch_low, midiToName(settings.stretch_low), "start");
    mk(settings.stretch_high + 1, midiToName(settings.stretch_high), "end");

    const cl = svgEl("text", {
      x: (X(settings.comfort_low) + X(settings.comfort_high + 1)) / 2, y: height - 4,
      class: "tick", "text-anchor": "middle", fill: cssVar("--silk-2"),
    });
    cl.textContent = `confortável ${midiToName(settings.comfort_low)}–${midiToName(settings.comfort_high)} · ${settings.comfort_high - settings.comfort_low} semitons`;
    svg.appendChild(cl);
  }

  /* =========================================================
     Confortáveis × difíceis — a média de cada grupo
     ========================================================= */

  function tagCompare(container, songs, settings) {
    clearEl(container);
    const groups = [
      { tag: "comfortable", label: "Que você acha confortáveis" },
      { tag: "hard", label: "Que você acha difíceis" },
    ].map(g => {
      const list = songs.filter(s => s.tag === g.tag && typeof s.min_midi === "number");
      if (!list.length) return { ...g, list };
      const avg = k => list.reduce((a, s) => a + s[k], 0) / list.length;
      return { ...g, list, min: avg("min_midi"), max: avg("max_midi"), core_low: avg("core_low"), core_high: avg("core_high"), median: avg("median_midi") };
    });

    if (!groups.some(g => g.list.length)) {
      container.innerHTML = `<div class="empty">Classifique músicas como confortáveis ou difíceis para ver a comparação.</div>`;
      return;
    }

    const svg = svgEl("svg", { class: "chart" });
    const width = Math.max(340, container.clientWidth || 480);
    const ROW_H = 54, T = 26;
    const height = T + groups.length * ROW_H + 26;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("height", height);

    const present = groups.filter(g => g.list.length);
    const lo = Math.min(settings.stretch_low, ...present.map(g => g.min)) - 2;
    const hi = Math.max(settings.stretch_high, ...present.map(g => g.max)) + 2;
    const L = 12, R = 12;
    const X = m => L + ((m - lo) / (hi - lo)) * (width - L - R);

    svg.appendChild(svgEl("rect", {
      x: X(settings.comfort_low), y: T - 10, width: X(settings.comfort_high + 1) - X(settings.comfort_low),
      height: height - T - 8, fill: cssVar("--zone-comfort"),
    }));
    for (const m of pitchTicks(lo, hi)) {
      svg.appendChild(svgEl("line", { x1: X(m), y1: T - 10, x2: X(m), y2: height - 22, class: "tick-line" }));
      const t = svgEl("text", { x: X(m), y: height - 8, class: "tick", "text-anchor": "middle" });
      t.textContent = midiToName(m);
      svg.appendChild(t);
    }

    groups.forEach((g, i) => {
      const y = T + i * ROW_H + 26;
      const lab = svgEl("text", { x: L, y: y - 12, class: "row-label", "font-size": 12.5 });
      lab.textContent = g.list.length
        ? `${g.label} (${g.list.length})`
        : `${g.label} — nenhuma ainda`;
      svg.appendChild(lab);
      if (!g.list.length) return;

      const color = tagColor(g.tag);
      svg.appendChild(svgEl("line", {
        x1: X(g.min), y1: y, x2: X(g.max + 1), y2: y,
        stroke: color, "stroke-width": 1.5, "stroke-linecap": "round", opacity: 0.45,
      }));
      svg.appendChild(svgEl("rect", {
        x: X(g.core_low), y: y - 6, width: Math.max(3, X(g.core_high + 1) - X(g.core_low)),
        height: 12, rx: 4, fill: color,
      }));
      svg.appendChild(svgEl("circle", {
        cx: X(g.median + 0.5), cy: y, r: 4.5, fill: color,
        stroke: cssVar("--surface-1"), "stroke-width": 2,
      }));
      const v = svgEl("text", { x: X(g.max + 1) + 6, y: y + 4, class: "value-label" });
      v.textContent = `${midiToName(g.min)}–${midiToName(g.max)}`;
      svg.appendChild(v);
    });

    container.appendChild(svg);
  }

  return {
    registerRail, rangeChart, histChart, profileChart, transposeChart, transposeCurve,
    climbChart, rangePreview, tagCompare, legend, tagColor, TAG_LABEL,
  };
})();
