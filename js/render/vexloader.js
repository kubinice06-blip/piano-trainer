/* VexFlow 載入器。
   改成 promise，讓 main.js 可以 await —— 原本的巢狀 callback 在拆模組後會搶跑。 */

const SOURCES = [
  "vendor/vexflow.js",                                                  // 本機副本（離線優先）
  "https://cdnjs.cloudflare.com/ajax/libs/vexflow/4.2.3/vexflow.js",
  "https://cdn.jsdelivr.net/npm/vexflow@4.2.3/build/cjs/vexflow.js",
  "https://unpkg.com/vexflow@4.2.3/build/cjs/vexflow.js"
];

function resolveVF(){
  if (window.Vex && window.Vex.Flow) return window.Vex.Flow;
  if (window.VexFlow && window.VexFlow.Stave) return window.VexFlow;
  return null;
}

function loadScript(src){
  return new Promise(function(resolve, reject){
    var el = document.createElement("script");
    el.src = src;
    el.onload = function(){ resolve(); };
    el.onerror = function(){ reject(new Error("載入失敗 " + src)); };
    document.head.appendChild(el);
  });
}

export let VF = null;
export let VMAJ = 4;

export async function loadVexFlow(){
  VF = resolveVF();
  for (var i = 0; i < SOURCES.length && !VF; i++){
    try { await loadScript(SOURCES[i]); } catch (e) { continue; }
    VF = resolveVF();
  }
  if (!VF) throw new Error("VexFlow 無法載入");
  if (VF.BUILD && VF.BUILD.VERSION){
    var m = parseInt(String(VF.BUILD.VERSION).split(".")[0], 10);
    if (!isNaN(m)) VMAJ = m;
  }
  return VF;
}
