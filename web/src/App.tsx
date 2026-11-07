import React, { useState, useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { MapScreen } from './components/MapScreen';
import { FixItScreen } from './components/FixItScreen';
import { HowItWorksScreen } from './components/HowItWorksScreen';
import {
  loadStations,
  loadHotspots,
  loadFlows,
  loadRegulars,
  loadRecommendations,
  loadNudge,
  loadQualityReport,
  loadMethod,
  loadSuburban,
  subscribeMockStatus
} from './services/api';
import {
  StationsData,
  HotspotsData,
  FlowsData,
  RegularsData,
  RecommendationsData,
  NudgeData,
  QualityReport,
  MethodData,
  RecommendationItem
} from './types';
import styles from './App.module.css';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<'map' | 'fixit' | 'method'>('map');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [isMock, setIsMock] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Contract data states
  const [stationsData, setStationsData] = useState<StationsData | null>(null);
  const [hotspotsData, setHotspotsData] = useState<HotspotsData | null>(null);
  const [flowsData, setFlowsData] = useState<FlowsData | null>(null);
  const [regularsData, setRegularsData] = useState<RegularsData | null>(null);
  const [recommendationsData, setRecommendationsData] = useState<RecommendationsData | null>(null);
  const [nudgeData, setNudgeData] = useState<NudgeData | null>(null);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [methodData, setMethodData] = useState<MethodData | null>(null);
  const [suburbanData, setSuburbanData] = useState<any | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeMockStatus(setIsMock);
    return () => unsubscribe();
  }, []);

  // Fetch all initial dataset
  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadStations(),
      loadHotspots(),
      loadFlows(),
      loadRegulars(),
      loadRecommendations(),
      loadNudge(),
      loadQualityReport(),
      loadMethod().catch(() => null),
      loadSuburban().catch(() => null)
    ])
      .then(([stns, hot, flws, regs, recs, ndg, qual, mthd, sub]) => {
        setStationsData(stns);
        setHotspotsData(hot);
        setFlowsData(flws);
        setRegularsData(regs);
        setRecommendationsData(recs);
        setNudgeData(ndg);
        setQualityReport(qual);
        setMethodData(mthd);
        setSuburbanData(sub);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load initial data:', err);
        setError('Failed to load Pulse–Echo datasets. Please check network/files.');
        setLoading(false);
      });
  }, []);

  const handleJumpToStation = (stationId: string) => {
    setSelectedStationId(stationId);
    setCurrentTab('map');
  };

  const handleSelectRecommendation = (rec: RecommendationItem) => {
    handleJumpToStation(rec.station_id);
  };

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.spinner}></div>
        <div className={styles.loadingTitle}>Loading Pulse–Echo datasets...</div>
        <div className={styles.loadingSubtitle}>Chennai Metro & MTC Bus transfer corridors</div>
      </div>
    );
  }

  if (error || !stationsData || !hotspotsData || !flowsData || !regularsData || !recommendationsData || !nudgeData || !qualityReport) {
    return (
      <div className={styles.errorScreen}>
        <div className={styles.errorTitle}>Error Loading Dashboard</div>
        <p className={styles.errorText}>{error || 'Could not load required contract datasets.'}</p>
        <button className={styles.retryBtn} onClick={() => window.location.reload()}>
          Retry Loading
        </button>
      </div>
    );
  }

  return (
    <div className={styles.appContainer}>
      <TopBar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isMock={isMock}
        recommendationsCount={recommendationsData.items.length}
      />

      <main className={styles.mainContent}>
        {currentTab === 'map' && (
          <MapScreen
            stationsData={stationsData}
            hotspotsData={hotspotsData}
            flowsData={flowsData}
            regularsData={regularsData}
            suburbanData={suburbanData}
            recommendations={recommendationsData.items}
            selectedStationId={selectedStationId}
            onSelectStation={setSelectedStationId}
            onSelectRecommendation={handleSelectRecommendation}
          />
        )}
        {currentTab === 'fixit' && (
          <FixItScreen
            recommendationsData={recommendationsData}
            nudgeData={nudgeData}
            qualityReport={qualityReport}
            stationsData={stationsData}
            onJumpToStation={handleJumpToStation}
          />
        )}
        {currentTab === 'method' && (
          <HowItWorksScreen methodData={methodData} />
        )}
      </main>
    </div>
  );
};
