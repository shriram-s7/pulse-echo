import React, { useEffect, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import styles from './SidePanel.module.css';
import {
  Station,
  HotspotStation,
  StationFlow,
  StationDetail,
  RecommendationItem,
  RouteFlowsData
} from '../types';
import { Basis, getStopShares, getRouteShares, getDropoffShares } from '../lib/shares';
import { loadStationDetail } from '../services/api';
import { getShortStationName, cleanDestinationHint, toTitleCase } from '../utils/formatters';
import { PulseEchoChart } from './PulseEchoChart';
import {
  ROUTE_PALETTE,
  OTHERS_GREY,
  routeKey,
  routeLabel,
  endName,
  truncate,
  BAND_LABEL
} from '../routeView';
import { X, Footprints, Clock, Sparkles, AlertCircle, Info } from 'lucide-react';


interface SidePanelProps {
  station: Station | null;
  hotspot: HotspotStation | null;
  flows: StationFlow[];
  currentHour: number;
  recommendations: RecommendationItem[];
  routeFlows: RouteFlowsData | null;
  routeFlowsLoading: boolean;
  stationViewMode: 'stops' | 'routes';
  onStationViewModeChange: (mode: 'stops' | 'routes') => void;
  basis: Basis;
  onBasisChange: (b: Basis) => void;
  hoveredStopId: string | null;
  onHoverStop: (id: string | null) => void;
  selectedRouteName: string | null;
  onSelectRoute: (routeName: string | null) => void;
  onHoverRoute: (routeName: string | null) => void;
  onClose: () => void;
  onSelectRecommendation?: (rec: RecommendationItem) => void;
}

// Colors for the stacked bar in "Nearby stops"
const STOP_COLORS = [
  '#3B6FE0', // Blue
  '#E07A1F', // Orange
  '#10B981', // Emerald
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4'  // Cyan
];

const SidePanelInner: React.FC<SidePanelProps> = ({
  station,
  hotspot,
  flows,
  currentHour,
  recommendations,
  routeFlows,
  routeFlowsLoading,
  stationViewMode,
  onStationViewModeChange,
  basis,
  onBasisChange,
  hoveredStopId,
  onHoverStop,
  selectedRouteName,
  onSelectRoute,
  onHoverRoute,
  onClose,
  onSelectRecommendation
}) => {
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [loading, setLoading] = useState(false);

  // Close on Esc key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedRouteName) onSelectRoute(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onSelectRoute, selectedRouteName]);

  // Load detailed station pulse-echo data
  useEffect(() => {
    if (!station) {
      setDetail(null);
      return;
    }
    setLoading(true);
    loadStationDetail(station.id)
      .then(res => setDetail(res))
      .catch(err => {
        console.error('Failed to load station detail:', err);
        setDetail(null);
      })
      .finally(() => setLoading(false));
  }, [station?.id]);

  if (!station) return null;

  // Filter flows for this station
  const stationFlows = flows.filter(f => f.station_id === station.id);
  const busFlows = stationFlows.filter(f => f.stop_id !== 'other');

  // ALL percentages come from lib/shares (the very same numbers as the map)
  const stopShares = useMemo(() => getStopShares(station.id, basis, currentHour), [station.id, basis, currentHour, flows]);
  const visibleStops = stopShares.rows.map((s, idx) => ({ ...s, color: s.isOther ? '#9CA3AF' : STOP_COLORS[idx % STOP_COLORS.length] }));
  const routeShares = useMemo(() => getRouteShares(station.id, basis, currentHour), [station.id, basis, currentHour, routeFlows]);
  const basisWord = basis === 'daily' ? 'daily' : `at ${formatHour(currentHour)}`;

  // Short station name
  const shortName = getShortStationName(station.name, station.id);

  // Calculate total exit and transfer metrics
  const exitsPerDay = hotspot ? `~${Math.round(hotspot.exits_per_day).toLocaleString()}` : '~20,000';
  const isLimitedQuality = hotspot?.data_quality === 'limited';

  // Method string formatting
  const methodString = hotspot?.method
    ? formatMethodName(hotspot.method)
    : (detail?.method ? formatMethodName(detail.method) : 'quick estimate + placebo correction');

  // Recommendations specifically for this station
  const stationRecs = recommendations.filter(
    r => r.station_id === station.id || (r.stations && r.stations.includes(station.id))
  );

  // Top 3 next bus pairs for currentHour in "Nearby stops"
  const topNextBusPairs = useMemo(() => {
    const pairs: Array<{
      route: string;
      stopName: string;
      waitMin: number;
      score: number;
    }> = [];

    busFlows.forEach(stop => {
      const hObj = stop.hourly?.find(h => h.hour === currentHour);
      const hourlyTransfers = hObj ? (hObj.transfers ?? 0) : 0;
      const validRoutes = (stop.routes || []).filter(r => (r.share_pct ?? 0) >= 1.0);
      const sumRouteShare = validRoutes.reduce((acc, r) => acc + (r.share_pct || 1), 0) || 1;

      validRoutes.forEach(r => {
        const routeScore = hourlyTransfers > 0
          ? hourlyTransfers * ((r.share_pct || 1) / sumRouteShare)
          : (r.transfers_per_day || r.share_pct || 0);

        pairs.push({
          route: r.route,
          stopName: stop.stop_name,
          waitMin: r.avg_wait_min ?? 8,
          score: routeScore
        });
      });
    });

    pairs.sort((a, b) => b.score - a.score);
    return pairs.slice(0, 3);
  }, [busFlows, currentHour]);

  // Total daily bus transfers for this station
  const totalBusTransfers = routeFlows?.total_bus_transfers_per_day || (hotspot ? hotspot.transfers_per_day : 0);
  const routes = routeFlows?.routes ?? [];
  const topRoutes = routes.slice(0, 5);
  const othersCount = routeFlows?.others?.route_count ?? 0;

  // ECharts donut: top 5 routes + "Others (N routes)" in grey — the rounded values of getRouteShares
  const donutRows = useMemo(() => {
    if (!routeFlows || !routeShares.hasData) return [];
    const d: Array<{ name: string; value: number; label: string; itemStyle: { color: string } }> = routeShares.rows.map((r, i) => ({
      name: routeLabel(r.item, topRoutes), value: r.pct, label: r.label, itemStyle: { color: ROUTE_PALETTE[i % ROUTE_PALETTE.length] }
    }));
    if (routeShares.others.pct > 0 || routeShares.others.raw > 0) {
      d.push({ name: `Others (${othersCount} routes)`, value: routeShares.others.pct, label: routeShares.others.label, itemStyle: { color: OTHERS_GREY } });
    }
    return d;
  }, [routeFlows, routeShares, topRoutes, othersCount]);

  const donutOption = useMemo(() => {
    if (!donutRows.length) return null;
    return {
      animation: false,
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${p.data.label}` },
      legend: { show: false },
      series: [{
        name: 'Bus route share',
        type: 'pie',
        radius: ['58%', '82%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 4, borderColor: '#ffffff', borderWidth: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 5 },
        data: donutRows
      }],
      graphic: [{
        type: 'text', left: 'center', top: 'center',
        style: { text: `~${Math.round(totalBusTransfers).toLocaleString()}\ntake a bus / day`, textAlign: 'center', fill: '#0F172A', fontSize: 12, fontWeight: 700, lineHeight: 16 }
      }]
    };
  }, [donutRows, totalBusTransfers]);

  const spreadOverManyRoutes = routeShares.hasData && routeShares.others.pct > 60;

  // Selected route (by route + direction)
  const selectedRouteObj = useMemo(() => routes.find(r => routeKey(r) === selectedRouteName) || null, [routes, selectedRouteName]);
  const selectedRouteIdx = routes.findIndex(r => routeKey(r) === selectedRouteName);
  const selectedRouteColor = selectedRouteIdx >= 0 ? ROUTE_PALETTE[selectedRouteIdx % ROUTE_PALETTE.length] : ROUTE_PALETTE[0];
  const selectedDrops = useMemo(() => (selectedRouteObj ? getDropoffShares(selectedRouteObj, basis, currentHour) : null), [selectedRouteObj, basis, currentHour]);

  // "At HH:00 most people take…" — always the hour ranking; same rounded numbers as the donut when on "Selected hour"
  const colorOfEntry = (key: string) => {
    const i = topRoutes.findIndex(r => routeKey(r) === key);
    return i >= 0 ? ROUTE_PALETTE[i % ROUTE_PALETTE.length] : '#64748B';
  };

  const mostLikelyCard = routeFlows ? (
    <div className={styles.mostLikelyCard} data-card="most-likely">
      <div className={styles.mostLikelyHeader}>
        <Sparkles size={14} className={styles.sparkleIcon} />
        <span className={styles.mostLikelyTitle}>At {formatHour(currentHour)} most people take…</span>
      </div>
      {routeShares.card.length === 0 ? (
        <div className={styles.noHourData}>No bus transfers this hour</div>
      ) : (
        <div className={styles.mostLikelyList}>
          {routeShares.card.map((c, idx) => {
            return (
              <div key={`${c.key}-${idx}`} className={styles.mlRow} data-row-kind="card" data-row-key={c.key}>
                <div className={styles.mlRowTop}>
                  <span className={styles.rankPill}>#{idx + 1}</span>
                  <span className={styles.routePillTag} style={{ borderColor: colorOfEntry(c.key), color: colorOfEntry(c.key) }}>{c.route}</span>
                  <span className={styles.routeStopName} title={c.boardStop}>from {toTitleCase(c.boardStop)}</span>
                  <span className={styles.mlShare} data-pct-text="">{c.label}</span>
                  <span className={styles.routeWaitTag}>
                    <Clock size={11} />
                    {c.waitMin != null ? `~${Math.round(c.waitMin)} min` : '–'}
                  </span>
                </div>
              </div>
            );
          })}
          <div className={styles.caption}>% of bus-takers at {formatHour(currentHour)}</div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <aside className={styles.panel} aria-label="Station details panel" data-label-obstacle>
      {/* Top Header with Short Name & Tooltip for Full Name */}
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.stationTitleWrap}>
            <h2 className={styles.stationName} title={station.name}>
              {shortName}
            </h2>
            <div className={styles.chipsRow}>
              <span className={`${styles.lineChip} ${getLineClass(styles, station.line)}`}>
                {station.line} Line
              </span>
              <span className={styles.metricChip}>
                {exitsPerDay} exits/day
              </span>
              <span className={styles.metricChipAccent}>
                ~{stopShares.busTotal}% reach a nearby stop ({basisWord})
              </span>
            </div>
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            title="Close panel (Esc)"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Limited bus-stop data note */}
        {isLimitedQuality && (
          <div className={styles.limitedQualityBanner}>
            <AlertCircle size={14} className={styles.limitedIcon} />
            <span>Limited bus-stop data</span>
          </div>
        )}

        {/* 1. STATION VIEW — Segmented control: "Nearby stops" | "Bus routes" (default "Bus routes") */}
        <div className={styles.viewModeSegmented} role="tablist" aria-label="Station view mode">
          <button
            type="button"
            className={`${styles.viewModeBtn} ${stationViewMode === 'routes' ? styles.viewModeBtnActive : ''}`}
            onClick={() => onStationViewModeChange('routes')}
            role="tab"
            aria-selected={stationViewMode === 'routes'}
          >
            Bus routes
          </button>
          <button
            type="button"
            className={`${styles.viewModeBtn} ${stationViewMode === 'stops' ? styles.viewModeBtnActive : ''}`}
            onClick={() => onStationViewModeChange('stops')}
            role="tab"
            aria-selected={stationViewMode === 'stops'}
          >
            Nearby stops
          </button>
        </div>

        {/* ONE global toggle: controls the map labels AND every number in this panel */}
        <div className={styles.globalBasisRow}>
          <div className={styles.basisToggle} role="group" aria-label="Share basis (map and panel)" data-basis={basis}>
            <button type="button" data-basis-btn="daily" className={`${styles.basisBtn} ${basis === 'daily' ? styles.basisBtnActive : ''}`} onClick={() => onBasisChange('daily')}>Daily</button>
            <button type="button" data-basis-btn="hour" className={`${styles.basisBtn} ${basis === 'hour' ? styles.basisBtnActive : ''}`} onClick={() => onBasisChange('hour')}>Selected hour</button>
          </div>
          <span className={styles.caption} style={{ margin: 0 }}>{basis === 'daily' ? 'Whole-day averages' : `Follows the time bar · ${formatHour(currentHour)}`}</span>
        </div>
      </div>

      <div className={styles.scrollBody}>
        {/* BUS ROUTES TAB */}
        {stationViewMode === 'routes' && (
          <div className={styles.busRoutesContainer}>
            {routeFlowsLoading && (
              <div className={styles.loadingState}>Loading bus routes network...</div>
            )}

            {!routeFlowsLoading && !routeFlows && (
              <div className={styles.routeUnavailableBanner}>
                <AlertCircle size={15} />
                <span>Route details are not available for this station</span>
              </div>
            )}

            {routeFlows && routes.length === 0 && (
              <div className={styles.routeUnavailableBanner}>
                <Info size={15} />
                <span>{isLimitedQuality ? 'Limited bus-stop data — no route breakdown for this station' : 'No bus transfers detected at this station'}</span>
              </div>
            )}

            {routeFlows && routes.length > 0 && (
              <>
                {mostLikelyCard}

                {/* Donut Chart: ECharts */}
                <div className={styles.donutSection}>
                  <div className={styles.donutHeader}>
                    <span className={styles.donutTitle}>Bus transfer share by route</span>
                  </div>
                  <div className={styles.caption}>% of bus-takers on this route · {basis === 'daily' ? 'daily' : `at ${formatHour(currentHour)}`} · top 5 + Others = 100%</div>

                  {donutOption ? (
                    <>
                      <div className={styles.donutWrap} data-donut={JSON.stringify(donutRows.map(d => ({ name: d.name, pct: d.value, label: d.label })))}>
                        <ReactECharts option={donutOption} style={{ width: '100%', height: '100%' }} opts={{ renderer: 'canvas' }} />
                      </div>
                      {spreadOverManyRoutes && (
                        <div className={styles.donutNote}>Transfers spread over many routes</div>
                      )}
                    </>
                  ) : (
                    <div className={styles.noHourData}>No bus transfers this hour</div>
                  )}
                </div>

                {/* Route Rows List */}
                <div className={styles.routeRowsList}>
                  {routeShares.rows.map((rs, i) => {
                    const r = rs.item;
                    const color = ROUTE_PALETTE[i % ROUTE_PALETTE.length];
                    const key = routeKey(r);
                    const isSelected = selectedRouteName === key;
                    const label = routeLabel(r, topRoutes);

                    return (
                      <div
                        key={key}
                        data-route-row={key}
                        data-row-kind="route"
                        data-row-key={key}
                        className={`${styles.routeRowCard} ${isSelected ? styles.routeRowCardSelected : ''}`}
                        style={isSelected ? { borderColor: color, boxShadow: `0 0 0 1px ${color}` } : undefined}
                        onClick={() => onSelectRoute(isSelected ? null : key)}
                        onMouseEnter={() => onHoverRoute(key)}
                        onMouseLeave={() => onHoverRoute(null)}
                      >
                        <div className={styles.routeRowMain}>
                          <div className={styles.routeRowLeft}>
                            <span className={styles.routeDot} style={{ backgroundColor: color }} />
                            <span className={styles.routeRowChip} title={label}>{r.route}</span>
                            <span className={styles.routeBoardStop} title={r.board_stop}>
                              from {toTitleCase(r.board_stop)}
                            </span>
                          </div>
                          <div className={styles.routeRowRight}>
                            <span className={styles.routeSharePct} data-pct-text="">{routeShares.hasData ? rs.label : '0%'}</span>
                            <span className={styles.routeWaitMin}>
                              <Clock size={11} />
                              ~{Math.round(r.avg_wait_min)}m
                            </span>
                          </div>
                        </div>
                        <div className={styles.routeRowSub}>
                          <span className={styles.routeRowEndDest} title={r.is_loop ? 'Circular route' : (r.route_end?.name ?? '')}>
                            → {truncate(endName(r), 34)}
                          </span>
                          {!r.has_shape && (
                            <span className={styles.noShapeTag} title="No usable geographic shape for this route in the MTC route file">
                              list only · no map shape
                            </span>
                          )}
                          {r.has_shape && r.shape_quality === 'partial' && (
                            <span className={styles.partialTag} title="The drawn line may stop short of the route end">
                              route shape partial
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {othersCount > 0 && (
                    <div className={styles.othersRow} data-row-kind="route-other" data-row-key="others">
                      <span className={styles.routeDot} style={{ backgroundColor: OTHERS_GREY }} />
                      <span className={styles.othersLabel}>Others ({othersCount} routes)</span>
                      <span className={styles.routeSharePct} data-pct-text="">{routeShares.hasData ? routeShares.others.label : '0%'}</span>
                    </div>
                  )}
                </div>

                {/* Selected Route Drop-offs Breakdown */}
                {selectedRouteObj && selectedDrops && (
                  <div className={styles.dropoffsCard}>
                    <div className={styles.dropoffsTitle}>
                      <span>Top drop-offs for {routeLabel(selectedRouteObj, topRoutes)}</span>
                      <span className={styles.dropoffsPeakBadge}>{BAND_LABEL[selectedDrops.band]}</span>
                    </div>
                    <div className={styles.caption}>% of this route&apos;s riders who get off here</div>

                    {selectedDrops.rows.length === 0 ? (
                      <div className={styles.noHourData}>No drop-off stops recorded for this time window.</div>
                    ) : (
                      selectedDrops.rows.map((drop, dIdx) => (
                        <div key={dIdx} className={styles.dropoffItem} data-row-kind="dropoff" data-row-key={drop.name} data-lat={drop.lat} data-lon={drop.lon}>
                          <div className={styles.dropoffHeader}>
                            <span className={styles.dropoffName} title={drop.name}>
                              {toTitleCase(drop.name)}
                            </span>
                            <span className={styles.dropoffPct} data-pct-text="">{drop.label}</span>
                          </div>
                          <div className={styles.dropoffBarTrack}>
                            <div
                              className={styles.dropoffBarFill}
                              style={{ width: `${Math.min(100, drop.pct)}%`, backgroundColor: selectedRouteColor }}
                            />
                          </div>
                        </div>
                      ))
                    )}

                    {selectedDrops.other.raw > 0 && (
                      <div className={styles.otherDropoff} data-row-kind="dropoff-other" data-row-key="other">
                        other stops <span data-pct-text="">{selectedDrops.other.label}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer Note from notes[] */}
                <div className={styles.notesBox}>
                  {routeFlows.notes?.[0] || 'Drop-offs from paid tickets; free tickets assumed similar.'}
                </div>
              </>
            )}
          </div>
        )}

        {/* NEARBY STOPS TAB (Keep today's view unchanged) */}
        {(stationViewMode === 'stops' || (!routeFlows && !routeFlowsLoading)) && (
          <>
            {/* Most likely: same numbers as the Bus routes view (old stop-based card only when there is no route file) */}
            {mostLikelyCard}
            {!mostLikelyCard && topNextBusPairs.length > 0 && (
              <div className={styles.mostLikelyCard}>
                <div className={styles.mostLikelyHeader}>
                  <Sparkles size={14} className={styles.sparkleIcon} />
                  <span className={styles.mostLikelyTitle}>At {formatHour(currentHour)} most people take…</span>
                </div>
                <div className={styles.mostLikelyList}>
                  {topNextBusPairs.map((item, idx) => (
                    <div key={`${item.route}-${item.stopName}-${idx}`} className={styles.mostLikelyItem}>
                      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, overflow: 'hidden' }}>
                        <span className={styles.rankPill}>#{idx + 1}</span>
                        <span className={styles.routePillTag}>{item.route}</span>
                        <span className={styles.routeStopName} title={item.stopName}>
                          {toTitleCase(truncateText(item.stopName, 20))}
                        </span>
                      </div>
                      <span className={styles.routeWaitTag}>
                        <Clock size={11} />
                        ~{Math.round(item.waitMin)} min
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section 1: Where people go */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Where people go</h3>
              </div>
              <div className={styles.caption}>% of Metro exits who walk to this stop · {basis === 'daily' ? 'daily' : `at ${formatHour(currentHour)}`} · includes walk / auto / not a nearby bus = 100%</div>

              {busFlows.length === 0 ? (
                <div className={styles.noFlowsBanner}>
                  <Info size={16} className={styles.noFlowsIcon} />
                  <div className={styles.noFlowsText}>
                    <strong>No nearby bus flows detected</strong>
                    <p>No active MTC bus stops within 400 m catchment or transfer volume was under threshold.</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* 100% Horizontal Stacked Bar */}
                  <div className={styles.stackedBarContainer}>
                    <div className={styles.stackedBar}>
                      {visibleStops.map(stop => {
                        if (stop.raw <= 0) return null;
                        return (
                          <div
                            key={stop.id}
                            className={styles.stackedSegment}
                            style={{
                              width: `${stop.pct > 0 ? stop.pct : stop.raw}%`,
                              backgroundColor: stop.color
                            }}
                            title={`${stop.isOther ? 'Walk / auto / not a nearby bus' : stop.name}: ${stop.label}`}
                          />
                        );
                      })}
                    </div>
                    {/* Neatly wrapping legend chips */}
                    <div className={styles.stackedLegend}>
                      {visibleStops.map(stop => (
                        <div key={stop.id} className={styles.legendItem}>
                          <span
                            className={styles.legendDot}
                            style={{ backgroundColor: stop.color }}
                          />
                          <span className={styles.legendLabel} title={stop.name}>
                            {stop.isOther ? 'Walk / other' : truncateText(toTitleCase(stop.name), 16)} ({stop.label})
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* List of stops: the same rows the map labels */}
                  <div className={styles.stopList}>
                    {visibleStops.map(stop => {
                      const isOther = stop.isOther;
                      const isTerminal = stop.stopType === 'terminal';

                      // Show at most the top 3 routes (names + wait only), then "+N more"
                      const validRoutes = (stop.routes || []).filter(r => (r.share_pct ?? 0) >= 1.0);
                      const top3Routes = validRoutes.slice(0, 3);
                      const moreRoutesCount = validRoutes.length - 3;

                      return (
                        <div
                          key={stop.id}
                          data-row-kind="stop"
                          data-row-key={stop.id}
                          className={`${styles.stopCard} ${isOther ? styles.otherCard : ''} ${hoveredStopId === stop.id ? styles.stopCardHover : ''}`}
                          onMouseEnter={isOther ? undefined : () => onHoverStop(stop.id)}
                          onMouseLeave={isOther ? undefined : () => onHoverStop(null)}
                        >
                          <div className={styles.stopCardHeader}>
                            <div className={styles.stopInfo}>
                              <span
                                className={styles.stopIndicator}
                                style={{ backgroundColor: stop.color }}
                              />
                              <span className={styles.stopName} title={stop.name}>
                                {isOther ? 'Walk / auto / not a nearby bus' : toTitleCase(stop.name)}
                              </span>
                              {isTerminal && (
                                <span className={styles.terminalBadge} title="Bus Terminal / Major Interchange">
                                  Terminal
                                </span>
                              )}
                            </div>
                            <div className={styles.stopMeta}>
                              {!isOther && (
                                <span className={styles.walkMeta}>
                                  <Footprints size={12} />
                                  {stop.walkM} m
                                </span>
                              )}
                              <span className={styles.stopShare} data-pct-text="">
                                {stop.label}
                              </span>
                            </div>
                          </div>

                          {/* Route chips: top 3 + "+N more" */}
                          {!isOther && validRoutes.length > 0 && (
                            <div className={styles.routeChipsList}>
                              {top3Routes.map(r => (
                                <div key={r.route} className={styles.routeChip}>
                                  <span className={styles.routeNumber}>{r.route}</span>
                                  <span className={styles.routeWait}>
                                    <Clock size={10} />
                                    {r.avg_wait_min}m
                                  </span>
                                </div>
                              ))}
                              {moreRoutesCount > 0 && (
                                <span
                                  className={styles.moreRoutesBadge}
                                  title={validRoutes.slice(3).map(r => r.route).join(', ')}
                                >
                                  +{moreRoutesCount} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {/* Section 2: Pulse-Echo Chart */}
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Pulse–Echo Burst Analysis</h3>
                <span className={styles.sectionSubtitle}>Train exit pulses vs Bus echo</span>
              </div>

              <div className={styles.chartContainer}>
                {loading ? (
                  <div className={styles.loadingState}>Loading pulse dynamics...</div>
                ) : detail?.pulse_echo ? (
                  <PulseEchoChart data={detail.pulse_echo} />
                ) : (
                  <div className={styles.noDataState}>No pulse data available</div>
                )}
              </div>
            </section>

            {/* Section 3: Regular Commuters */}
            {detail?.regulars && detail.regulars.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3 className={styles.sectionTitle}>Regular Commuters</h3>
                  <span className={styles.sectionSubtitle}>Same anonymous card pattern</span>
                </div>
                {detail.regulars.map((reg, idx) => {
                  const cleanDest = cleanDestinationHint(reg.destination_hint);
                  return (
                    <div key={idx} className={styles.regularsCard}>
                      <div className={styles.regularsIcon}>
                        <Sparkles size={16} />
                      </div>
                      <div className={styles.regularsContent}>
                        <p className={styles.regularsText}>
                          <b>~{reg.regular_cards}</b> regular riders exit{' '}
                          <span className={styles.timeTag}>{reg.window}</span> every weekday → route{' '}
                          <b>{reg.top_route}</b> → likely{' '}
                          <span className={styles.destHint}>{cleanDest}</span>.
                        </p>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {/* Section 4: Recommendations for this station */}
            {stationRecs.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3 className={styles.sectionTitle}>Station Recommendations</h3>
                  <span className={styles.badgeCount}>{stationRecs.length} action items</span>
                </div>
                <div className={styles.recsList}>
                  {stationRecs.map(rec => (
                    <div
                      key={rec.id}
                      className={styles.recItem}
                      onClick={() => onSelectRecommendation?.(rec)}
                    >
                      <div className={styles.recItemHeader}>
                        <span className={`${styles.typeChip} ${getTypeClass(styles, rec.type)}`}>
                          {formatType(rec.type)}
                        </span>
                        <span className={styles.recHours}>{rec.hours}</span>
                      </div>
                      <div className={styles.recAction}>{rec.action}</div>
                      <div className={styles.recFooter}>
                        <span className={styles.recWaitImprovement}>
                          Wait: {rec.before_after.wait_before}m → <b>{rec.before_after.wait_after}m</b>
                        </span>
                        <span className={styles.recMinutesSaved}>
                          ~{rec.passenger_minutes_saved_per_day.toLocaleString()} min saved
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Panel Footer: Method Tag */}
      <div className={styles.panelFooter}>
        <span className={styles.methodText}>
          Method: {methodString}
        </span>
      </div>
    </aside>
  );
};

function getLineClass(styles: any, line: string): string {
  if (line === 'Blue') return styles.lineBlue;
  if (line === 'Green') return styles.lineGreen;
  return styles.lineBoth;
}

function getTypeClass(styles: any, type: string): string {
  switch (type) {
    case 'add_buses': return styles.typeAddBuses;
    case 'retime': return styles.typeRetime;
    case 'bigger_bus': return styles.typeBiggerBus;
    case 'new_feeder': return styles.typeNewFeeder;
    default: return styles.typeGeneric;
  }
}

function formatType(type: string): string {
  switch (type) {
    case 'add_buses': return 'Add buses';
    case 'retime': return 'Shift timing';
    case 'bigger_bus': return 'Bigger bus';
    case 'new_feeder': return 'New feeder';
    default: return type;
  }
}

function formatMethodName(method: string): string {
  if (method === 'quick_estimate_placebo') {
    return 'quick estimate + placebo correction';
  }
  if (method === 'quick_estimate') {
    return 'quick estimate';
  }
  if (method === 'pulse_echo_glm') {
    return 'pulse-echo Poisson GLM';
  }
  return method.replace(/_/g, ' ');
}

function formatHour(hour: number): string {
  const h = hour.toString().padStart(2, '0');
  return `${h}:00`;
}

function truncateText(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

// Wrapper: mount the inner panel only when a station is selected, so hooks inside never run conditionally.
export const SidePanel: React.FC<SidePanelProps> = (props) => (props.station ? <SidePanelInner {...props} /> : null);
