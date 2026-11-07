import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Map, useControl, AttributionControl } from 'react-map-gl/mapbox';
import { MapboxOverlay, MapboxOverlayProps } from '@deck.gl/mapbox';
import { GeoJsonLayer, ScatterplotLayer, ArcLayer, TextLayer, PathLayer, PolygonLayer } from '@deck.gl/layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { mapConfig, mapboxToken } from '../mapConfig';
import {
  StationsData,
  HotspotsData,
  FlowsData,
  RegularsData,
  RecommendationItem,
  RouteFlowsData
} from '../types';
import { loadRouteFlows } from '../services/api';
import { getShortStationName, cleanDestinationHint, toTitleCase } from '../utils/formatters';
import { Basis, registerFlows, registerRouteFlows, getStopShares, getDropoffShares } from '../lib/shares';
import { SidePanel } from './SidePanel';
import { MapLabels, LabelItem } from './MapLabels';
import {
  prepareRoutes,
  dropoffRadius,
  chevronPolygon,
  arrowPolygon,
  routeKey,
  truncate,
  formatHour,
  PreparedRoute
} from '../routeView';
import styles from './MapScreen.module.css';
import { Play, Pause, RotateCcw, Users, Train } from 'lucide-react';

interface MapScreenProps {
  stationsData: StationsData;
  hotspotsData: HotspotsData;
  flowsData: FlowsData;
  regularsData: RegularsData;
  suburbanData?: any;
  recommendations: RecommendationItem[];
  selectedStationId: string | null;
  onSelectStation: (stationId: string | null) => void;
  onSelectRecommendation?: (rec: RecommendationItem) => void;
}

const INITIAL_VIEW_STATE = {
  longitude: 80.22,
  latitude: 13.045,
  zoom: 11.6,
  pitch: 0,
  bearing: 0
};

const DASH_EXT = [new PathStyleExtension({ dash: true })];
const hexToRgba = (hex: string): [number, number, number, number] => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; };

// DeckGL Overlay component that attaches to Mapbox using MapboxOverlay with interleaved: false
function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({
    interleaved: false,
    parameters: { depthTest: false, depthCompare: 'always' } as any
  }));
  useEffect(() => {
    overlay.setProps(props);
  }, [overlay, props.layers, props.onClick]);
  return null;
}

