export type AudibleAlarm = 'warning' | 'severe'
// One owner per routed real-data page. Nothing is constructed before a gesture.
export class AlarmAudio {
  private context?: AudioContext
  private oscillators: OscillatorNode[] = []
  constructor(private factory: () => AudioContext = () => new AudioContext()) {}
  async enable() {
    this.context ??= this.factory()
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Som bloqueado pelo navegador')
  }
  play(state: AudibleAlarm) {
    this.stop()
    const context = this.context
    if (!context || context.state !== 'running') throw new Error('Som bloqueado pelo navegador')
    const count = state === 'severe' ? 3 : 1
    for (let i=0; i<count; i++) {
      const oscillator = context.createOscillator(), gain = context.createGain()
      const start = context.currentTime + i*0.22, end = start+0.15
      oscillator.type = state === 'severe' ? 'square' : 'sine'
      oscillator.frequency.setValueAtTime(state === 'severe' ? 880 : 660,start)
      gain.gain.setValueAtTime(0,start)
      gain.gain.linearRampToValueAtTime(0.08,start+0.01)
      gain.gain.linearRampToValueAtTime(0,end)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()}
      oscillator.start(start); oscillator.stop(end)
      this.oscillators.push(oscillator)
    }
  }
  stop() {
    for (const oscillator of this.oscillators) { try { oscillator.stop() } catch { /* already ended */ } }
    this.oscillators=[]
  }
  dispose() { this.stop(); void this.context?.close().catch(()=>{}); this.context=undefined }
}
