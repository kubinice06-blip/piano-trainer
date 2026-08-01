/* Desktop-only Web MIDI input. iOS Safari intentionally reports unsupported. */

export class MidiInput {
  constructor(onEvent){ this.onEvent = onEvent; this.access = null; this.inputs = []; this.enabled = false; }
  get supported(){ return typeof navigator !== "undefined" && !!navigator.requestMIDIAccess; }

  async connect(){
    if (!this.supported) throw new Error("此瀏覽器不支援 Web MIDI；iPad 請使用麥克風節奏偵測。");
    this.access = await navigator.requestMIDIAccess({sysex:false});
    this.refresh();
    this.access.onstatechange = () => this.refresh();
    this.enabled = this.inputs.length > 0;
    return this.inputs.map((input) => input.name || "MIDI 裝置");
  }

  refresh(){
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = this.access ? [...this.access.inputs.values()] : [];
    for (const input of this.inputs){
      input.onmidimessage = (event) => {
        const [status, note, velocity] = event.data;
        const command = status & 0xf0;
        if (command === 0x90 && velocity > 0) this.onEvent?.(note, performance.now(), "on", velocity);
        else if (command === 0x80 || (command === 0x90 && velocity === 0)) this.onEvent?.(note, performance.now(), "off", velocity);
      };
    }
    this.enabled = this.inputs.length > 0;
  }

  disconnect(){
    for (const input of this.inputs) input.onmidimessage = null;
    this.inputs = [];
    this.enabled = false;
  }
}
