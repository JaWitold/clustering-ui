import type {
  Cluster,
  ClusteringRun,
  ClusterAssignment,
  AuctionSegment,
  SegmentStrategy,
} from '../types/clustering'

const DEFAULT_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:2080/v2.0'
const DEFAULT_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSIsImtpZCI6ImF1dGgta2V5LTIwMjYtMDUifQ.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODEiLCJleHAiOjE3OTMzNTc5MTEsImlhdCI6MTc5MzM1MDcxMSwidWlkIjoxMX0._UTafhHcoQdqNl3UiIMTMUaXztDGjP09ShMmFVsfo7htkz4BveYaocC90uqXipg8pPkOiAaMTnvBX7SBqm9dBQ'

export interface ApiConfig {
  baseUrl: string
  token: string
}

export function getStoredConfig(): ApiConfig {
  return {
    baseUrl: localStorage.getItem('clustering_api_base_url') || DEFAULT_BASE_URL,
    token: localStorage.getItem('clustering_jwt_token') || DEFAULT_TOKEN,
  }
}

export function saveStoredConfig(config: ApiConfig): void {
  localStorage.setItem('clustering_api_base_url', config.baseUrl.trim().replace(/\/+$/, ''))
  localStorage.setItem('clustering_jwt_token', config.token.trim())
}

export class ApiError extends Error {
  public status: number
  public data: any

  constructor(status: number, data: any, message?: string) {
    super(
      message ||
        data?.message ||
        (Array.isArray(data) && data[0]?.message) ||
        `API Error ${status}`,
    )
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit & { params?: Record<string, any> } = {},
): Promise<{ data: T; headers: Headers; status: number }> {
  const { baseUrl, token } = getStoredConfig()
  const cleanBase = baseUrl.trim().replace(/\/+$/, '')
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

  let url = `${cleanBase}${cleanEndpoint}`

  if (options.params) {
    const searchParams = new URLSearchParams()
    for (const [key, val] of Object.entries(options.params)) {
      if (val !== undefined && val !== null && val !== '') {
        if (typeof val === 'object') {
          searchParams.append(key, JSON.stringify(val))
        } else {
          searchParams.append(key, String(val))
        }
      }
    }
    const qs = searchParams.toString()
    if (qs) {
      url += (url.includes('?') ? '&' : '?') + qs
    }
  }

  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  let responseData: any = null
  const contentType = response.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) {
    try {
      responseData = await response.json()
    } catch {
      responseData = null
    }
  } else {
    const text = await response.text()
    if (text) {
      try {
        responseData = JSON.parse(text)
      } catch {
        responseData = text
      }
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, responseData)
  }

  return {
    data: responseData as T,
    headers: response.headers,
    status: response.status,
  }
}

// ---------------- API Methods ----------------

