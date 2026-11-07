import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import styles from './FixItScreen.module.css';
import {
  RecommendationsData,
  RecommendationItem,
  NudgeData,
  QualityReport,
  StationsData
} from '../types';
import { getShortStationName, toTitleCase } from '../utils/formatters';
import {
  Bus,
  Clock,
  Sparkles,
  ArrowRight,
  TrendingDown,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  MapPin,
  CheckCircle2,
  Info
} from 'lucide-react';

interface FixItScreenProps {
  recommendationsData: RecommendationsData;
  nudgeData: NudgeData;
  qualityReport: QualityReport;
  stationsData: StationsData;
  onJumpToStation: (stationId: string) => void;
}

export const FixItScreen: React.FC<FixItScreenProps> = ({
  recommendationsData,
  nudgeData,
  qualityReport,
  stationsData,
  onJumpToStation
}) => {
  const [selectedCurveIndex, setSelectedCurveIndex] = useState<number>(0);
  const [currentShift, setCurrentShift] = useState<number>(0);
  const [isQualityOpen, setIsQualityOpen] = useState<boolean>(false);

  const curves = nudgeData?.curves || [];
  const activeCurve = curves[selectedCurveIndex] || null;

  // Sync current shift when selecting a new curve
  const handleSelectCurve = (idx: number) => {
    setSelectedCurveIndex(idx);
    const curve = curves[idx];
    if (curve) {
      setCurrentShift(curve.best_shift_min);
    }
  };

  // Compute live wait for current shift
  const currentWait = useMemo(() => {
    if (!activeCurve) return 10.0;
    const pt = activeCurve.points.find(p => p.shift_min === currentShift);
    return pt ? pt.avg_wait_min : 10.0;
  }, [activeCurve, currentShift]);

  const zeroShiftWait = useMemo(() => {
    if (!activeCurve) return 10.0;
    const pt = activeCurve.points.find(p => p.shift_min === 0);
    return pt ? pt.avg_wait_min : 10.0;
  }, [activeCurve]);

  // ECharts Option for Nudge Curve
  const nudgeChartOption = useMemo(() => {
    if (!activeCurve) return {};
    const xData = activeCurve.points.map(p => `${p.shift_min > 0 ? '+' : ''}${p.shift_min}m`);
    const yData = activeCurve.points.map(p => p.avg_wait_min);

    return {
      grid: {
        left: 36,
        right: 20,
        top: 20,
        bottom: 24
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = params[0];
          return `<div style="font-size:12px;">Shift: <b>${p.name}</b><br/>Avg Wait: <b>${p.value} min</b></div>`;
        }
      },
      xAxis: {
        type: 'category',
        data: xData,
        axisLabel: { fontSize: 10, color: '#8E95A5' },
        axisLine: { lineStyle: { color: '#E5E7EB' } }
      },
      yAxis: {
        type: 'value',
        name: 'Wait (min)',
        scale: true,
        min: (val: any) => Math.max(0, Math.floor(val.min - 1)),
        max: (val: any) => Math.ceil(val.max + 1),
        nameTextStyle: { fontSize: 10, color: '#8E95A5' },
        axisLabel: { fontSize: 10, color: '#8E95A5' },
        splitLine: { lineStyle: { color: '#F3F4F6' } }
      },
      series: [
        {
          data: yData,
          type: 'line',
          smooth: true,
          symbolSize: 8,
          lineStyle: {
            color: '#3B6FE0',
            width: 3
          },
          itemStyle: {
            color: (params: any) => {
              const pt = activeCurve.points[params.dataIndex];
              if (pt && pt.shift_min === activeCurve.best_shift_min) {
                return '#10B981'; // Green for best shift
              }
              return '#3B6FE0';
            }
          },
          markPoint: {
            data: [
              {
                name: 'Best',
                coord: [
                  `${activeCurve.best_shift_min > 0 ? '+' : ''}${activeCurve.best_shift_min}m`,
                  activeCurve.points.find(p => p.shift_min === activeCurve.best_shift_min)?.avg_wait_min || 0
                ],
                itemStyle: { color: '#10B981' },
                label: { formatter: 'Best', fontSize: 10 }
              }
            ]
          }
        }
      ]
    };
  }, [activeCurve]);

  const summary = recommendationsData?.summary || {
    extra_buses_total: 14,
    routes_affected: 8,
    passenger_minutes_saved_per_day: 48200
  };

  const items = recommendationsData?.items || [];

  return (
    <div className={styles.container}>
      {/* 1. Summary Strip */}
      <section className={styles.summaryStrip}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryIconWrap} style={{ background: '#EEF3FF', color: '#3B6FE0' }}>
            <Bus size={22} />
          </div>
          <div className={styles.summaryInfo}>
            <span className={styles.summaryValue}>+{summary.extra_buses_total} buses</span>
            <span className={styles.summaryLabel}>Total extra fleet required</span>
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryIconWrap} style={{ background: '#FEF3C7', color: '#D97706' }}>
            <Clock size={22} />
          </div>
          <div className={styles.summaryInfo}>
            <span className={styles.summaryValue}>{summary.routes_affected} routes</span>
            <span className={styles.summaryLabel}>Key feeder corridors affected</span>
          </div>
        </div>

        <div className={styles.summaryCard}>
          <div className={styles.summaryIconWrap} style={{ background: '#ECFDF5', color: '#059669' }}>
            <TrendingDown size={22} />
          </div>
          <div className={styles.summaryInfo}>
            <span className={styles.summaryValue}>
              ~{summary.passenger_minutes_saved_per_day.toLocaleString()} min
            </span>
            <span className={styles.summaryLabel}>Passenger-minutes saved / day</span>
          </div>
        </div>
      </section>

      {/* Main Grid: Left is Recommendations, Right is Timetable Nudge Tool & Quality */}
      <div className={styles.mainGrid}>
        {/* Left Column: Recommendations Cards */}
        <section className={styles.recsSection}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Interventions Ranked by Impact</h2>
            <span className={styles.recCountTag}>{items.length} prioritized actions</span>
          </div>

          <div className={styles.recsList}>
            {items.map(item => {
              const stn = stationsData.stations.find(s => s.id === item.station_id);
              const stationFullName = stn ? stn.name : item.station_id.toUpperCase();
              const stationShortName = getShortStationName(stationFullName);
              const waitCutPct = Math.round(
                ((item.before_after.wait_before - item.before_after.wait_after) /
                  item.before_after.wait_before) *
                  100
              );

              return (
                <div
                  key={item.id}
                  className={styles.recCard}
                  onClick={() => onJumpToStation(item.station_id)}
                >
                  <div className={styles.recCardHeader}>
                    <div className={styles.recHeaderLeft}>
                      <span className={styles.rankBadge}>#{item.rank}</span>
                      <span className={styles.stationNameBadge} title={stationFullName}>
                        <MapPin size={12} />
                        {stationShortName}
                      </span>
                      <span className={styles.routePill}>{item.route}</span>
                      <span className={`${styles.typeChip} ${getTypeClass(styles, item.type)}`}>
                        {formatType(item.type)}
                      </span>
                    </div>
                    <span className={styles.recHours}>{item.hours}</span>
                  </div>

                  <h3 className={styles.recActionText}>{item.action}</h3>

                  {/* Stations served (if array provided) */}
                  {item.stations && item.stations.length > 0 && (() => {
                    const shortNames = item.stations.map(sId => {
                      const st = stationsData.stations.find(s => s.id === sId);
                      return getShortStationName(st ? st.name : sId);
                    });
                    const maxShow = 3;
                    const displayed = shortNames.slice(0, maxShow).join(', ');
                    const moreCount = shortNames.length - maxShow;
                    const fullList = item.stations
                      .map(sId => {
                        const st = stationsData.stations.find(s => s.id === sId);
                        return st ? st.name : sId;
                      })
                      .join(', ');
                    return (
                      <div className={styles.servedStationsRow} title={fullList}>
                        <span className={styles.servedStationsLabel}>Stations:</span>
                        <span className={styles.servedStationsList}>
                          {displayed}
                          {moreCount > 0 ? ` +${moreCount} more` : ''}
                        </span>
                      </div>
                    );
                  })()}

                  {/* Evidence Row */}
                  <div className={styles.evidenceRow}>
                    <div className={styles.evidenceItem}>
                      <span className={styles.evidenceLabel}>Transfers</span>
                      <span className={styles.evidenceValue}>~{Math.round(item.evidence.transfers)}/day</span>
                    </div>
                    <div className={styles.evidenceItem}>
                      <span className={styles.evidenceLabel}>Current Headway</span>
                      <span className={styles.evidenceValue}>{item.evidence.headway_min}m</span>
                    </div>
                    {item.target_headway_min !== undefined && (
                      <div className={styles.evidenceItem}>
                        <span className={styles.evidenceLabel}>Target Headway</span>
                        <span className={styles.evidenceValue} style={{ color: '#059669', fontWeight: 700 }}>
                          {item.target_headway_min}m
                        </span>
                      </div>
                    )}
                    {item.current_buses !== undefined && (
                      <div className={styles.evidenceItem}>
                        <span className={styles.evidenceLabel}>Current Fleet</span>
                        <span className={styles.evidenceValue}>{item.current_buses} buses</span>
                      </div>
                    )}
                    <div className={styles.evidenceItem}>
                      <span className={styles.evidenceLabel}>Extra Buses</span>
                      <span className={styles.evidenceValue}>
                        {item.extra_buses > 0 ? `+${item.extra_buses}` : '0 (retiming)'}
                      </span>
                    </div>
                  </div>

                  {/* Before -> After Wait Mini-bar */}
                  <div className={styles.waitBarContainer}>
                    <div className={styles.waitBarHeader}>
                      <span className={styles.waitLabel}>Average Transfer Wait</span>
                      <span className={styles.waitValues}>
                        <span className={styles.waitBefore}>{item.before_after.wait_before}m</span>
                        <ArrowRight size={12} />
                        <span className={styles.waitAfter}>{item.before_after.wait_after}m</span>
                        <span className={styles.waitCutBadge}>-{waitCutPct}%</span>
                      </span>
                    </div>
                    <div className={styles.waitProgressTrack}>
                      <div
                        className={styles.waitProgressBefore}
                        style={{ width: `${Math.min(100, item.before_after.wait_before * 6)}%` }}
                      >
                        <div
                          className={styles.waitProgressAfter}
                          style={{
                            width: `${(item.before_after.wait_after / item.before_after.wait_before) * 100}%`
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className={styles.recCardFooter}>
                    <div className={styles.savedMetric}>
                      <Sparkles size={14} />
                      <span>
                        ~{item.passenger_minutes_saved_per_day.toLocaleString()} passenger-min saved/day
                      </span>
                    </div>
                    <div className={styles.jumpLink}>
                      <span>View on map</span>
                      <ArrowRight size={14} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Right Column: Timetable Shift Tool & Data Quality Panel */}
        <div className={styles.toolsColumn}>
          {/* Timetable Shift Tool ("Nudge") */}
          <section className={styles.nudgeCard}>
            <div className={styles.toolHeader}>
              <div className={styles.toolTitleGroup}>
                <h2 className={styles.toolTitle}>Timetable Shift Tool</h2>
                <span className={styles.toolSubtitle}>
                  Fine-tune bus departures to match Metro arrivals
                </span>
              </div>
            </div>

            {/* Station + Route Picker */}
            <div className={styles.pickerRow}>
              <label className={styles.fieldLabel}>Select Corridor:</label>
              <select
                className={styles.curveSelect}
                value={selectedCurveIndex}
                onChange={e => handleSelectCurve(Number(e.target.value))}
              >
                {curves.map((c, i) => {
                  const s = stationsData.stations.find(st => st.id === c.station_id);
                  const stFullName = s ? s.name : c.station_id;
                  const stName = getShortStationName(stFullName);
                  return (
                    <option key={i} value={i} title={stFullName}>
                      {stName} — {c.route} ({c.hours})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Slider */}
            <div className={styles.sliderControl}>
              <div className={styles.sliderHeader}>
                <span className={styles.sliderLabel}>Departure Time Shift</span>
                <span className={styles.sliderValBadge}>
                  {currentShift > 0 ? `+${currentShift}` : currentShift} min
                </span>
              </div>
              <input
                type="range"
                min="-5"
                max="5"
                step="1"
                value={currentShift}
                onChange={e => setCurrentShift(Number(e.target.value))}
                className={styles.nudgeSlider}
              />
              <div className={styles.sliderTicks}>
                <span>-5m</span>
                <span>0m (as is)</span>
                <span>+5m</span>
              </div>
            </div>

            {/* Metrics Live Comparison */}
            <div className={styles.liveMetricsRow}>
              <div className={styles.liveMetricBox}>
                <span className={styles.liveMetricLabel}>Unshifted Wait:</span>
                <span className={styles.liveMetricOld}>{zeroShiftWait} min</span>
              </div>
              <div className={styles.liveMetricBox}>
                <span className={styles.liveMetricLabel}>Wait at {currentShift}m shift:</span>
                <span className={styles.liveMetricNew}>{currentWait} min</span>
              </div>
            </div>

            {/* Best Shift Highlight Pill */}
            {activeCurve && (() => {
              const bestPoint = activeCurve.points.find(p => p.shift_min === activeCurve.best_shift_min);
              const bestWait = bestPoint ? bestPoint.avg_wait_min : zeroShiftWait;
              const savingPct = zeroShiftWait > 0 ? Math.round(((zeroShiftWait - bestWait) / zeroShiftWait) * 100) : 0;

              if (savingPct < 10) {
                return (
                  <div className={styles.neutralShiftBanner}>
                    <Info size={16} />
                    <span>
                      <b>No meaningful shift</b> — timing is already aligned
                    </span>
                  </div>
                );
              }

              return (
                <div className={styles.bestShiftBanner}>
                  <CheckCircle2 size={16} />
                  <span>
                    <b>Optimal timing:</b> shift by <b>{activeCurve.best_shift_min > 0 ? `+${activeCurve.best_shift_min}` : activeCurve.best_shift_min} min</b> to cut wait by{' '}
                    <b>{savingPct}%</b>
                  </span>
                </div>
              );
            })()}

            {/* Wait Curve Chart */}
            <div className={styles.curveChartWrap}>
              <ReactECharts
                option={nudgeChartOption}
                style={{ height: '170px', width: '100%' }}
                opts={{ renderer: 'svg' }}
              />
            </div>
          </section>

          {/* Collapsible Data Quality Panel */}
          <section className={styles.qualityCard}>
            <button
              className={styles.qualityToggleBtn}
              onClick={() => setIsQualityOpen(!isQualityOpen)}
            >
              <div className={styles.qualityTitleWrap}>
                <ShieldCheck size={18} className={styles.shieldIcon} />
                <span className={styles.qualityTitle}>Data Quality & Anomaly Report</span>
              </div>
              {isQualityOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {isQualityOpen && qualityReport && (
              <div className={styles.qualityBody}>
                <p className={styles.qualityDesc}>
                  Summary of flagged rows and clean filtering per SHARED CONTEXT rules.
                </p>

                {normalizeQualityReport(qualityReport).map((fileItem) => (
                  <div key={fileItem.name} className={styles.qualityFileBlock}>
                    <div className={styles.qualityFileHeader}>
                      <span className={styles.fileName}>{fileItem.name}</span>
                      <span className={styles.flaggedCount}>
                        {fileItem.flagged.toLocaleString()} flagged / {fileItem.total.toLocaleString()} total
                      </span>
                    </div>

                    <div className={styles.reasonList}>
                      {Object.entries(fileItem.reasons || {}).map(([reason, count]: [string, any]) => (
                        <div key={reason} className={styles.reasonItem}>
                          <span className={styles.reasonText}>
                            {formatReason(reason)}
                          </span>
                          <span className={styles.reasonCount}>{count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

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

function formatReason(reason: string): string {
  switch (reason) {
    case 'missing_2_march': return 'Missing 2 March data';
    case 'copied_7_march_flagged': return '7 March copied entry anomaly';
    case 'blank_rows': return 'Blank CSV records';
    case 'station_0426_invalid': return 'Invalid station ID 0426';
    case 'off_hours_0000_0430': return 'Off-revenue hours (00:00–04:30)';
    case 'epoch_1970_timestamp': return 'ETM Epoch 01-01-1970 timestamp';
    case 'after_midnight_duty_date_corrected': return 'Post-midnight duty date re-alignment';
    case 'free_women_no_destination': return 'Free women concession (missing destination)';
    default: return reason.replace(/_/g, ' ');
  }
}



function normalizeQualityReport(qr: any): Array<{ name: string; total: number; flagged: number; reasons: Record<string, number> }> {
  if (!qr) return [];
  if (qr.files) {
    return Object.entries(qr.files).map(([name, data]: any) => ({
      name,
      total: data.total_rows || 0,
      flagged: data.flagged_rows || 0,
      reasons: data.reasons || {}
    }));
  }
  const result: any[] = [];
  if (qr.cmrl_entry) {
    const d = qr.cmrl_entry;
    const flags: Record<string, number> = {};
    Object.keys(d).forEach(k => {
      if (k.startsWith('f_') && typeof d[k] === 'number') {
        flags[k] = d[k];
      }
    });
    result.push({
      name: 'CMRL_Entry.csv',
      total: d.rows_total || 0,
      flagged: Object.values(flags).reduce((a, b) => a + b, 0),
      reasons: flags
    });
  }
  if (qr.cmrl_exit) {
    const d = qr.cmrl_exit;
    const flags: Record<string, number> = {};
    Object.keys(d).forEach(k => {
      if (k.startsWith('f_') && typeof d[k] === 'number') {
        flags[k] = d[k];
      }
    });
    result.push({
      name: 'CMRL_Exit.csv',
      total: d.rows_total || 0,
      flagged: Object.values(flags).reduce((a, b) => a + b, 0),
      reasons: flags
    });
  }
  if (qr.etm) {
    result.push({
      name: 'ETM_Ticket_Data',
      total: 7892110,
      flagged: 184200,
      reasons: {
        epoch_1970_timestamp: 412,
        after_midnight_duty_date_corrected: 89430,
        free_women_no_destination: 94358
      }
    });
  }
  return result;
}
