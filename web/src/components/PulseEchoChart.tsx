import React from 'react';
import ReactECharts from 'echarts-for-react';
import { PulseEchoData } from '../types';

interface PulseEchoChartProps {
  data: PulseEchoData;
}

export const PulseEchoChart: React.FC<PulseEchoChartProps> = ({ data }) => {
  if (!data || !data.exits_5min) {
    return <div style={{ padding: 16, color: '#9CA3AF', fontSize: 13 }}>No pulse-echo records for this station.</div>;
  }

  // Create unified time buckets from exits_5min
  const times = data.exits_5min.map(d => d.t);
  const exitValues = data.exits_5min.map(d => d.v);

  // Map bus arrivals to nearest or matching 5-min bucket
  const baselineBoardings = new Array(times.length).fill(0);
  const echoTransfers = new Array(times.length).fill(0);

  data.bus_arrivals.forEach(arrival => {
    // Find closest or matching time
    const arrMin = parseTimeToMin(arrival.t);
    let bestIdx = 0;
    let minDiff = 999999;
    times.forEach((t, i) => {
      const diff = Math.abs(parseTimeToMin(t) - arrMin);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    });

    const baseline = Math.max(0, arrival.boardings - arrival.echo);
    baselineBoardings[bestIdx] = baseline;
    echoTransfers[bestIdx] = arrival.echo;
  });

  const option = {
    grid: {
      left: 36,
      right: 16,
      top: 24,
      bottom: 24
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        let tooltipText = `<div style="font-weight:600;font-size:12px;margin-bottom:4px;">Time: ${params[0]?.axisValue}</div>`;
        params.forEach((p: any) => {
          if (p.value > 0) {
            tooltipText += `<div style="display:flex;align-items:center;gap:6px;font-size:11px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color};"></span>
              <span>${p.seriesName}: <b>${p.value}</b></span>
            </div>`;
          }
        });
        return tooltipText;
      }
    },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: {
        fontSize: 10,
        color: '#8E95A5',
        interval: (_idx: number, value: string) => {
          return value.endsWith(':00') || value.endsWith(':30');
        },
        rotate: 0
      },
      axisLine: { lineStyle: { color: '#E5E7EB' } },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value',
        name: 'Metro exits',
        nameTextStyle: { fontSize: 10, color: '#3B6FE0' },
        axisLabel: { fontSize: 10, color: '#8E95A5' },
        splitLine: { lineStyle: { color: '#F3F4F6' } }
      },
      {
        type: 'value',
        name: 'Bus boardings',
        nameTextStyle: { fontSize: 10, color: '#E07A1F' },
        axisLabel: { fontSize: 10, color: '#8E95A5' },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: 'Metro exits (5m pulse)',
        type: 'bar',
        yAxisIndex: 0,
        data: exitValues,
        itemStyle: {
          color: '#3B6FE0',
          borderRadius: [2, 2, 0, 0]
        },
        barWidth: '45%'
      },
      {
        name: 'Local Bus Baseline',
        type: 'bar',
        stack: 'bus',
        yAxisIndex: 1,
        data: baselineBoardings,
        itemStyle: {
          color: '#FDBA74' // lighter orange
        },
        barWidth: '35%'
      },
      {
        name: 'Echo (Transfers)',
        type: 'bar',
        stack: 'bus',
        yAxisIndex: 1,
        data: echoTransfers,
        itemStyle: {
          color: '#C2410C', // darker orange / dark top
          borderRadius: [2, 2, 0, 0]
        },
        barWidth: '35%'
      }
    ]
  };

  return (
    <div>
      <ReactECharts
        option={option}
        style={{ height: '170px', width: '100%' }}
        opts={{ renderer: 'svg' }}
      />
      <div style={{
        textAlign: 'center',
        fontSize: '11px',
        color: '#6B7280',
        marginTop: '2px',
        fontStyle: 'italic'
      }}>
        Extra boardings right after each train = transfers.
      </div>
    </div>
  );
};

function parseTimeToMin(t: string): number {
  const parts = t.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

