/* 繪譜。相對舊版的三個修正：
   1. 臨時記號由「調號比對」決定，不再靠出題端傳旗標 —— 少一個會不同步的來源
   2. Voice 改用 strict，時值不對會被抓出來而不是排出鬼畫符
   3. Beam 依拍分組，4/4 的八分音符不再連成一整條 */

import { VF } from "./vexloader.js";
import { vexKey, accVex, noteName, midiOf } from "../core/pitch.js";
import { DUR, tsInfo } from "../gen/rhythm.js";

function attachAccidental(note, idx, accStr){
  try {
    var a = new VF.Accidental(accStr);
    if (typeof note.addModifier === "function") note.addModifier(a, idx);
    else if (typeof note.addAccidental === "function") note.addAccidental(idx, a);
  } catch (e) {}
}

function attachDot(note){
  try {
    if (VF.Dot && typeof VF.Dot.buildAndAttach === "function"){
      VF.Dot.buildAndAttach([note], {all:true});
      return;
    }
  } catch (e) {}
  try { if (typeof note.addDotToAll === "function") note.addDotToAll(); } catch (e) {}
}

function makeVoice(numBeats, beatValue){
  return new VF.Voice({num_beats:numBeats, beat_value:beatValue, numBeats:numBeats, beatValue:beatValue});
}

/* strict 會在時值不符時丟例外，這裡接住並降級，
   避免一個出題 bug 讓整張譜變空白 —— 但錯誤會留在 console。 */
function formatVoices(voices, width){
  var f = new VF.Formatter();
  voices.forEach(function(v){ f.joinVoices([v]); });
  try {
    voices.forEach(function(v){ v.setStrict(true); });
    f.format(voices, width);
  } catch (e){
    console.warn("小節時值不符，降級排版：", e.message);
    voices.forEach(function(v){ v.setStrict(false); });
    new VF.Formatter().format(voices, width);
  }
}

function beamGroups(ts){
  return tsInfo(ts).beamGroups.map(function(g){ return new VF.Fraction(g[0], g[1]); });
}

function drawBeams(ctx, notes, ts){
  try {
    VF.Beam.generateBeams(notes, {groups: beamGroups(ts)})
      .forEach(function(b){ b.setContext(ctx).draw(); });
  } catch (e){}
}

/* 一行放幾小節。iPad 直立時四小節的大譜表會擠成一團，
   所以是看實際可用寬度，不是看有沒有超過某個斷點。 */
function measuresPerLine(W, grand){
  if (grand){
    if (W < 560) return 1;
    if (W < 860) return 2;
    return 4;
  }
  if (W < 420) return 1;
  if (W < 700) return 2;
  return 4;
}

/* 一行最多還能塞幾小節而不至於擠成一團。
   高度不夠時會拿這個上限去換行數（行數少 = 整張矮），但不能無上限地塞。 */
function maxPerLine(W, grand){
  return Math.max(1, Math.floor((W - 90) / (grand ? 150 : 110)));
}

/* 縮到這個比例以下就不再縮了 —— 再小就看不清楚，
   那還不如讓譜面區自己捲（頁面仍然不捲，頂欄的開始／停止照樣按得到）。
   0.85 是「幾乎看不出來變小」的界線；再往下使用者就會覺得譜變小了。 */
var MIN_FIT = 0.85;

function svgText(svg, x, y, cls, str){
  var t = document.createElementNS("http://www.w3.org/2000/svg", "text");
  t.setAttribute("x", x); t.setAttribute("y", y);
  t.setAttribute("class", cls); t.textContent = str;
  svg.appendChild(t);
  return t;
}

