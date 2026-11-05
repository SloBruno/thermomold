import { expect, test, vi } from 'vitest'
import { AlarmAudio } from './temperature-alarm-audio'
function context(state='running') {
 const oscillators: any[]=[]; const gains:any[]=[]
 return { state,currentTime:10,destination:{},resume:vi.fn(async()=>{}),close:vi.fn(async()=>{}),
 createOscillator:vi.fn(()=>{const o={type:'',frequency:{setValueAtTime:vi.fn()},connect:vi.fn(),start:vi.fn(),stop:vi.fn(),disconnect:vi.fn()};oscillators.push(o);return o}),
 createGain:vi.fn(()=>{const g={gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};gains.push(g);return g}),oscillators,gains }
}
test('no autoplay; explicit unlock emits distinct actual waveforms, stop cancels sound',async()=>{
 const c=context();const factory=vi.fn(()=>c as any);const audio=new AlarmAudio(factory)
 expect(factory).not.toHaveBeenCalled()
 await audio.enable();expect(c.resume).toHaveBeenCalledOnce()
 audio.play('warning');expect(c.oscillators).toHaveLength(1)
 expect(c.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(660,10)
 expect(c.oscillators[0].type).toBe('sine');expect(c.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalled()
 audio.stop();expect(c.oscillators[0].stop).toHaveBeenCalledWith()
 audio.play('severe');expect(c.oscillators).toHaveLength(4)
 expect(c.oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(880,10)
 expect(c.oscillators[1].type).toBe('square')
 audio.dispose();expect(c.close).toHaveBeenCalledOnce()
})
test('blocked resume and subsequent suspended audio are visible failures',async()=>{
 const c=context('suspended');const a=new AlarmAudio(()=>c as any)
 await expect(a.enable()).rejects.toThrow(/bloqueado/)
 expect(()=>a.play('warning')).toThrow(/bloqueado/)
 a.dispose()
})
