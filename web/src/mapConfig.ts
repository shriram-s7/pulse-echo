// mapbox-gl is loaded as a plain script (public/vendor/mapbox-gl.js, see index.html): Vite's dependency
// pre-bundling breaks its tile worker ("reading 'omit'") and leaves the map blank.
const mapboxgl: any = (typeof window !== 'undefined' ? (window as any).mapboxgl : undefined);
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Fix MapLibre worker loading in Vite if fallback is needed
if (typeof window !== 'undefined' && (maplibregl as any)?.setWorkerUrl) {
  (maplibregl as any).setWorkerUrl('/maplibre-gl-worker.mjs');
}

const rawToken = (import.meta.env.VITE_MAPBOX_TOKEN || '').trim();
export const mapboxToken = rawToken;
export const isMapbox = Boolean((window as any).mapboxgl && rawToken && rawToken !== 'YOUR_TOKEN' && rawToken.startsWith('pk.'));

export const MAP_STYLES = isMapbox
  ? { light: 'mapbox://styles/mapbox/streets-v12', dark: 'mapbox://styles/mapbox/dark-v11' }
  : { light: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json', dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' };
export const MAP_STYLE = MAP_STYLES.light;

export const mapConfig = {
  isMapbox,
  mapboxAccessToken: isMapbox ? rawToken : undefined,
  mapLib: isMapbox && mapboxgl ? mapboxgl : maplibregl,
  mapStyle: MAP_STYLE,
  initialViewState: {
    longitude: 80.22,
    latitude: 13.045,
    zoom: 11.6,
    pitch: 0,
    bearing: 0
  }
};