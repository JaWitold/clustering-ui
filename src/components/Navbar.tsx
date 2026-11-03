import React, { useState } from 'react'
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
  Gauge,
  Menu,
  X,
} from 'lucide-react'

export type TabId = 'viz' | 'pipeline' | 'runs' | 'assignments' | 'segments' | 'api-explorer' | 'capacity'

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'viz', label: 'Clusters & 2D Viz', icon: <Network className="w-4 h-4" /> },
    { id: 'pipeline', label: 'Pipeline Runner', icon: <Play className="w-4 h-4" /> },
    { id: 'runs', label: 'Runs Monitor', icon: <Activity className="w-4 h-4" /> },
    { id: 'assignments', label: 'Assignments', icon: <Layers className="w-4 h-4" /> },
    { id: 'segments', label: 'Segments & Strategies', icon: <Settings2 className="w-4 h-4" /> },
    { id: 'api-explorer', label: 'API Explorer', icon: <Terminal className="w-4 h-4" /> },
    { id: 'capacity', label: 'Capacity', icon: <Gauge className="w-4 h-4" /> },
  ]

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Project Title */}
          <div className="flex items-center space-x-2.5 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20 shrink-0">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col justify-center shrink-0">
              <span className="font-bold text-base sm:text-lg leading-tight bg-gradient-to-r from-purple-400 via-indigo-300 to-white bg-clip-text text-transparent whitespace-nowrap">
                Clustering Lab
              </span>
              <span className="text-[11px] text-slate-400 font-mono leading-tight whitespace-nowrap">
                v2.0 Price Engine
              </span>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden xl:flex space-x-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`flex items-center space-x-1.5 px-2.5 py-1.5 2xl:px-3 2xl:py-2 rounded-lg text-xs 2xl:text-sm font-medium transition-colors whitespace-nowrap ${
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

          {/* Right Status & Settings & Mobile Toggle */}
          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            {/* Status Indicator */}
            <div
              className={`flex items-center space-x-1.5 sm:space-x-2 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium border ${
                isConnected === true
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80'
                  : isConnected === false
                  ? 'bg-rose-950/60 text-rose-400 border-rose-800/80'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {isConnected === true ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="hidden sm:inline whitespace-nowrap">API Connected</span>
                </>
              ) : isConnected === false ? (
                <>
                  <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="hidden sm:inline whitespace-nowrap">API Offline</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400 shrink-0" />
                  <span className="hidden sm:inline whitespace-nowrap">Checking...</span>
                </>
              )}
              <button
                onClick={onRefreshStatus}
                title="Refresh API connection"
                disabled={isChecking}
                className="hover:text-white transition-opacity p-0.5"
              >
                <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Settings Button */}
            <button
              onClick={onOpenSettings}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
              title="Configure API Base URL & Token"
            >
              <Sliders className="w-5 h-5" />
            </button>

            {/* Mobile / Tablet Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="xl:hidden p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0"
              title="Toggle Navigation Menu"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile / Tablet Collapsible Menu Drawer */}
      {mobileMenuOpen && (
        <div className="xl:hidden border-t border-slate-800 bg-slate-900/95 backdrop-blur px-4 pt-2 pb-4 space-y-1 shadow-2xl">
          {tabs.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id)
                  setMobileMenuOpen(false)
                }}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
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
        </div>
      )}
    </header>
  )
}