function buildNote(item, key){
  if (item.rest){
    var r = new VF.StaveNote({keys:[item.clef === "bass" ? "d/3" : "b/4"],
                              duration:item.dur + "r", clef:item.clef});
    if (item.dur.indexOf("d") >= 0) attachDot(r);
    return r;
  }
  // chordNotes 是塊狀和弦（左手的和弦墊、華爾滋的後兩拍）
  var notes = item.chordNotes && item.chordNotes.length ? item.chordNotes : [item.note];
  var n = new VF.StaveNote({keys: notes.map(vexKey), duration:item.dur, clef:item.clef});
  if (item.dur.indexOf("d") >= 0) attachDot(n);
  if (key){
    for (var i = 0; i < notes.length; i++){
      if (key.needsAccidental(notes[i])) attachAccidental(n, i, accVex(notes[i].a));
    }
  }
  return n;
}

function playbackEvents(items, base, part, measure){
  var events = [], t = base;
  for (var i = 0; i < items.length; i++){
    var it = items[i], d = DUR[it.dur];
    if (!it.rest){
      var src = (it.chordNotes && it.chordNotes.length) ? it.chordNotes : [it.note];
      events.push({t:t, d:d, midi:src.map(midiOf), part:part, measure:measure, item:i, gid:null});
    }
    t += d;
  }
  return events;
}

/* 解答音直接由題目資料建立，不再依賴「該聲部是否成功畫到 SVG」。
   這讓左右手是可測試的播放資料；iPad 上即使繪圖降級，也不會只剩右手有聲。 */
export function exercisePlaybackPlan(ex){
  var plan = {events:[], total:ex.measures.length * ex.beats, layout:[]};
  for (var mi = 0; mi < ex.measures.length; mi++){
    var md = ex.measures[mi];
    var topPart = ex.clef === "bass" ? "left" : "right";
    plan.events.push.apply(plan.events, playbackEvents(md.top || [], mi * ex.beats, topPart, mi));
    if (md.bottom) plan.events.push.apply(plan.events, playbackEvents(md.bottom, mi * ex.beats, "left", mi));
  }
  return plan;
}

function attachPlanGids(plan, vfnotes, part, measure){
  for (var i = 0; i < vfnotes.length; i++){
    var gid = null;
    try { gid = "vf-" + vfnotes[i].getAttribute("id"); } catch (e) {}
    var event = plan.events.find(function(item){
      return item.part === part && item.measure === measure && item.item === i;
    });
    if (event) event.gid = gid;
  }
}

function collectPlan(plan, items, vfnotes, base, part){
  var t = base;
  for (var i = 0; i < items.length; i++){
    var it = items[i], d = DUR[it.dur];
    if (!it.rest){
      var gid = null;
      try { gid = "vf-" + vfnotes[i].getAttribute("id"); } catch (e) {}
      var src = (it.chordNotes && it.chordNotes.length) ? it.chordNotes : [it.note];
      plan.events.push({t:t, d:d, midi:src.map(midiOf), gid:gid, part:part || "right"});
    }
    t += d;
  }
}

/**
 * 畫視譜練習。
 * @returns {{events:Array, total:number, layout:Array}} 播放計畫 + 每小節位置（給游標用）
 */
