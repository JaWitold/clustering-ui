import React, { useState, useEffect } from 'react'
import { Navbar, type TabId } from './components/Navbar'
import { SettingsModal } from './components/SettingsModal'
import { ClustersViz } from './components/ClustersViz'
import { PipelineRunner } from './components/PipelineRunner'
import { RunsMonitor } from './components/RunsMonitor'
import { AssignmentsView } from './components/AssignmentsView'
import { SegmentsView } from './components/SegmentsView'
import { ApiExplorer } from './components/ApiExplorer'
import { api } from './api/client'

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('viz')
  const [assignmentsOfferId, setAssignmentsOfferId] = useState<string>('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(false)

  const checkConnection = async () => {
    setIsChecking(true)
    try {
      await api.listClusters()
      setIsConnected(true)
    } catch (err) {
      console.error('API connection check failed:', err)
      setIsConnected(false)
    } finally {
      setIsChecking(false)
    }
  }

  useEffect(() => {
    checkConnection()
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-purple-500/30">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setSettingsOpen(true)}
        isConnected={isConnected}
        isChecking={isChecking}
        onRefreshStatus={checkConnection}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'viz' && (
          <ClustersViz
            onOpenOfferAssignments={(offerId) => {
              setAssignmentsOfferId(offerId)
              setActiveTab('assignments')
            }}
          />
        )}
        {activeTab === 'pipeline' && (
          <PipelineRunner onNavigateToRuns={() => setActiveTab('runs')} />
        )}
        {activeTab === 'runs' && <RunsMonitor />}
        {activeTab === 'assignments' && (
          <AssignmentsView key={assignmentsOfferId} initialOfferId={assignmentsOfferId} />
        )}
        {activeTab === 'segments' && <SegmentsView />}
        {activeTab === 'api-explorer' && <ApiExplorer />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            Eneba Price Engine • <span className="text-slate-400">Auction Clustering Flows</span> (Task 14–15)
          </div>
          <div className="flex items-center space-x-4">
            <span className="font-mono text-purple-400/80">API: /v2.0/price-engine/clustering</span>
            <span>•</span>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-slate-400 hover:text-purple-300 underline"
            >
              Configure Connection
            </button>
          </div>
        </div>
      </footer>

      {/* Connection & Auth Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={checkConnection}
      />
    </div>
  )
}

export default App