export const api = {
  // Clusters
  async listClusters(params?: {
    marking?: string
    sort?: string
    search?: string
    page?: number
    'per-page'?: number
  }): Promise<Cluster[]> {
    const filterObj: Record<string, any> = {}
    if (params?.marking) {
      filterObj.marking = params.marking
    }
    const queryParams: Record<string, any> = {}
    if (Object.keys(filterObj).length > 0) {
      queryParams.filter = filterObj
    }
    if (params?.sort) queryParams.sort = params.sort
    if (params?.search) queryParams.search = params.search
    if (params?.page) queryParams.page = params.page
    if (params?.['per-page']) queryParams['per-page'] = params['per-page']

    const res = await apiFetch<Cluster[]>('/price-engine/clustering/clusters', {
      params: queryParams,
    })
    return res.data
  },

  async getCluster(id: number): Promise<Cluster> {
    const res = await apiFetch<Cluster>(`/price-engine/clustering/clusters/${id}`)
    return res.data
  },

  async trainClusters(dto: {
    day?: string
    minSegments?: number
    maxSegments?: number
    iterations?: number
    restarts?: number
  }): Promise<void> {
    await apiFetch('/price-engine/clustering/clusters', {
      method: 'POST',
      body: JSON.stringify(dto),
    })
  },

  async transitionCluster(id: number, transition: 'Promote' | 'Retire'): Promise<Cluster> {
    const res = await apiFetch<Cluster>(`/price-engine/clustering/clusters/${id}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition }),
    })
    return res.data
  },

  // Pipeline Triggers
  async measureMarketDays(dto: { from: string; to: string }): Promise<void> {
    await apiFetch('/price-engine/clustering/market-days', {
      method: 'POST',
      body: JSON.stringify(dto),
    })
  },

  async vectorizeAuctionFeatures(dto: { day: string }): Promise<void> {
    await apiFetch('/price-engine/clustering/feature-vectors', {
      method: 'POST',
      body: JSON.stringify(dto),
    })
  },

  /** Queues the daily segment assignment of the promoted cluster for a finished day (202, deduplicated per day). */
  async assignAuctionSegments(dto: { day: string }): Promise<void> {
    await apiFetch('/price-engine/clustering/segment-assignments', {
      method: 'POST',
      body: JSON.stringify(dto),
    })
  },

  /** Queues the weekly centroid update of the promoted cluster for the window ending on the day (202, deduplicated per day). */
  async updateClusterCentroids(dto: { day: string }): Promise<void> {
    await apiFetch('/price-engine/clustering/centroid-updates', {
      method: 'POST',
      body: JSON.stringify(dto),
    })
  },

  // Runs
  async listRuns(params?: {
    type?: string
    marking?: string
    cluster?: number
    dayFrom?: string
    dayTo?: string
    sort?: string
    page?: number
    'per-page'?: number
  }): Promise<{ runs: ClusteringRun[]; totalCount?: number }> {
    const filterObj: Record<string, any> = {}
    if (params?.type) filterObj.type = params.type
    if (params?.marking) filterObj.marking = params.marking
    if (params?.cluster) filterObj.cluster = params.cluster
    if (params?.dayFrom) filterObj.dayFrom = params.dayFrom
    if (params?.dayTo) filterObj.dayTo = params.dayTo

    const queryParams: Record<string, any> = {}
    if (Object.keys(filterObj).length > 0) queryParams.filter = filterObj
    if (params?.sort) queryParams.sort = params.sort
    if (params?.page) queryParams.page = params.page
    if (params?.['per-page']) queryParams['per-page'] = params['per-page']

    const res = await apiFetch<ClusteringRun[]>('/price-engine/clustering/runs', {
      params: queryParams,
    })
    const totalCount = res.headers.get('X-Pagination-Total-Count')
      ? parseInt(res.headers.get('X-Pagination-Total-Count')!, 10)
      : undefined

    return { runs: res.data, totalCount }
  },

  async getRun(id: number): Promise<ClusteringRun> {
    const res = await apiFetch<ClusteringRun>(`/price-engine/clustering/runs/${id}`)
    return res.data
  },

  // Assignments
  async listAssignments(params?: {
    segment?: number
    marking?: string
    cluster?: number
    offerId?: string
    run?: number
    page?: number
    'per-page'?: number
  }): Promise<{ assignments: ClusterAssignment[]; totalCount?: number; totalPages?: number }> {
    const filterObj: Record<string, any> = {}
    if (params?.segment) filterObj.segment = params.segment
    if (params?.marking) filterObj.marking = params.marking
    if (params?.cluster) filterObj.cluster = params.cluster
    if (params?.offerId) filterObj.offerId = params.offerId
    if (params?.run) filterObj.run = params.run

    const queryParams: Record<string, any> = {}
    if (Object.keys(filterObj).length > 0) queryParams.filter = filterObj
    if (params?.page) queryParams.page = params.page
    if (params?.['per-page']) queryParams['per-page'] = params['per-page']

    const res = await apiFetch<ClusterAssignment[]>('/price-engine/clustering/assignments', {
      params: queryParams,
    })
    const totalCount = res.headers.get('X-Pagination-Total-Count')
      ? parseInt(res.headers.get('X-Pagination-Total-Count')!, 10)
      : undefined
    const totalPages = res.headers.get('X-Pagination-Page-Count')
      ? parseInt(res.headers.get('X-Pagination-Page-Count')!, 10)
      : undefined

    return { assignments: res.data, totalCount, totalPages }
  },

  // Segments
  /** One page of segments (API caps per-page at 100; sort: id | name | createdAt, "-" for descending). */
  async listSegments(params?: {
    search?: string
    sort?: string
    page?: number
    'per-page'?: number
  }): Promise<{ segments: AuctionSegment[]; totalCount?: number; totalPages?: number }> {
    const queryParams: Record<string, any> = {}
    if (params?.search) queryParams.search = params.search
    if (params?.sort) queryParams.sort = params.sort
    if (params?.page) queryParams.page = params.page
    if (params?.['per-page']) queryParams['per-page'] = params['per-page']
    const res = await apiFetch<AuctionSegment[]>('/price-engine/clustering/segments', { params: queryParams })
    const totalCount = res.headers.get('X-Pagination-Total-Count')
      ? parseInt(res.headers.get('X-Pagination-Total-Count')!, 10)
      : undefined
    const totalPages = res.headers.get('X-Pagination-Page-Count')
      ? parseInt(res.headers.get('X-Pagination-Page-Count')!, 10)
      : undefined
    return { segments: res.data, totalCount, totalPages }
  },

  /** Every segment, fetched page by page (for dropdowns). */
  async listAllSegments(): Promise<AuctionSegment[]> {
    const all: AuctionSegment[] = []
    for (let page = 0; page < 100; page++) {
      const res = await this.listSegments({ page, 'per-page': 100, sort: 'id' })
      all.push(...res.segments)
      if (res.totalPages !== undefined ? page + 1 >= res.totalPages : res.segments.length < 100) break
    }
    return all
  },

  async getSegment(id: number): Promise<AuctionSegment> {
    const res = await apiFetch<AuctionSegment>(`/price-engine/clustering/segments/${id}`)
    return res.data
  },

  async updateSegment(id: number, name: string): Promise<AuctionSegment> {
    const res = await apiFetch<AuctionSegment>(`/price-engine/clustering/segments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
    return res.data
  },

  // Segment Strategies
  async listSegmentStrategies(): Promise<SegmentStrategy[]> {
    const res = await apiFetch<SegmentStrategy[]>('/price-engine/clustering/segment-strategies')
    return res.data
  },

  async createSegmentStrategy(dto: {
    segment: number
    cutStrategy: string
    hikeStrategy: string
    lastFreeChangeCutStrategy: string
    lastFreeChangeHikeStrategy: string
    enabled?: boolean
    note?: string
  }): Promise<SegmentStrategy> {
    const res = await apiFetch<SegmentStrategy>('/price-engine/clustering/segment-strategies', {
      method: 'POST',
      body: JSON.stringify(dto),
    })
    return res.data
  },

  async updateSegmentStrategy(
    id: number,
    dto: {
      cutStrategy: string
      hikeStrategy: string
      lastFreeChangeCutStrategy: string
      lastFreeChangeHikeStrategy: string
      enabled?: boolean
      note?: string
    },
  ): Promise<SegmentStrategy> {
    const res = await apiFetch<SegmentStrategy>(`/price-engine/clustering/segment-strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    })
    return res.data
  },

  async deleteSegmentStrategy(id: number): Promise<void> {
    await apiFetch(`/price-engine/clustering/segment-strategies/${id}`, {
      method: 'DELETE',
    })
  },
}