export const MapScreen: React.FC<MapScreenProps> = ({
  stationsData,
  hotspotsData,
  flowsData,
  regularsData,
  suburbanData,
  recommendations,
  selectedStationId,
  onSelectStation,
  onSelectRecommendation
}) => {
  const [colorMode, setColorMode] = useState<'transfers' | 'wait'>('transfers');
  const [showRegulars, setShowRegulars] = useState<boolean>(false);
  const [showSuburban, setShowSuburban] = useState<boolean>(true); // ON by default
  const [stationViewMode, setStationViewMode] = useState<'stops' | 'routes'>('routes'); // default "Bus routes"
  const [routeFlows, setRouteFlows] = useState<RouteFlowsData | null>(null);
  const [routeFlowsLoading, setRouteFlowsLoading] = useState<boolean>(false);
  const [selectedRouteName, setSelectedRouteName] = useState<string | null>(null);
  const [hoveredRouteName, setHoveredRouteName] = useState<string | null>(null);
  const [basis, setBasis] = useState<Basis>('daily');            // ONE global toggle: Daily | Selected hour (map + panel)
  const [hoveredStopId, setHoveredStopId] = useState<string | null>(null);
  const [dropTip, setDropTip] = useState<{ x: number; y: number; text: string; pct: string } | null>(null);


  const [currentHour, setCurrentHour] = useState<number>(8); // default to 8:00 morning peak
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const mapRef = useRef<any>(null);
  const [mapZoom, setMapZoom] = useState<number>(INITIAL_VIEW_STATE.zoom); // chevron/arrow size follows the settled zoom
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (window as any).__selectStation = onSelectStation;
    (window as any).__peMap = () => mapRef.current?.getMap?.();   // test hook
  }, [onSelectStation]);

  // the single source of numbers (lib/shares.ts) reads from these
  registerFlows(flowsData.flows);
  if (routeFlows) registerRouteFlows(routeFlows.station_id, routeFlows);

  // Load route_flows/<id>.json on station click (cached)
  useEffect(() => {
    if (!selectedStationId) {
      setRouteFlows(null);
      setRouteFlowsLoading(false);
      setSelectedRouteName(null);
      setHoveredRouteName(null);
      return;
    }
    setRouteFlowsLoading(true);
    setRouteFlows(null);
    setSelectedRouteName(null);
    loadRouteFlows(selectedStationId)
      .then(res => {
        if (res) registerRouteFlows(res.station_id ?? selectedStationId, res);
        setRouteFlows(res);
      })
      .catch(err => {
        console.warn('Failed to load route flows for', selectedStationId, err);
        setRouteFlows(null);
      })
      .finally(() => {
        setRouteFlowsLoading(false);
      });
  }, [selectedStationId]);

  // Play / Pause loop
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentHour(prev => (prev >= 23 ? 5 : prev + 1));
      }, 1300);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying]);

  // Decode route geometry once per station file
  const preparedRoutes = useMemo<PreparedRoute[]>(() => prepareRoutes(routeFlows), [routeFlows]);

  // Selected station objects
  const selectedStation = useMemo(() => {
    return stationsData.stations.find(s => s.id === selectedStationId) || null;
  }, [selectedStationId, stationsData]);

  const selectedHotspot = useMemo(() => {
    return hotspotsData.stations.find(s => s.id === selectedStationId) || null;
  }, [selectedStationId, hotspotsData]);

  const stationFlows = useMemo(() => {
    if (!selectedStationId) return [];
    return flowsData.flows.filter(f => f.station_id === selectedStationId);
  }, [selectedStationId, flowsData]);

  // Top stats calculations for the headline card at currentHour (Requirement 4)
  const headlineStats = useMemo(() => {
    const goodStations = hotspotsData.stations.filter(s => s.data_quality !== 'limited');

    // 1. Total transfers at currentHour across all stations
    let hourlyTotalTransfers = 0;
    hotspotsData.stations.forEach(s => {
      const hObj = s.hourly?.find(h => h.hour === currentHour);
      hourlyTotalTransfers += hObj ? (hObj.transfers ?? 0) : 0;
    });

    // 2. Top hotspot at currentHour (good quality only)
    let topStationId: string | null = null;
    let maxHourlyTransfers = -1;
    goodStations.forEach(s => {
      const hObj = s.hourly?.find(h => h.hour === currentHour);
      const transfers = hObj ? (hObj.transfers ?? 0) : 0;
      if (transfers > maxHourlyTransfers) {
        maxHourlyTransfers = transfers;
        topStationId = s.id;
      }
    });
    if (!topStationId) {
      topStationId = hotspotsData.totals?.top_station || 'central';
    }

    const topStn = stationsData.stations.find(s => s.id === topStationId);
    const topStationObj = {
      fullName: topStn ? topStn.name : 'Central',
      shortName: topStn ? getShortStationName(topStn.name, topStn.id) : 'Central'
    };

    // 3. Worst wait: highest transfer-weighted wait among good quality with >= 300 transfers/day
    const highVolumeGood = goodStations.filter(s => (s.transfers_per_day ?? 0) >= 300);
    let worstStationId: string | null = null;
    let maxWeightedWait = -1;

    highVolumeGood.forEach(s => {
      const hObj = s.hourly?.find(h => h.hour === currentHour);
      const transfers = hObj ? (hObj.transfers ?? 0) : 0;
      const wait = hObj ? (hObj.avg_wait_min ?? s.avg_wait_min ?? 0) : (s.avg_wait_min ?? 0);
      const weightedWait = transfers * wait;
      if (weightedWait > maxWeightedWait) {
        maxWeightedWait = weightedWait;
        worstStationId = s.id;
      }
    });

    if (!worstStationId || maxWeightedWait <= 0) {
      let maxDayWeighted = -1;
      highVolumeGood.forEach(s => {
        const weighted = (s.transfers_per_day ?? 0) * (s.avg_wait_min ?? 0);
        if (weighted > maxDayWeighted) {
          maxDayWeighted = weighted;
          worstStationId = s.id;
        }
      });
    }

    const worstStn = stationsData.stations.find(s => s.id === worstStationId);
    const worstWaitStationObj = {
      fullName: worstStn ? worstStn.name : 'Alandur',
      shortName: worstStn ? getShortStationName(worstStn.name, worstStn.id) : 'Alandur'
    };

    return {
      transfersCount: Math.round(hourlyTotalTransfers),
      topStation: topStationObj,
      worstWait: worstWaitStationObj
    };
  }, [hotspotsData, stationsData, currentHour]);

  // Compute tertiles dynamically from real data
  const tertiles = useMemo(() => {
    const vals = hotspotsData.stations
      .filter(s => s.data_quality !== 'limited')
      .map(s => s.transfers_per_day)
      .filter(v => typeof v === 'number' && !isNaN(v) && v > 0)
      .sort((a, b) => a - b);

    if (vals.length < 3) return { t1: 2000, t2: 5000 };
    const n = vals.length;
    const t1 = Math.round(vals[Math.floor(n / 3)]);
    const t2 = Math.round(vals[Math.floor((2 * n) / 3)]);
    return { t1, t2 };
  }, [hotspotsData]);

  const formatK = (val: number) => {
    if (val >= 1000) {
      const k = val / 1000;
      return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
    }
    return `${val}`;
  };

  // Top 8 stations for city zoom labels
  const top8Stations = useMemo(() => {
    return [...stationsData.stations]
      .map(stn => {
        const hs = hotspotsData.stations.find(h => h.id === stn.id);
        return {
          ...stn,
          transfers: hs ? hs.transfers_per_day : 0,
          shortName: getShortStationName(stn.name, stn.id)
        };
      })
      .sort((a, b) => b.transfers - a.transfers)
      .slice(0, 8);
  }, [stationsData, hotspotsData]);

  // Regulars subset: top 10 city-wide, or top 4 for selected station
  const visibleRegulars = useMemo(() => {
    if (!regularsData?.flows) return [];
    if (selectedStationId) {
      return regularsData.flows
        .filter(rf => rf.station_id === selectedStationId)
        .slice(0, 4);
    }
    return [...regularsData.flows]
      .sort((a, b) => b.regular_cards - a.regular_cards)
      .slice(0, 10);
  }, [regularsData, selectedStationId]);

  // ---- Nearby stops: exactly the rows the panel lists (≥ 1 %, max 6), straight from lib/shares ----------------------------
  const stopShares = useMemo(
    () => (selectedStationId ? getStopShares(selectedStationId, basis, currentHour) : null),
    [selectedStationId, basis, currentHour, flowsData]
  );
  const processedStops = useMemo(() => {
    if (!selectedStation || stationViewMode !== 'stops' || !stopShares) return [];
    const maxShare = Math.max(...stopShares.stops.map(r => r.raw), 1);
    return stopShares.stops.map(r => ({ ...r, radius: 6 + 8 * Math.sqrt(r.raw / maxShare) }));   // 6–14 px
  }, [selectedStation, stopShares, stationViewMode]);
  const stopSetKey = processedStops.map(s => s.id).join(',');

  // Camera control: fit bounds to the routes in "routes" mode (with padding, so edge stations stay inside), or zoom 16 in "stops" mode
  useEffect(() => {
    if (!selectedStationId || !mapRef.current) return;
    const stn = stationsData.stations.find(s => s.id === selectedStationId);
    const map = mapRef.current;

    if (stationViewMode === 'routes' && preparedRoutes.some(p => p.ahead.length > 1)) {
      const coords: [number, number][] = [];
      if (stn) coords.push([stn.lon, stn.lat]);
      preparedRoutes.forEach(p => {
        p.ahead.forEach(pt => coords.push(pt));
        if (p.item.board_lon && p.item.board_lat) coords.push([p.item.board_lon, p.item.board_lat]);
      });
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      coords.forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      });
      try {
        map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
          padding: { top: 120, bottom: 150, left: 70, right: 500 },
          maxZoom: 15.5,
          duration: 850,
          essential: true
        });
        return;
      } catch {
        // fall through to the plain station view
      }
    }

    // "Nearby stops": fit the station + every shown stop (panel covers the right 460 px)
    if (stn && stationViewMode === 'stops' && stopShares && stopShares.stops.length > 0) {
      const pts: [number, number][] = [[stn.lon, stn.lat], ...stopShares.stops.map(r => [r.lon, r.lat] as [number, number])];
      const lons = pts.map(q => q[0]), lats = pts.map(q => q[1]);
      try {
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
          padding: { top: 140, bottom: 160, left: 120, right: 460 }, maxZoom: 17, duration: 850, essential: true
        });
        return;
      } catch { /* fall through */ }
    }
    if (stn) {
      map.flyTo({
        center: [stn.lon, stn.lat],
        zoom: stationViewMode === 'routes' ? 14.5 : 16.0,
        duration: 850,
        essential: true
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationId, stationViewMode, preparedRoutes, stationsData, stopSetKey]);


  // ---- Bus routes: highlight state -------------------------------------------------------------------------------
  const shapedRoutes = useMemo(() => preparedRoutes.filter(p => p.ahead.length > 1), [preparedRoutes]);
  // a route without a shape cannot be highlighted on the map, so it never fades the others
  const activeKey = useMemo(() => {
    const k = hoveredRouteName || selectedRouteName;
    return k && shapedRoutes.some(p => p.key === k) ? k : null;
  }, [hoveredRouteName, selectedRouteName, shapedRoutes]);

  const toggleRoute = useCallback((key: string) => {
    setSelectedRouteName(prev => (prev === key ? null : key));
  }, []);

  useEffect(() => { setHoveredRouteName(null); setHoveredStopId(null); setDropTip(null); }, [stationViewMode, selectedStationId]);
  useEffect(() => { if (!activeKey) setDropTip(null); }, [activeKey]);

  // ---- Labels (screen-space placed by <MapLabels/>: collision-free, never cut at the edges) --------------------------
  const labelItems = useMemo<LabelItem[]>(() => {
    if (!selectedStation) return [];
    const items: LabelItem[] = [];

    if (stationViewMode === 'routes') {
      if (!routeFlows) return [];
      const act = shapedRoutes.find(p => p.key === activeKey) ?? null;
      // map labels = route ends only ("35C → Korattur"). No % pills here: drop-offs are small dots, their % lives in the panel + tooltip.
      shapedRoutes.forEach(p => {
        if (act && p !== act) return;
        const end = p.item.is_loop ? 'loop' : toTitleCase(p.item.route_end?.name || '');
        const hasArrow = p.label !== p.item.route;   // same route in both directions: the label already reads "<route> → <end>"
        const text = p.item.is_loop ? `${p.label} · loop` : hasArrow ? p.label : `${p.label} → ${truncate(end, 26)}`;
        items.push({
          id: `end-${p.key}`, kind: 'end', lon: p.arrow!.position[0], lat: p.arrow!.position[1], text, color: p.color, dotR: 6,
          active: p === act, must: true, title: `${p.label} → ${end}`,
          onClick: () => toggleRoute(p.key)
        });
      });
      return items;
    }

    // "Nearby stops": "<Stop name> · <share>%" — the same number as the panel row, largest stop first
    processedStops.forEach(f => {
      const text = `${truncate(toTitleCase(f.name), 24)} · ${f.label}`;
      items.push({
        id: `stop-${f.id}`, kind: 'stop', lon: f.lon, lat: f.lat, text, color: '#EA580C', dotR: f.radius, must: true,
        highlight: hoveredStopId === f.id, title: `${toTitleCase(f.name)} · ${f.label} of Metro exits walk to this stop`,
        onHover: on => setHoveredStopId(on ? f.id : null)
      });
    });
    return items;
  }, [selectedStation, stationViewMode, routeFlows, shapedRoutes, activeKey, processedStops, hoveredStopId, toggleRoute]);

  const avoidPaths = useMemo(() => (stationViewMode === 'routes' ? shapedRoutes.map(p => p.ahead) : []), [stationViewMode, shapedRoutes]);

  // ---- Bus route layers (separate memo: hover/selection must not rebuild the base map) -----------------------------
  const routeLayers = useMemo(() => {
    if (stationViewMode !== 'routes' || !selectedStation || shapedRoutes.length === 0) return [];
    const act = shapedRoutes.find(p => p.key === activeKey) ?? null;
    const faded = (p: PreparedRoute) => !!act && p !== act;
    const bg = act ? shapedRoutes.filter(p => p !== act) : shapedRoutes;
    const fg = act ? [act] : [];
    const onHover = (info: any) => setHoveredRouteName(info.object?.key ?? null);
    const onClick = (info: any) => { if (info.object?.key) toggleRoute(info.object.key); };
    const list: any[] = [];

    // station → board stop (thin dashed grey)
    list.push(new PathLayer({
      id: 'route-connectors',
      data: shapedRoutes.filter(p => p.board),
      getPath: (p: PreparedRoute) => [[selectedStation.lon, selectedStation.lat], [p.item.board_lon, p.item.board_lat]],
      getColor: (p: PreparedRoute) => [100, 116, 139, faded(p) ? 40 : 200],
      getWidth: 1.5, widthUnits: 'pixels', getDashArray: [4, 3], dashJustified: true, extensions: DASH_EXT,
      updateTriggers: { getColor: [activeKey] }
    } as any));

    // before the board stop / beyond the route end: thin, dashed, 40 % opacity
    const faint = shapedRoutes.flatMap(p => p.faint.map(path => ({ path, p })));
    if (faint.length) list.push(new PathLayer({
      id: 'route-faint', data: faint,
      getPath: (d: any) => d.path,
      getColor: (d: any) => [...d.p.rgb, faded(d.p) ? 38 : 102],
      getWidth: 2, widthUnits: 'pixels', getDashArray: [4, 3], dashJustified: true, capRounded: true, jointRounded: true, extensions: DASH_EXT,
      updateTriggers: { getColor: [activeKey] }
    } as any));

    const lineLayers = (suffix: string, data: PreparedRoute[]) => {
      if (!data.length) return;
      const common = { widthUnits: 'pixels', capRounded: true, jointRounded: true, getPath: (p: PreparedRoute) => p.ahead, updateTriggers: { getColor: [activeKey], getWidth: [activeKey] } };
      list.push(new PathLayer({ ...common, id: `route-casing-${suffix}`, data, getColor: (p: PreparedRoute) => [255, 255, 255, faded(p) ? 38 : 255], getWidth: (p: PreparedRoute) => (p === act ? 7 : 4) + 4 } as any));
      list.push(new PathLayer({
        ...common, id: `route-line-${suffix}`, data, pickable: true, onHover, onClick,
        getColor: (p: PreparedRoute) => [...p.rgb, faded(p) ? 38 : 255], getWidth: (p: PreparedRoute) => (p === act ? 7 : 4)
      } as any));
      list.push(new PolygonLayer({
        id: `route-chevrons-${suffix}`, data: data.flatMap(p => p.chevrons), opacity: suffix === 'bg' && act ? 0.15 : 1,
        getPolygon: (c: any) => chevronPolygon(c, mapZoom, suffix === 'fg' ? 14 : 12),
        getFillColor: (c: any) => hexToRgba(c.color), stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 1,
        updateTriggers: { getPolygon: [mapZoom] }
      } as any));
    };
    lineLayers('bg', bg);
    lineLayers('fg', fg);

    // board stop: where the solid line starts
    list.push(new ScatterplotLayer({
      id: 'route-board-stops', data: shapedRoutes, getPosition: (p: PreparedRoute) => p.board!,
      radiusUnits: 'pixels', getRadius: 5, getFillColor: [255, 255, 255, 255], stroked: true, lineWidthUnits: 'pixels', getLineWidth: 3,
      getLineColor: (p: PreparedRoute) => [...p.rgb, faded(p) ? 60 : 255], updateTriggers: { getLineColor: [activeKey] }
    } as any));

    // drop-off dots, ON the line: all routes while nothing is selected, only the highlighted route otherwise.
    // Their % is NOT a map pill; with a route selected it shows as a tooltip (and in the panel's drop-off list).
    const dots = (act ? [act] : shapedRoutes).flatMap(p => getDropoffShares(p.item, basis, currentHour).rows.map(d => ({
      position: [d.lon, d.lat], r: dropoffRadius(d.raw), rgb: p.rgb, name: d.name, label: d.label, route: p.label
    })));
    list.push(new ScatterplotLayer({
      id: 'route-dropoffs', data: dots, getPosition: (d: any) => d.position, radiusUnits: 'pixels', getRadius: (d: any) => d.r,
      getFillColor: (d: any) => [...d.rgb, 255], stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 2,
      pickable: !!act,
      onHover: (info: any) => setDropTip(info.object && act ? { x: info.x, y: info.y, pct: info.object.label, text: `${toTitleCase(info.object.name)} — ${info.object.label} of ${info.object.route} riders get off here` } : null)
    } as any));
    // ONE arrowhead at the route end (last segment, also for loops)
    const arrows = (suffix: string, data: PreparedRoute[]) => data.length && list.push(new PolygonLayer({
      id: `route-arrow-${suffix}`, data: data.filter(p => p.arrow).map(p => p.arrow!), opacity: suffix === 'bg' && act ? 0.15 : 1,
      getPolygon: (a: any) => arrowPolygon(a, mapZoom, suffix === 'fg' ? 22 : 18),
      getFillColor: (a: any) => hexToRgba(a.color), stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 1.5,
      updateTriggers: { getPolygon: [mapZoom] }
    } as any));
    arrows('bg', bg);
    arrows('fg', fg);

    return list;
  }, [stationViewMode, selectedStation, shapedRoutes, activeKey, currentHour, basis, toggleRoute, mapZoom]);

  // Deck.gl Layers
  const layers = useMemo(() => {
    const list: any[] = [];

    // 0. SUBURBAN RAIL LAYER (Requirement 4: context only, drawn beneath Metro and bus layers)
    if (showSuburban && suburbanData?.features) {
      const lineFeatures = suburbanData.features.filter(
        (f: any) => f.properties?.kind === 'line' || f.geometry?.type?.includes('Line')
      );
      const stationFeatures = suburbanData.features.filter(
        (f: any) => f.properties?.kind === 'station' || f.geometry?.type === 'Point'
      );
      const namedStations = stationFeatures.filter((f: any) => f.properties?.name);

      // Lines in grey #8A94A6, 2 px, dashed (MRTS slightly darker)
      list.push(
        new GeoJsonLayer({
          id: 'suburban-rail-lines',
          data: lineFeatures,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          getLineColor: (f: any) => {
            const type = f.properties?.type;
            if (type === 'MRTS' || type === 'MRTS&Sub') return [82, 93, 115, 230];
            return [138, 148, 166, 210];
          },
          getDashArray: [4, 3],
          dashJustified: true,
          pickable: false
        })
      );

      // Stations: small grey dots, fixed pixel size (a size in degrees balloons into a grey block at street zoom)
      list.push(
        new ScatterplotLayer({
          id: 'suburban-rail-stations',
          data: stationFeatures,
          getPosition: (f: any) => f.geometry.coordinates,
          radiusUnits: 'pixels',
          getRadius: 3.5,
          getFillColor: [138, 148, 166, 240],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthUnits: 'pixels',
          getLineWidth: 1
        })
      );

      // Labels only where name exists, at zoom >= 12
      list.push(
        new TextLayer({
          id: 'suburban-rail-labels',
          data: namedStations,
          minZoom: 12.0,
          getPosition: (d: any) => d.geometry.coordinates,
          getText: (d: any) => d.properties.name,
          getSize: 10,
          getColor: [71, 85, 105, 255],
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          background: true,
          getBackgroundColor: [255, 255, 255, 230],
          backgroundPadding: [4, 2],
          getPixelOffset: [0, -14],
          getTextAnchor: 'middle'
        })
      );
    }

    // 1. Metro Lines
    if (stationsData.lines && stationsData.lines.features) {
      list.push(
        new GeoJsonLayer({
          id: 'metro-lines-layer',
          data: stationsData.lines,
          stroked: true,
          filled: false,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 2.5,
          getLineColor: (f: any) => {
            const line = f.properties?.line;
            if (line === 'Blue') return [47, 107, 255, 230];
            if (line === 'Green') return [43, 168, 74, 230];
            return [59, 111, 224, 200];
          },
          getLineWidth: 2.5,
          pickable: false
        })
      );
    }

    // 2. Hotspot Station Circles (Fixed pixel size 6-24px, square-root scale)
    const stationPoints = stationsData.stations.map(stn => {
      const hspot = hotspotsData.stations.find(h => h.id === stn.id);
      const hourlyObj = hspot?.hourly?.find(h => h.hour === currentHour);
      const hTransfers = hourlyObj ? (hourlyObj.transfers ?? 0) : 0;
      const hWait = hourlyObj ? (hourlyObj.avg_wait_min ?? 0) : 0;
      const isLimited = hspot?.data_quality === 'limited';

      return {
        ...stn,
        hspot,
        currentTransfers: hTransfers,
        currentWait: hWait,
        level: hspot?.level || 'medium',
        wait_level: hspot?.wait_level || 'ok',
        data_quality: hspot?.data_quality || 'good',
        isLimited,
        shortName: getShortStationName(stn.name, stn.id)
      };
    });

    list.push(
      new ScatterplotLayer({
        id: 'hotspot-circles-layer',
        data: stationPoints,
        getPosition: (d: any) => [d.lon, d.lat],
        radiusUnits: 'pixels',
        getRadius: (d: any) => {
          const val = Math.max(0, d.currentTransfers);
          const r = 6 + Math.sqrt(val) * 0.22;
          return Math.min(24, Math.max(6, r));
        },
        radiusMinPixels: 6,
        radiusMaxPixels: 24,
        getFillColor: (d: any) => {
          const isOther = selectedStationId && d.id !== selectedStationId;
          const alpha = isOther ? 70 : 235;

          if (d.isLimited) {
            return [245, 247, 250, isOther ? 25 : 50];
          }
          if (colorMode === 'transfers') {
            if (d.level === 'high') return [229, 72, 77, alpha];
            if (d.level === 'medium') return [245, 165, 36, alpha];
            return [70, 167, 88, alpha];
          } else {
            if (d.wait_level === 'bad') return [229, 72, 77, alpha];
            if (d.wait_level === 'ok') return [245, 165, 36, alpha];
            return [70, 167, 88, alpha];
          }
        },
        stroked: true,
        getLineColor: (d: any) => {
          const isOther = selectedStationId && d.id !== selectedStationId;
          if (d.id === selectedStationId) {
            return [24, 28, 36, 255];
          }
          if (d.isLimited) {
            return [140, 145, 155, isOther ? 70 : 255];
          }
          return [255, 255, 255, isOther ? 80 : 230];
        },
        lineWidthUnits: 'pixels',
        getLineWidth: (d: any) => (d.id === selectedStationId ? 3.0 : 1.5),
        pickable: true,
        onClick: (info: any) => {
          if (info.object) {
            onSelectStation(info.object.id);
          }
        }
      })
    );

    // 3. Top 8 station labels at city zoom (using deck.gl built-in maxZoom: 14.5 for GPU-level cutoff)
    if (!selectedStationId) {
      list.push(
        new TextLayer({
          id: 'city-top-stations-labels',
          data: top8Stations,
          maxZoom: 14.5,
          getPosition: (d: any) => [d.lon, d.lat],
          getText: (d: any) => d.shortName,
          getSize: 11,
          getColor: [24, 28, 36, 255],
          fontFamily: 'Inter, sans-serif',
          fontWeight: 700,
          background: true,
          getBackgroundColor: [255, 255, 255, 240],
          backgroundPadding: [5, 3],
          getPixelOffset: [0, -18],
          getTextAnchor: 'middle'
        })
      );
    }

    // 4. Regulars Flows Layer (top 10 city-wide or top 4 for selected station)
    if (showRegulars && visibleRegulars.length > 0) {
      const regFlows = visibleRegulars.map(rf => {
        const origin = stationsData.stations.find(s => s.id === rf.station_id);
        const cleanDest = cleanDestinationHint(rf.dest_name || '');
        return {
          ...rf,
          cleanDest,
          originLon: origin ? origin.lon : 80.22,
          originLat: origin ? origin.lat : 13.04
        };
      });

      list.push(
        new ArcLayer({
          id: 'regulars-arcs',
          data: regFlows,
          getSourcePosition: (d: any) => [d.originLon, d.originLat],
          getTargetPosition: (d: any) => [d.dest_lon, d.dest_lat],
          getSourceColor: [147, 51, 234, 180],
          getTargetColor: [192, 132, 252, 220],
          getWidth: 2.5,
          getHeight: 0.35
        })
      );

      list.push(
        new TextLayer({
          id: 'regulars-labels',
          data: regFlows,
          getPosition: (d: any) => [d.dest_lon, d.dest_lat],
          getText: (d: any) => `~${d.regular_cards} regulars · likely ${d.cleanDest}`,
          getSize: 11,
          getColor: [107, 33, 168, 255],
          fontFamily: 'Inter, sans-serif',
          fontWeight: 600,
          background: true,
          getBackgroundColor: [255, 255, 255, 245],
          backgroundPadding: [6, 4],
          getPixelOffset: [0, -14],
          getTextAnchor: 'middle'
        })
      );
    }

    // 5B. NEARBY STOPS (When in 'stops' mode): straight dashed walking lines to each stop's true location + orange markers
    if (stationViewMode === 'stops' && selectedStation && processedStops.length > 0) {
      const hov = hoveredStopId;
      list.push(
        new PathLayer({
          id: 'station-walk-lines',
          data: processedStops,
          getPath: (d: any) => [[selectedStation.lon, selectedStation.lat], [d.lon, d.lat]],
          getColor: (d: any) => (d.id === hov ? [234, 88, 12, 255] : [100, 116, 139, hov ? 120 : 230]),
          getWidth: (d: any) => (d.id === hov ? 3.5 : 2),
          widthUnits: 'pixels',
          getDashArray: [5, 3],
          dashJustified: true,
          extensions: DASH_EXT,
          updateTriggers: { getColor: [hov], getWidth: [hov] }
        } as any)
      );

      list.push(
        new ScatterplotLayer({
          id: 'station-stop-dots',
          data: processedStops,
          getPosition: (d: any) => [d.lon, d.lat],
          getRadius: (d: any) => d.radius + (d.id === hov ? 3 : 0),
          radiusUnits: 'pixels',
          getFillColor: [234, 88, 12, 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          pickable: true,
          onHover: (info: any) => setHoveredStopId(info.object?.id ?? null),
          updateTriggers: { getRadius: [hov] }
        } as any)
      );
    }

    return list;
  }, [
    stationsData,
    hotspotsData,
    suburbanData,
    showSuburban,
    colorMode,
    showRegulars,
    visibleRegulars,
    currentHour,
    selectedStation,
    selectedStationId,
    top8Stations,
    processedStops,
    hoveredStopId,
    stationViewMode
  ]);

  const allLayers = useMemo(() => [...layers, ...routeLayers], [layers, routeLayers]);

  const handleMapClick = useCallback((info: any) => {
    if (info.object) return;
    if (selectedRouteName) {            // click on empty map: first clear the route selection
      setSelectedRouteName(null);
      setHoveredRouteName(null);
    } else if (selectedStationId) {
      onSelectStation(null);
    }
  }, [selectedRouteName, selectedStationId, onSelectStation]);

  return (
    <div className={styles.mapContainer}>
      <Map
        ref={mapRef}
        mapLib={mapConfig.mapLib as any}
        reuseMaps={true}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={mapConfig.mapStyle}
        mapboxAccessToken={mapboxToken}
        preserveDrawingBuffer={false}
        maxTileCacheSize={150}
        renderWorldCopies={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        onZoomEnd={(e: any) => setMapZoom(Math.round(e.viewState.zoom * 20) / 20)}
      >
        <AttributionControl position="bottom-right" compact={false} />

        {/* DeckGL mounted as MapboxOverlay with interleaved: false */}
        <DeckGLOverlay
          interleaved={false}
          layers={allLayers}
          pickingRadius={6}
          onClick={handleMapClick}
          getCursor={({ isHovering }: any) => (isHovering ? 'pointer' : 'default')}
        />
      </Map>

      {dropTip && (
        <div className={styles.dropTip} data-dropoff-tip={dropTip.pct} style={{ left: dropTip.x + 12, top: dropTip.y + 12 }}>{dropTip.text}</div>
      )}

      {/* Labels are laid out in screen space (collision-free, 24 px from the edges) */}
      <MapLabels mapRef={mapRef} items={labelItems} avoid={avoidPaths} />

      {/* Top-Left: Three Numbers Headline Card (Requirement 4) */}
      <div className={styles.topLeftStats} data-label-obstacle>
        <div className={styles.statBox}>
          <span className={styles.statValue}>~{headlineStats.transfersCount.toLocaleString()}</span>
          <span className={styles.statLabel}>transfers/hr (at {formatHour(currentHour)})</span>
        </div>
        <div className={styles.statDivider}></div>
        <div className={styles.statBox} title={headlineStats.topStation.fullName}>
          <span className={styles.statValue}>{headlineStats.topStation.shortName}</span>
          <span className={styles.statLabel}>top hotspot (at {formatHour(currentHour)})</span>
        </div>
        <div className={styles.statDivider}></div>
        <div className={styles.statBox} title={headlineStats.worstWait.fullName}>
          <span className={styles.statValue}>{headlineStats.worstWait.shortName}</span>
          <span className={styles.statLabel}>worst wait (at {formatHour(currentHour)})</span>
        </div>
      </div>

      {/* Top-Right: Segmented Mode Toggle + Regulars Toggle + Suburban Rail Toggle + Dark Mode + Legend */}
      <div className={styles.topRightControls} data-label-obstacle>
        <div className={styles.controlsCard}>
          <div className={styles.segmentedToggle}>
            <button
              className={`${styles.toggleBtn} ${colorMode === 'transfers' ? styles.toggleActive : ''}`}
              onClick={() => setColorMode('transfers')}
            >
              Transfers
            </button>
            <button
              className={`${styles.toggleBtn} ${colorMode === 'wait' ? styles.toggleActive : ''}`}
              onClick={() => setColorMode('wait')}
            >
              Wait time
            </button>
          </div>

          <button
            className={`${styles.layerToggleBtn} ${showSuburban ? styles.layerToggleActive : ''}`}
            onClick={() => setShowSuburban(!showSuburban)}
            title="Toggle Chennai Suburban rail & MRTS network"
          >
            <Train size={14} />
            <span>Suburban rail</span>
          </button>

          <button
            className={`${styles.layerToggleBtn} ${showRegulars ? styles.layerToggleActive : ''}`}
            onClick={() => setShowRegulars(!showRegulars)}
            title="Toggle regular commuter flows across Chennai"
          >
            <Users size={14} />
            <span>Regulars</span>
          </button>
        </div>

        {/* Legend with Data-Driven Tertile Thresholds */}
        <div className={styles.legendCard}>
          <div className={styles.legendHeader}>
            <span className={styles.legendTitle}>
              {colorMode === 'transfers' ? 'Transfers / Day' : 'Transfer Wait'}
            </span>
          </div>

          {colorMode === 'transfers' ? (
            <div className={styles.legendRows}>
              <div className={styles.legendRow}>
                <span className={styles.legendCircle} style={{ background: '#E5484D' }}></span>
                <span className={styles.legendText}>High (≥ {formatK(tertiles.t2)}/day)</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendCircle} style={{ background: '#F5A524' }}></span>
                <span className={styles.legendText}>Medium ({formatK(tertiles.t1)}–{formatK(tertiles.t2)}/day)</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendCircle} style={{ background: '#46A758' }}></span>
                <span className={styles.legendText}>Low (&lt; {formatK(tertiles.t1)}/day)</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendHollowCircle}></span>
                <span className={styles.legendText}>Limited bus-stop data</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendSuburbanDashed}></span>
                <span className={styles.legendText}>Suburban rail (no ticket data)</span>
              </div>
            </div>
          ) : (
            <div className={styles.legendRows}>
              <div className={styles.legendRow}>
                <span className={styles.legendCircle} style={{ background: '#E5484D' }}></span>
                <span className={styles.legendText}>Critical (&gt; 12 min)</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendCircle} style={{ background: '#F5A524' }}></span>
                <span className={styles.legendText}>Moderate (8–12 min)</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendCircle} style={{ background: '#46A758' }}></span>
                <span className={styles.legendText}>Good (&lt; 8 min)</span>
              </div>
              <div className={styles.legendRow}>
                <span className={styles.legendSuburbanDashed}></span>
                <span className={styles.legendText}>Suburban rail (no ticket data)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Timeline Scrubber */}
      <div className={styles.timeBarCard} data-label-obstacle>
        <button
          className={styles.playBtn}
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? 'Pause simulation' : 'Play day progression'}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
        </button>

        <div className={styles.hourDisplay}>
          <span className={styles.hourText}>{formatHour(currentHour)}</span>
          <span className={styles.hourPeriod}>{getHourPeriod(currentHour)}</span>
        </div>

        <div className={styles.sliderWrap}>
          <input
            type="range"
            min="5"
            max="23"
            value={currentHour}
            onChange={e => {
              setCurrentHour(Number(e.target.value));
              if (isPlaying) setIsPlaying(false);
            }}
            className={styles.slider}
          />
          <div className={styles.ticks}>
            <span>05:00</span>
            <span className={styles.peakMark}>08:00 (Peak)</span>
            <span>12:00</span>
            <span className={styles.peakMark}>18:00 (Peak)</span>
            <span>23:00</span>
          </div>
        </div>

        <button
          className={styles.resetBtn}
          onClick={() => {
            setCurrentHour(8);
            setIsPlaying(false);
          }}
          title="Reset to morning peak (08:00)"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Side Panel on Station Click */}
      <SidePanel
        station={selectedStation}
        hotspot={selectedHotspot}
        flows={stationFlows}
        recommendations={recommendations}
        currentHour={currentHour}
        stationViewMode={stationViewMode}
        onStationViewModeChange={setStationViewMode}
        basis={basis}
        onBasisChange={setBasis}
        hoveredStopId={hoveredStopId}
        onHoverStop={setHoveredStopId}
        routeFlows={routeFlows}
        routeFlowsLoading={routeFlowsLoading}
        selectedRouteName={selectedRouteName}
        onSelectRoute={setSelectedRouteName}
        onHoverRoute={setHoveredRouteName}
        onClose={() => onSelectStation(null)}
        onSelectRecommendation={onSelectRecommendation}
      />
    </div>
  );
};

function getHourPeriod(hour: number): string {
  if (hour >= 7 && hour <= 10) return 'Morning Peak';
  if (hour >= 17 && hour <= 20) return 'Evening Peak';
  if (hour < 12) return 'Morning Off-Peak';
  if (hour < 17) return 'Afternoon Off-Peak';
  return 'Night Off-Peak';
}

function truncateText(text: string, maxLen: number): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
}