export function drawExercise(el, ex, opts){
  el.innerHTML = "";
  var plan = exercisePlaybackPlan(ex);
  if (!VF) return plan;

  var o = opts || {};
  var grand = ex.clef === "grand";
  var zoom = o.zoom || 1;
  var px = Math.max(320, el.clientWidth || 900);
  // 版面全部用「邏輯寬度」算，再由 ctx.scale 放大到實際像素 ——
  // 這樣把譜放大時是整張譜變大，而不是硬把四小節擠進同一行
  var W = px / zoom;
  var perLine = o.perLine || measuresPerLine(W, grand);
  var lines = Math.ceil(ex.measures.length / perLine);
  var lineH = grand ? 190 : 120;
  var extra = 60 + (o.showChords ? 16 : 0);

  /* 譜架模式：這一列只有這麼高，放不下就要處理，因為頁面本身不捲。
     先試「一行多塞幾小節」—— 行數變少，譜還是原來的大小，這比縮小划算；
     真的還是放不下才整張縮。縮的是 zoom，所以 SVG 的外框跟內容一起變，
     游標的換算（用 plan.lw）才不會跑掉。 */
  if (o.maxHeight > 0 && !o.perLine){
    var cap = Math.min(ex.measures.length, maxPerLine(W, grand));
    while ((lines * lineH + extra) * zoom > o.maxHeight && perLine < cap){
      perLine = Math.min(cap, perLine * 2);
      lines = Math.ceil(ex.measures.length / perLine);
    }
    var need = (lines * lineH + extra) * zoom;
    if (need > o.maxHeight){
      zoom *= Math.max(MIN_FIT, o.maxHeight / need);
      W = px / zoom;
    }
  }
  var H = lines * lineH + 60;

  var renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(px, H * zoom);
  var ctx = renderer.getContext();
  if (zoom !== 1) ctx.scale(zoom, zoom);
  var svg = el.querySelector("svg");
  // 保險：萬一 CSS 的 max-height 還是夾到了，讓內容靠左上而不是置中，
  // 這樣游標的 x 位移仍然是對的（只是整體會小一點）
  if (svg) svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  plan.lw = W;             // 游標換算座標要用邏輯寬度，不是 SVG 的 width 屬性

  var vexSig = ex.key.vexSignature;
  var sigCount = ex.key.accidentalCount;

  // 和弦代號要畫在譜表上方，所以整體往下讓出位置
  var topPad = o.showChords ? 40 : 24;
  var H2 = lines * lineH + 60 + (o.showChords ? 16 : 0);
  if (H2 !== H){ H = H2; renderer.resize(px, H * zoom); if (zoom !== 1) ctx.scale(zoom, zoom); }

  for (var li = 0; li < lines; li++){
    var from = li * perLine, to = Math.min(from + perLine, ex.measures.length);
    var count = to - from;
    var y = topPad + li * lineH;
    var head = 62 + sigCount * 11 + (li === 0 ? 26 : 0);
    var mw = (W - 20 - head) / count;

    var topStaves = [], botStaves = [];
    var x = 10;

    for (var mi = from; mi < to; mi++){
      var isFirst = (mi === from);
      var w = mw + (isFirst ? head : 0);

      // 重複同一段時畫反覆記號，眼睛才知道要繞回去
      var isHead = (mi === 0), isTail = (mi === ex.measures.length - 1);
      var endBar = isTail ? (o.repeat ? VF.Barline.type.REPEAT_END : VF.Barline.type.END) : null;

      var st = new VF.Stave(x, y, w);
      if (isFirst){
        st.addClef(grand ? "treble" : ex.clef);
        st.addKeySignature(vexSig);
        if (li === 0) st.addTimeSignature(ex.ts);
      }
      if (o.repeat && isHead) st.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
      if (endBar !== null) st.setEndBarType(endBar);
      st.setContext(ctx).draw();
      topStaves.push(st);

      var sb = null;
      if (grand){
        sb = new VF.Stave(x, y + 96, w);
        if (isFirst){
          sb.addClef("bass");
          sb.addKeySignature(vexSig);
          if (li === 0) sb.addTimeSignature(ex.ts);
        }
        if (o.repeat && isHead) sb.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
        if (endBar !== null) sb.setEndBarType(endBar);
        sb.setContext(ctx).draw();
        botStaves.push(sb);
        if (isFirst){
          new VF.StaveConnector(st, sb).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
          new VF.StaveConnector(st, sb).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        }
      }

      var md = ex.measures[mi];
      var topNotes = md.top.map(function(it){ return buildNote(it, ex.key); });
      var vTop = makeVoice(ex.beats, 4);
      vTop.addTickables(topNotes);

      var voices = [vTop], botNotes = null, vBot = null;
      if (sb && md.bottom){
        botNotes = md.bottom.map(function(it){ return buildNote(it, ex.key); });
        vBot = makeVoice(ex.beats, 4);
        vBot.addTickables(botNotes);
        voices.push(vBot);
      }

      formatVoices(voices, Math.max(40, w - (st.getNoteStartX() - st.getX()) - 18));
      vTop.draw(ctx, st);
      if (vBot) vBot.draw(ctx, sb);

      attachPlanGids(plan, topNotes, ex.clef === "bass" ? "left" : "right", mi);
      if (botNotes && md.bottom) attachPlanGids(plan, botNotes, "left", mi);

      plan.layout.push({
        bar: mi, x: st.getX(), y: st.getY(), w: w,
        h: (sb ? sb.getBottomY() : st.getBottomY()) - st.getY()
      });

      if (o.showHarmony && svg && ex.roman){
        try { svgText(svg, st.getNoteStartX(), st.getY() - 6, "roman", ex.roman[mi]); } catch (e) {}
      }

      // 和弦代號：一小節兩個和弦時各自畫在自己那一拍上
      if (o.showChords && svg && ex.harmony && ex.harmony.bars[mi]){
        var slots = ex.harmony.bars[mi].slots;
        var inner = w - (st.getNoteStartX() - st.getX()) - 12;
        for (var si = 0; si < slots.length; si++){
          if (!slots[si].chord) continue;
          try {
            svgText(svg, st.getNoteStartX() + (slots[si].beat / ex.beats) * inner,
                    st.getY() - (o.showHarmony ? 22 : 8), "chordsym", slots[si].chord.symbol);
          } catch (e) {}
        }
      }

      drawBeams(ctx, topNotes, ex.ts);
      if (botNotes) drawBeams(ctx, botNotes, ex.ts);

      if (o.showNames && svg){
        var lowY = (sb ? sb.getBottomY() : st.getBottomY()) + 16;
        var lowItems = sb ? md.bottom : md.top;
        var lowNotes = sb ? botNotes : topNotes;
        for (var q = 0; q < lowNotes.length; q++){
          if (lowItems[q].rest) continue;
          try { svgText(svg, lowNotes[q].getAbsoluteX(), lowY, "notename", noteName(lowItems[q].note)); } catch (e) {}
        }
        if (sb){
          var y2 = st.getBottomY() + 16;
          for (var q2 = 0; q2 < topNotes.length; q2++){
            if (md.top[q2].rest) continue;
            try { svgText(svg, topNotes[q2].getAbsoluteX(), y2, "notename", noteName(md.top[q2].note)); } catch (e) {}
          }
        }
      }

      x += w;
    }

    if (grand && botStaves.length){
      new VF.StaveConnector(topStaves[topStaves.length - 1], botStaves[botStaves.length - 1])
        .setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
    }
  }

  return plan;
}

