export interface Station {
  id: string;
  name: string;
  line: 'Blue' | 'Green' | 'Both' | string;
  lat: number;
  lon: number;
}

export interface StationsData {
  stations: Station[];
  lines: {
    type: 'FeatureCollection';
    features: any[];
  };
}

export interface HourlyHotspot {
  hour: number;
  exits: number;
  transfers: number;
  avg_wait_min: number;
}

export interface HotspotStation {
  id: string;
  exits_per_day: number;
  transfers_per_day: number;
  transfer_pct: number;
  avg_wait_min: number;
  level: 'high' | 'medium' | 'low';
  wait_level: 'good' | 'ok' | 'bad';
  data_quality?: 'good' | 'limited' | string;
  method?: string;
  hourly: HourlyHotspot[];
}

export interface HotspotsTotals {
  transfers_per_day: number;
  top_station: string;
  worst_wait_station: string;
}

export interface HotspotsData {
  window: string;
  stations: HotspotStation[];
  totals: HotspotsTotals;
}

export interface FlowRoute {
  route: string;
  transfers_per_day: number;
  share_pct: number;
  avg_wait_min: number;
  headway_min: number;
}

export interface HourlyFlow {
  hour: number;
  transfers: number;
  share_pct: number;
}

export interface StationFlow {
  station_id: string;
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  walk_m: number;
  direction: string;
  stop_type?: 'terminal' | string;
  transfers_per_day: number;
  share_pct: number;
  routes: FlowRoute[];
  hourly: HourlyFlow[];
}

export interface FlowsData {
  flows: StationFlow[];
}

export interface ExitPulse {
  t: string;
  v: number;
}

export interface BusArrival {
  t: string;
  stop_id: string;
  route: string;
  boardings: number;
  echo: number;
}

export interface PulseEchoData {
  date: string;
  exits_5min: ExitPulse[];
  bus_arrivals: BusArrival[];
}

export interface StationRouteDetail {
  route: string;
  stop_id: string;
  transfers_per_day: number;
  share_pct: number;
  avg_wait_min: number;
  headway_min_peak: number;
  boardings_per_trip_peak: number;
  capacity: number;
}

export interface StationRegular {
  window: string;
  regular_cards: number;
  top_route: string;
  likely_purpose: string;
  destination_hint: string;
}

export interface StationDetail {
  id: string;
  pulse_echo: PulseEchoData;
  routes: StationRouteDetail[];
  regulars: StationRegular[];
  method: string;
  validation: any;
}

export interface RecommendationEvidence {
  transfers: number;
  avg_wait_min: number;
  headway_min: number;
  boardings_per_trip: number;
  capacity: number;
  current_buses?: number;
  target_headway_min?: number;
}

export interface RecommendationBeforeAfter {
  wait_before: number;
  wait_after: number;
}

export interface RecommendationItem {
  id: string;
  station_id: string;
  stations?: string[];
  route: string;
  hours: string;
  type: 'add_buses' | 'retime' | 'bigger_bus' | 'new_feeder' | string;
  action: string;
  evidence: RecommendationEvidence;
  extra_buses: number;
  shift_min: number;
  current_buses?: number;
  target_headway_min?: number;
  before_after: RecommendationBeforeAfter;
  passenger_minutes_saved_per_day: number;
  rank: number;
}

export interface RecommendationsSummary {
  extra_buses_total: number;
  routes_affected: number;
  passenger_minutes_saved_per_day: number;
}

export interface RecommendationsData {
  summary: RecommendationsSummary;
  items: RecommendationItem[];
}

export interface RegularFlow {
  station_id: string;
  window: string;
  regular_cards: number;
  top_route: string;
  dest_name: string;
  dest_lat: number;
  dest_lon: number;
  likely_purpose: string;
}

export interface RegularsData {
  flows: RegularFlow[];
}

export interface NudgePoint {
  shift_min: number;
  avg_wait_min: number;
}

export interface NudgeCurve {
  station_id: string;
  route: string;
  hours: string;
  points: NudgePoint[];
  best_shift_min: number;
}

export interface NudgeData {
  curves: NudgeCurve[];
}

export interface FileQuality {
  total_rows?: number;
  flagged_rows?: number;
  rows_total?: number;
  rows_valid_in_window?: number;
  reasons?: Record<string, number>;
  [key: string]: any;
}

export interface QualityReport {
  generated_at?: string;
  files?: Record<string, FileQuality>;
  cmrl_entry?: FileQuality;
  cmrl_exit?: FileQuality;
  etm?: any;
  [key: string]: any;
}

export interface MethodValidation {
  alpha_control_avg: number;
  transfers_before_correction: number;
  transfers_after_correction: number;
}

export interface MethodData {
  steps: string[];
  validation: MethodValidation;
  assumptions: string[];
  limits: string[];
}

export interface RouteDropoff {
  name: string;
  lat: number;
  lon: number;
  pct: number;
}

export interface RouteDropoffsGroup {
  all_day: RouteDropoff[];
  am_peak: RouteDropoff[];
  pm_peak: RouteDropoff[];
  other_pct: number;
  other_pct_am_peak?: number;
  other_pct_pm_peak?: number;
}

export interface RouteEnd {
  name: string | null;
  lat: number | null;
  lon: number | null;
}

export interface RouteHourlyShare {
  hour: number;
  share_pct: number;
}

export type ShapeQuality = 'full' | 'partial' | null;
export type ShapeSource = 'exact' | 'base_route' | 'none';

export interface RouteFlowItem {
  route: string;
  dir?: string;
  board_stop: string;
  board_stop_raw?: string;
  board_lat: number;
  board_lon: number;
  share_pct: number;
  transfers_per_day: number;
  avg_wait_min: number;
  hourly: RouteHourlyShare[];
  route_end: RouteEnd;
  is_loop?: boolean;
  has_shape: boolean;
  shape_source?: ShapeSource;
  shape_quality?: ShapeQuality;
  end_verified?: boolean;
  full_path?: [number, number][] | null; // [lon, lat][] — the whole route, end to end
  board_index?: number | null; // index in full_path where the board stop snaps
  ahead_path?: [number, number][] | null; // board stop -> route end
  path?: [number, number][] | null; // legacy alias of ahead_path
  dropoffs: RouteDropoffsGroup;
}

export interface RouteOthers {
  share_pct: number;
  route_count: number;
  hourly?: RouteHourlyShare[];
}

export interface MostLikelyEntry {
  route: string;
  dir: string;
  board_stop: string;
  board_stop_raw?: string;
  board_lat: number;
  board_lon: number;
  share_pct_of_bus_takers: number;
  share_pct_of_exits: number | null;
  avg_wait_min: number | null;
  top_dropoff_name: string | null;
  top_dropoff_pct: number | null;
  fallback?: boolean; // hour has no data: this is the daily ranking
  runners_up?: MostLikelyEntry[];
}

export interface RouteFlowsData {
  station_id: string;
  data_quality?: string;
  total_bus_transfers_per_day: number;
  routes: RouteFlowItem[];
  others: RouteOthers;
  most_likely?: Record<string, MostLikelyEntry>;
  notes: string[];
}
