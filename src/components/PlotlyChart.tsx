import React, { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'

interface PlotlyChartProps {
  data: any[]
  layout?: any
  config?: any
  className?: string
  /** Called with the clicked point (Plotly event point: trace, pointIndex, customdata, …). */
  onPointClick?: (point: any) => void
}

export const PlotlyChart: React.FC<PlotlyChartProps> = ({
  data,
  layout = {},
  config = {},
  className = 'w-full h-full min-h-[500px]',
  onPointClick,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const clickHandlerRef = useRef(onPointClick)

  useEffect(() => {
    clickHandlerRef.current = onPointClick
  }, [onPointClick])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const mergedLayout = {
      autosize: true,
      paper_bgcolor: '#0b1120',
      plot_bgcolor: '#020617',
      font: {
        color: '#94a3b8',
        family: 'system-ui, -apple-system, sans-serif',
      },
      margin: { l: 60, r: 40, t: 50, b: 60 },
      hoverlabel: {
        bgcolor: '#1e293b',
        bordercolor: '#64748b',
        font: { color: '#f8fafc', size: 12 },
      },
      xaxis: {
        gridcolor: '#1e293b',
        zerolinecolor: '#334155',
        tickcolor: '#334155',
        ...(layout.xaxis || {}),
      },
      yaxis: {
        gridcolor: '#1e293b',
        zerolinecolor: '#334155',
        tickcolor: '#334155',
        ...(layout.yaxis || {}),
      },
      ...layout,
    }

    const mergedConfig = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      ...config,
    }

    Plotly.react(el, data, mergedLayout, mergedConfig).then((gd: any) => {
      gd.removeAllListeners?.('plotly_click')
      gd.on('plotly_click', (ev: any) => {
        const point = ev?.points?.[0]
        if (point && clickHandlerRef.current) clickHandlerRef.current(point)
      })
    })

    const handleResize = () => {
      Plotly.Plots.resize(el)
    }

    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(el)

    return () => {
      resizeObserver.disconnect()
      Plotly.purge(el)
    }
  }, [data, layout, config])

  return <div ref={containerRef} className={className} />
}