/* 和弦練習。與視譜共用同一套音符格式，所以這裡也支援大譜表與節奏 ——
   上部結構 voicing 與走路低音都是兩隻手的東西，塞不進單行低音譜號。 */
export function drawChordDrill(el, data, opts){
  el.innerHTML = "";
  var o = opts || {};
  var beats = data.beats || 4;
  var grand = !!data.grand;
  var plan = {events:[], total:0, layout:[]};
  if (!VF) return plan;

  var zoom = o.zoom || 1;
  var px = Math.max(320, el.clientWidth || 900);
  var W = px / zoom;
  var perLine = o.perLine || measuresPerLine(W, grand);
  plan.lw = W;

  var totalLines = 0;
  data.systems.forEach(function(s){ totalLines += Math.ceil(s.measures.length / perLine); });
  var lineH = grand ? 200 : 132;
  var H = totalLines * lineH + 46;

  var renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(px, H * zoom);
  var ctx = renderer.getContext();
  if (zoom !== 1) ctx.scale(zoom, zoom);
  var svg = el.querySelector("svg");

  var lineNo = 0;
  var tBase = 0;

  data.systems.forEach(function(sys){
    var lines = Math.ceil(sys.measures.length / perLine);
    for (var li = 0; li < lines; li++){
      var from = li * perLine, to = Math.min(from + perLine, sys.measures.length);
      var count = to - from;
      var y = 42 + lineNo * lineH;
      var head = 58;
      var mw = (W - 20 - head) / count;
      var x = 10;
      var topStaves = [], botStaves = [];

      for (var mi = from; mi < to; mi++){
        var isFirst = (mi === from);
        var w = mw + (isFirst ? head : 0);
        var md = sys.measures[mi];

        var st = new VF.Stave(x, y, w);
        if (isFirst){ st.addClef(grand ? "treble" : "bass"); if (lineNo === 0) st.addTimeSignature(data.ts || "4/4"); }
        if (mi === sys.measures.length - 1) st.setEndBarType(VF.Barline.type.END);
        st.setContext(ctx).draw();
        topStaves.push(st);

        var sb = null;
        if (grand){
          sb = new VF.Stave(x, y + 96, w);
          if (isFirst){ sb.addClef("bass"); if (lineNo === 0) sb.addTimeSignature(data.ts || "4/4"); }
          if (mi === sys.measures.length - 1) sb.setEndBarType(VF.Barline.type.END);
          sb.setContext(ctx).draw();
          botStaves.push(sb);
          if (isFirst){
            new VF.StaveConnector(st, sb).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
            new VF.StaveConnector(st, sb).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
          }
        }

        // 和弦符號永遠要畫，答案才是被藏起來的那個
        if (svg && md.labels){
          md.labels.forEach(function(L){
            var lx = st.getNoteStartX() + (L.beat / beats) * (w - (st.getNoteStartX() - st.getX()) - 12);
            svgText(svg, lx, st.getY() - 8, "chordsym", L.label);
          });
        }

        var topNotes = null, botNotes = null;
        if (o.revealed){
          topNotes = md.top.map(function(it){ return buildNote(it, null); });
          var vTop = makeVoice(beats, 4);
          vTop.addTickables(topNotes);
          var voices = [vTop], vBot = null;
          if (sb && md.bottom){
            botNotes = md.bottom.map(function(it){ return buildNote(it, null); });
            vBot = makeVoice(beats, 4);
            vBot.addTickables(botNotes);
            voices.push(vBot);
          }
          formatVoices(voices, Math.max(40, w - (st.getNoteStartX() - st.getX()) - 18));
          vTop.draw(ctx, st);
          if (vBot) vBot.draw(ctx, sb);
          drawBeams(ctx, topNotes, data.ts || "4/4");
          if (botNotes) drawBeams(ctx, botNotes, data.ts || "4/4");

          if (o.showNoteNames && svg && md.names){
            try {
              svgText(svg, st.getNoteStartX(), (sb ? sb.getBottomY() : st.getBottomY()) + 16,
                      "notename", md.names.join("  │  "));
            } catch (e) {}
          }
        }

        // 播放計畫不管有沒有畫出來都要有 —— 藏答案時也要能按播放
        collectPlan(plan, md.top, topNotes || [], tBase, data.grand ? "right" : "left");
        if (md.bottom) collectPlan(plan, md.bottom, botNotes || [], tBase, "left");
        plan.total = Math.max(plan.total, tBase + beats);
        plan.layout.push({bar: plan.layout.length, x: st.getX(), y: st.getY(), w: w,
                          h: (sb ? sb.getBottomY() : st.getBottomY()) - st.getY()});
        tBase += beats;
        x += w;
      }

      if (grand && botStaves.length){
        new VF.StaveConnector(topStaves[topStaves.length - 1], botStaves[botStaves.length - 1])
          .setType(VF.StaveConnector.type.SINGLE_RIGHT).setContext(ctx).draw();
      }
      lineNo++;
    }
  });

  return plan;
}
