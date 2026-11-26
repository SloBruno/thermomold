import { BrowserRouter, HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import SimpleSimulatorPage from './pages/SimpleSimulatorPage'
import SimpleDashboardPage from './pages/SimpleDashboardPage'
import MoldParametersPage from './pages/MoldParametersPage'
import RealSensorPage from './pages/RealSensorPage'
import PumpControlPage from './pages/PumpControlPage'
import CalibrationPage from './pages/CalibrationPage'
import SupervisoryPage from './pages/SupervisoryPage'

function App() {
  const Router = import.meta.env.VITE_ROUTER_MODE === 'hash' ? HashRouter : BrowserRouter

  return (
    <Router>
      <div className="min-h-screen bg-neutral-900">
        <nav className="bg-neutral-800 border-b border-neutral-700 px-6 py-3 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-white">ThermoMold</h1>
          <div className="flex flex-wrap gap-2">
            <NavLink to="/" end className={({isActive}) => `px-4 py-1.5 rounded text-sm font-medium ${isActive ? 'bg-white text-neutral-900' : 'bg-neutral-700 text-neutral-300'}`}>Supervisório</NavLink>
            <details className="relative">
              <summary className="cursor-pointer px-4 py-1.5 rounded text-sm font-medium bg-neutral-700 text-neutral-300">Mais</summary>
              <div className="absolute z-10 right-0 mt-2 w-48 rounded bg-neutral-800 border border-neutral-600 p-2 flex flex-col gap-1">
                {[
                  ['/simple-simulator', 'Simulador'], ['/simple-dashboard', 'Dashboard'],
                  ['/mold-parameters', 'Configuração Molde'], ['/sensor-real', 'Sensor Real'],
                  ['/bombas', 'Bombas'], ['/calibracao', 'Calibração'],
                ].map(([to, label]) => <NavLink key={to} to={to} className="px-3 py-2 rounded text-sm text-neutral-200 hover:bg-neutral-700">{label}</NavLink>)}
              </div>
            </details>
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<SupervisoryPage />} />
            <Route path="/simple-simulator" element={<SimpleSimulatorPage />} />
            <Route path="/simple-dashboard" element={<SimpleDashboardPage />} />
            <Route path="/mold-parameters" element={<MoldParametersPage />} />
            <Route path="/sensor-real" element={<RealSensorPage />} />
            <Route path="/bombas" element={<PumpControlPage />} />
            <Route path="/calibracao" element={<CalibrationPage />} />
            <Route path="*" element={<Navigate to="/simple-simulator" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
