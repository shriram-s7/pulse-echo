import React from 'react';
import styles from './TopBar.module.css';
import { Map, Sliders, BookOpen } from 'lucide-react';

interface TopBarProps {
  currentTab: 'map' | 'fixit' | 'method';
  onSelectTab: (tab: 'map' | 'fixit' | 'method') => void;
  isMock: boolean;
  recommendationsCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  currentTab,
  onSelectTab,
  isMock,
  recommendationsCount
}) => {
  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <div className={styles.brand}>
          <div className={styles.brandLogo}>
            <span className={styles.pulseDot}></span>
            <span className={styles.echoRing}></span>
          </div>
          <div className={styles.brandText}>
            <span className={styles.title}>Pulse–Echo</span>
            <span className={styles.subtitle}>CUMTA PS3</span>
          </div>
        </div>

        {/* Show Mock data badge ONLY when in mock mode */}
        {isMock && (
          <div className={styles.mockBadge} title="Using contract mock data (/mock/)">
            <span className={styles.mockDot}></span>
            <span>Mock data</span>
          </div>
        )}
      </div>

      <nav className={styles.navTabs}>
        <button
          className={`${styles.tabBtn} ${currentTab === 'map' ? styles.activeTab : ''}`}
          onClick={() => onSelectTab('map')}
        >
          <Map size={16} />
          <span>Map</span>
        </button>
        <button
          className={`${styles.tabBtn} ${currentTab === 'fixit' ? styles.activeTab : ''}`}
          onClick={() => onSelectTab('fixit')}
        >
          <Sliders size={16} />
          <span>Fix It</span>
          {recommendationsCount > 0 && (
            <span className={styles.badge}>{recommendationsCount}</span>
          )}
        </button>
        <button
          className={`${styles.tabBtn} ${currentTab === 'method' ? styles.activeTab : ''}`}
          onClick={() => onSelectTab('method')}
        >
          <BookOpen size={16} />
          <span>How it works</span>
        </button>
      </nav>

      <div className={styles.rightSection}>
        <div className={styles.dateWindow}>
          <span className={styles.dateLabel}>Data Window:</span>
          <span className={styles.dateRange}>3–6 Mar 2026</span>
        </div>
      </div>
    </header>
  );
};
