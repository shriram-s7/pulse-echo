import {
  StationsData,
  HotspotsData,
  FlowsData,
  StationDetail,
  RecommendationsData,
  RegularsData,
  NudgeData,
  QualityReport,
  MethodData,
  RouteFlowsData
} from '../types';

let mockDataInUse = true;
let apiAvailable = false;
let resolvedApiBase = 'http://127.0.0.1:8000/data';
let probePromise: Promise<boolean> | null = null;
const listeners = new Set<(isMock: boolean) => void>();

// In-memory cache for station detail records
const stationDetailCache = new Map<string, Promise<StationDetail>>();
const routeFlowsCache = new Map<string, Promise<RouteFlowsData | null>>();
let suburbanCache: Promise<any> | null = null;

export function subscribeMockStatus(listener: (isMock: boolean) => void) {
  listeners.add(listener);
  listener(mockDataInUse);
  return () => {
    listeners.delete(listener);
  };
}

function setMockStatus(isMock: boolean) {
  if (mockDataInUse !== isMock) {
    mockDataInUse = isMock;
    listeners.forEach((cb) => cb(mockDataInUse));
  }
}

export function getIsMockData(): boolean {
  return mockDataInUse;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 1000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Check if real API is alive; deduplicate concurrent probes and use fastest host
async function probeApi(): Promise<boolean> {
  if (apiAvailable) return true;
  // Hosted demo (e.g. Vercel): no backend, the exported JSON ships as static files in /data
  if (typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    apiAvailable = true;
    resolvedApiBase = '/data';
    setMockStatus(false);
    return true;
  }
  if (probePromise) return probePromise;

  probePromise = (async () => {
    // Try 127.0.0.1 first (bypasses Windows IPv6 resolution delay: 11ms vs 83ms)
    try {
      const res = await fetchWithTimeout('http://127.0.0.1:8000/data/hotspots.json', 800);
      if (res.ok) {
        apiAvailable = true;
        resolvedApiBase = 'http://127.0.0.1:8000/data';
        setMockStatus(false);
        return true;
      }
    } catch {
      // Fallback probe to localhost
      try {
        const res = await fetchWithTimeout('http://localhost:8000/data/hotspots.json', 1000);
        if (res.ok) {
          apiAvailable = true;
          resolvedApiBase = 'http://localhost:8000/data';
          setMockStatus(false);
          return true;
        }
      } catch {
        // Backend not alive
      }
    }
    setMockStatus(true);
    return false;
  })();

  const result = await probePromise;
  probePromise = null;
  return result;
}

async function loadData<T>(endpoint: string): Promise<T> {
  const isApiLive = await probeApi();
  const apiPath = `${resolvedApiBase}/${endpoint}`;
  const mockPath = `/mock/${endpoint}`;

  if (isApiLive) {
    try {
      const res = await fetchWithTimeout(apiPath, 1500);
      if (res.ok) {
        const data = await res.json();
        return data as T;
      }
    } catch {
      // Endpoint failed; fall back to mock
    }
  }

  // Fallback to local /mock/
  try {
    const res = await fetch(mockPath);
    if (!res.ok) {
      throw new Error(`Failed to load mock file: ${mockPath}`);
    }
    const data = await res.json();
    return data as T;
  } catch (err) {
    console.error(`Error loading data for ${endpoint}:`, err);
    throw err;
  }
}

export async function loadStations(): Promise<StationsData> {
  return loadData<StationsData>('stations.json');
}

export async function loadHotspots(): Promise<HotspotsData> {
  return loadData<HotspotsData>('hotspots.json');
}

export async function loadFlows(): Promise<FlowsData> {
  return loadData<FlowsData>('flows.json');
}

export async function loadStationDetail(id: string): Promise<StationDetail> {
  const cached = stationDetailCache.get(id);
  if (cached) return cached;
  const p = loadData<StationDetail>(`station/${id}.json`);
  stationDetailCache.set(id, p);
  return p;
}

export async function loadRecommendations(): Promise<RecommendationsData> {
  return loadData<RecommendationsData>('recommendations.json');
}

export async function loadRegulars(): Promise<RegularsData> {
  return loadData<RegularsData>('regulars.json');
}

export async function loadNudge(): Promise<NudgeData> {
  return loadData<NudgeData>('nudge.json');
}

export async function loadQualityReport(): Promise<QualityReport> {
  return loadData<QualityReport>('quality_report.json');
}

export async function loadMethod(): Promise<MethodData> {
  return loadData<MethodData>('method.json');
}

export async function loadSuburban(): Promise<any> {
  if (suburbanCache) return suburbanCache;
  suburbanCache = loadData<any>('suburban.geojson').catch(err => {
    console.warn('Failed to load suburban.geojson:', err);
    return null;
  });
  return suburbanCache;
}

export async function loadRouteFlows(id: string): Promise<RouteFlowsData | null> {
  const cached = routeFlowsCache.get(id);
  if (cached) return cached;
  const p = (async () => {
    try {
      const res = await loadData<RouteFlowsData>(`route_flows/${id}.json`);
      if (res && res.routes) return res;
    } catch {
      // try alias
    }
    if (id === 'washermanpet') {
      try {
        const aliasRes = await loadData<RouteFlowsData>('route_flows/washermenpet.json');
        if (aliasRes && aliasRes.routes) return aliasRes;
      } catch {
        // ignore
      }
    }
    return null;
  })();
  routeFlowsCache.set(id, p);
  return p;
}
