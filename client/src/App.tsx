import { BrowserRouter, HashRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import SimpleSimulatorPage from './pages/SimpleSimulatorPage'
import SimpleDashboardPage from './pages/SimpleDashboardPage'
import MoldParametersPage from './pages/MoldParametersPage'

function App() {
  const Router = import.meta.env.VITE_ROUTER_MODE === 'hash' ? HashRouter : BrowserRouter

  return (
    <Router>
      <div className="min-h-screen bg-neutral-900">
        <nav className="bg-neutral-800 border-b border-neutral-700 px-6 py-3 flex items-center gap-6">
          <h1 className="text-xl font-bold text-white">ThermoMold</h1>
          <div className="flex gap-2">
            <NavLink
              to="/simple-simulator"
              className={({ isActive }) =>
                `px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-neutral-900'
                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`
              }
            >
              Simulador
            </NavLink>
            <NavLink
              to="/simple-dashboard"
              className={({ isActive }) =>
                `px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-neutral-900'
                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/mold-parameters"
              className={({ isActive }) =>
                `px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white text-neutral-900'
                    : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                }`
              }
            >
              Configuração Molde
            </NavLink>
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/simple-simulator" element={<SimpleSimulatorPage />} />
            <Route path="/simple-dashboard" element={<SimpleDashboardPage />} />
            <Route path="/mold-parameters" element={<MoldParametersPage />} />
            <Route path="*" element={<Navigate to="/simple-simulator" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}

export default App
