import { useEffect, useState } from 'react'
import socket from '../lib/socket'
import type { MoldLibrary, MoldParameters, SensorParameter } from 'shared/types'

function createMold(id = 'default', name = 'Molde Padrão'): MoldParameters {
  return {
    id,
    name,
    targetTemp: 80,
    tempIn: { target: 29, tolerance: 3 },
    tempOut: { target: 57.5, tolerance: 7.5 },
    pressure: { target: 2.75, tolerance: 0.75 },
    flow: { target: 12.5, tolerance: 3.5 },
    deltaT: { target: 21, tolerance: 9 },
    heatExchange: { target: 20, tolerance: 2 },
  }
}

function ParameterFields({ label, unit, value, onChange }: {
  label: string
  unit: string
  value: SensorParameter
  onChange: (value: SensorParameter) => void
}) {
  return (
    <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 space-y-3">
      <p className="text-sm font-bold text-neutral-900">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-sm text-neutral-600">Desejado</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              value={value.target}
              onChange={event => onChange({ ...value, target: Number(event.target.value) })}
              className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm font-bold text-neutral-900 outline-none focus:border-neutral-700"
            />
            <span className="text-sm text-neutral-500">{unit}</span>
          </div>
        </label>
        <label className="space-y-1">
          <span className="text-sm text-neutral-600">Faixa de erro</span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-500">+/-</span>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={value.tolerance}
              onChange={event => onChange({ ...value, tolerance: Number(event.target.value) })}
              className="w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm font-bold text-neutral-900 outline-none focus:border-neutral-700"
            />
            <span className="text-sm text-neutral-500">{unit}</span>
          </div>
        </label>
      </div>
    </div>
  )
}

export default function MoldParametersPage() {
  const [library, setLibrary] = useState<MoldLibrary | null>(null)
  const [draft, setDraft] = useState<MoldParameters>(() => createMold())
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const handleLibrary = (payload: MoldLibrary) => {
      setLibrary(payload)
      const activeMold = payload.molds.find(mold => mold.id === payload.activeMoldId) ?? payload.molds[0]
      if (activeMold) setDraft(activeMold)
    }
    socket.on('simple:molds:data', handleLibrary)
    socket.emit('simple:molds:request')
    return () => { socket.off('simple:molds:data', handleLibrary) }
  }, [])

  const updateParameter = (key: keyof Pick<MoldParameters, 'tempIn' | 'tempOut' | 'pressure' | 'flow' | 'deltaT' | 'heatExchange'>, value: SensorParameter) => {
    setDraft(current => ({ ...current, [key]: value }))
    setSaved(false)
  }

  const saveMold = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    socket.emit('simple:molds:save', draft)
    setSaved(true)
  }

  const createNewMold = () => {
    setDraft(createMold(`mold-${Date.now()}`, 'Novo Molde'))
    setSaved(false)
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white p-6 space-y-4">
      <header className="bg-white border border-neutral-200 rounded-xl px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-neutral-900">Configuração de Moldes</h2>
            <p className="text-sm text-neutral-500">Salve perfis com metas e tolerâncias para o monitoramento.</p>
          </div>
          <button type="button" onClick={createNewMold} className="rounded-md border border-neutral-800 bg-neutral-800 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-700">
            Novo molde
          </button>
        </div>
      </header>

      <form onSubmit={saveMold} className="space-y-4">
        <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-4">
          <h3 className="text-base font-bold text-neutral-900">Perfil</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-sm font-bold text-neutral-700">Molde salvo</span>
              <select
                value={library?.molds.some(mold => mold.id === draft.id) ? draft.id : ''}
                onChange={event => {
                  const mold = library?.molds.find(item => item.id === event.target.value)
                  if (mold) {
                    setDraft(mold)
                    setSaved(false)
                  }
                }}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-700"
              >
                {!library?.molds.some(mold => mold.id === draft.id) && <option value="">Novo molde</option>}
                {(library?.molds ?? []).map(mold => <option key={mold.id} value={mold.id}>{mold.name}</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold text-neutral-700">Nome do molde</span>
              <input
                type="text"
                maxLength={50}
                value={draft.name}
                onChange={event => {
                  setDraft(current => ({ ...current, name: event.target.value }))
                  setSaved(false)
                }}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-700"
              />
            </label>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
            <h3 className="text-base font-bold text-neutral-900">Temperaturas</h3>
            <label className="block space-y-2">
              <span className="text-sm font-bold text-neutral-700">Temperatura do molde</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={50}
                  max={120}
                  value={draft.targetTemp}
                  onChange={event => {
                    setDraft(current => ({ ...current, targetTemp: Number(event.target.value) }))
                    setSaved(false)
                  }}
                  className="w-24 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm font-bold text-neutral-900 outline-none focus:border-neutral-700"
                />
                <span className="text-sm text-neutral-500">°C</span>
              </div>
            </label>
            <ParameterFields label="Temperatura de entrada" unit="°C" value={draft.tempIn} onChange={value => updateParameter('tempIn', value)} />
            <ParameterFields label="Temperatura de saída" unit="°C" value={draft.tempOut} onChange={value => updateParameter('tempOut', value)} />
            <ParameterFields label="Delta T" unit="°C" value={draft.deltaT} onChange={value => updateParameter('deltaT', value)} />
          </section>

          <section className="bg-white border border-neutral-200 rounded-xl p-5 space-y-3">
            <h3 className="text-base font-bold text-neutral-900">Hidráulica e Troca de Calor</h3>
            <ParameterFields label="Pressão" unit="bar" value={draft.pressure} onChange={value => updateParameter('pressure', value)} />
            <ParameterFields label="Vazão" unit="L/min" value={draft.flow} onChange={value => updateParameter('flow', value)} />
            <ParameterFields label="Troca de calor do molde" unit="kW" value={draft.heatExchange} onChange={value => updateParameter('heatExchange', value)} />
          </section>
        </div>

        <section className="bg-neutral-50 border border-neutral-200 rounded-xl p-5 space-y-2">
          <h3 className="text-base font-bold text-neutral-900">Aplicação no Simulador</h3>
          <p className="text-sm text-neutral-600">As faixas salvas definem os estados do dashboard, o modo automático e os limites usados no cálculo da unidade simplificada.</p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded-md bg-neutral-800 border border-neutral-800 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-700">
            Salvar e usar este molde
          </button>
          {library?.molds.some(mold => mold.id === draft.id) && draft.id !== 'default' && (
            <button
              type="button"
              onClick={() => {
                socket.emit('simple:molds:delete', draft.id)
                setSaved(false)
              }}
              className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
            >
              Excluir molde
            </button>
          )}
          {saved && <span className="text-sm font-bold text-green-700">Molde salvo e selecionado.</span>}
        </div>
      </form>
    </div>
  )
}
