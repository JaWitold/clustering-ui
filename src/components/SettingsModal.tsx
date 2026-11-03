import React, { useState } from 'react'
import { X, Key, Globe, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react'
import { getStoredConfig, saveStoredConfig, apiFetch } from '../api/client'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

const DEFAULT_DEV_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSIsImtpZCI6ImF1dGgta2V5LTIwMjYtMDUifQ.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODEiLCJleHAiOjE3OTMzNTc5MTEsImlhdCI6MTc5MzM1MDcxMSwidWlkIjoxMX0._UTafhHcoQdqNl3UiIMTMUaXztDGjP09ShMmFVsfo7htkz4BveYaocC90uqXipg8pPkOiAaMTnvBX7SBqm9dBQ'

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [config, setConfig] = useState(getStoredConfig())
  const [testStatus, setTestStatus] = useState<{
    loading: boolean
    success?: boolean
    message?: string
    latency?: number
  }>({ loading: false })

  if (!isOpen) return null

  const handleTestConnection = async () => {
    setTestStatus({ loading: true })
    const start = performance.now()
    try {
      // Temporarily save to test
      saveStoredConfig(config)
      const res = await apiFetch<any[]>('/price-engine/clustering/clusters')
      const latency = Math.round(performance.now() - start)
      setTestStatus({
        loading: false,
        success: true,
        latency,
        message: `Successfully connected (${res.data.length} clusters found). Latency: ${latency}ms`,
      })
    } catch (err: any) {
      setTestStatus({
        loading: false,
        success: false,
        message: err?.message || 'Connection failed',
      })
    }
  }

  const handleSave = () => {
    saveStoredConfig(config)
    onSaved()
    onClose()
  }

  const handleResetToken = () => {
    setConfig((prev) => ({ ...prev, token: DEFAULT_DEV_TOKEN }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center space-x-2">
            <Globe className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-slate-100">API Connection Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">
          {/* Base URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              API Base URL
            </label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="http://localhost:2080/v2.0"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
              <span className="text-xs text-slate-500">Presets:</span>
              <button
                type="button"
                onClick={() => setConfig({ ...config, baseUrl: 'http://localhost:2080/v2.0' })}
                className="text-xs text-purple-400 hover:underline"
              >
                Local API (http://localhost:2080/v2.0)
              </button>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={() => setConfig({ ...config, baseUrl: '/v2.0' })}
                className="text-xs text-purple-400 hover:underline"
              >
                Vite Proxy (/v2.0)
              </button>
            </div>
          </div>

          {/* JWT Bearer Token */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                JWT Bearer Token
              </label>
              <button
                type="button"
                onClick={handleResetToken}
                className="text-xs text-purple-400 hover:underline flex items-center space-x-1"
              >
                <Key className="w-3 h-3" />
                <span>Fill Dev Token (User 11)</span>
              </button>
            </div>
            <textarea
              rows={4}
              value={config.token}
              onChange={(e) => setConfig({ ...config, token: e.target.value })}
              placeholder="eyJhbGciOiJFZERTQ..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              Token requires <code className="text-purple-300">Clustering:list</code>,{' '}
              <code className="text-purple-300">Clustering:manage</code>, and{' '}
              <code className="text-purple-300">Clustering:train</code> permissions.
            </p>
          </div>

          {/* Connection Test Result */}
          {testStatus.message && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-start space-x-2 ${
                testStatus.success
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
              }`}
            >
              {testStatus.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{testStatus.message}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 px-6 py-4 border-t border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus.loading}
            className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${testStatus.loading ? 'animate-spin' : ''}`} />
            <span>Test Connection</span>
          </button>
          <div className="flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors shadow-lg shadow-purple-600/30"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
