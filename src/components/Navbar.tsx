import React from 'react'
import {
  Network,
  Play,
  Activity,
  Layers,
  Settings2,
  Terminal,
  Sliders,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react'

export type TabId = 'viz' | 'pipeline' | 'runs' | 'assignments' | 'segments' | 'api-explorer'

interface NavbarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  onOpenSettings: () => void
  isConnected: boolean | null
  isChecking: boolean
  onRefreshStatus: () => void
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  isConnected,
  isChecking,
  onRefreshStatus,
}) => {
  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'viz', label: 'Clusters & 2D Viz', icon: <Network className="w-4 h-4" /> },
    { id: 'pipeline', label: 'Pipeline Runner', icon: <Play className="w-4 h-4" /> },
    { id: 'runs', label: 'Runs Monitor', icon: <Activity className="w-4 h-4" /> },
    { id: 'assignments', label: 'Assignments', icon: <Layers className="w-4 h-4" /> },
    { id: 'segments', label: 'Segments & Strategies', icon: <Settings2 className="w-4 h-4" /> },
    { id: 'api-explorer', label: 'API Explorer', icon: <Terminal className="w-4 h-4" /> },
  ]

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Project Title */}
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg bg-gradient-to-r from-purple-400 via-indigo-300 to-white bg-clip-text text-transparent">
                Clustering Lab
              </span>
              <span className="ml-2 text-xs text-slate-400 font-mono px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700">
                v2.0 Price Engine
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Right Status & Settings */}
          <div className="flex items-center space-x-3">
            {/* Status Indicator */}
            <div
              className={`flex items-center space-x-2 px-2.5 py-1 rounded-full text-xs font-medium border ${
                isConnected === true
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80'
                  : isConnected === false
                  ? 'bg-rose-950/60 text-rose-400 border-rose-800/80'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {isConnected === true ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>API Connected</span>
                </>
              ) : isConnected === false ? (
                <>
                  <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>API Offline</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                  <span>Checking...</span>
                </>
              )}
              <button
                onClick={onRefreshStatus}
                title="Refresh API connection"
                disabled={isChecking}
                className="hover:text-white transition-opacity"
              >
                <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Settings Button */}
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Configure API Base URL & Token"
            >
              <Sliders className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
