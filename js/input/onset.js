/* Microphone onset detector for iPad rhythm timing. It deliberately does not
   claim to recognise polyphonic piano pitch. */

export class OnsetInput {
  constructor(onOnset){ this.onOnset=onOnset; this.stream=null; this.ctx=null; this.raf=null; this.enabled=false; }
  get supported(){ return !!navigator.mediaDevices?.getUserMedia; }

  async connect(){
    if (!this.supported) throw new Error("此瀏覽器不支援麥克風輸入。");
    this.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const source = this.ctx.createMediaStreamSource(this.stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let floor = 0.008, armed = true, last = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const rms = Math.sqrt(sum / data.length);
      floor = floor * 0.995 + Math.min(rms, floor * 2) * 0.005;
      const now = performance.now();
      const threshold = Math.max(0.025, floor * 3.5);
      if (armed && rms > threshold && now - last > 90){
        armed = false; last = now; this.onOnset?.(now, rms);
      } else if (rms < threshold * 0.55){ armed = true; }
      this.raf = requestAnimationFrame(tick);
    };
    this.enabled = true;
    tick();
    return true;
  }

  disconnect(){
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.ctx?.close?.();
    this.ctx = null;
    this.enabled = false;
  }
}
