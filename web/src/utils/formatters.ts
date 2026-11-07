// Utility for formatting station names, destinations, and metrics cleanly across the app

const STATION_NAME_MAP: Record<string, string> = {
  central: 'Central',
  alandur: 'Alandur',
  cmbt: 'CMBT',
  'government-estate': 'Government Estate',
  'ota-nanganallur-road': 'Nanganallur Road',
  'st-thomas-mount': 'St. Thomas Mount',
  'high-court': 'High Court',
  'wimco-nagar-depot': 'Wimco Nagar Depot',
  'wimco-nagar': 'Wimco Nagar',
  'anna-nagar-tower': 'Anna Nagar Tower',
  'anna-nagar-east': 'Anna Nagar East',
  'thiruvotriyur-theradi': 'Thiruvotriyur Theradi',
  'thiyagaraya-college': 'Thiyagaraya College',
  'new-washermenpet': 'New Washermenpet',
  'thousand-lights': 'Thousand Lights',
  'ag-dms': 'AG-DMS',
  'little-mount': 'Little Mount',
  'ashok-nagar': 'Ashok Nagar',
  'nehru-park': 'Nehru Park',
  'pachiappas-college': 'Pachaiyappa’s College',
  'shenoy-nagar': 'Shenoy Nagar',
  'vadapalani': 'Vadapalani',
  'koyambedu': 'Koyambedu',
  'guindy': 'Guindy',
  'saidapet': 'Saidapet',
  'teynampet': 'Teynampet',
  'nandanam': 'Nandanam',
  'lic': 'LIC',
  'egmore': 'Egmore',
  'kilpauk': 'Kilpauk',
  'airport': 'Airport',
  'meenambakkam': 'Meenambakkam',
  'thirumangalam': 'Thirumangalam',
  'washermenpet': 'Washermenpet',
  'mannadi': 'Mannadi',
  'tollgate': 'Tollgate',
  'kaladipet': 'Kaladipet',
  'tondiarpet': 'Tondiarpet',
  'arumbakkam': 'Arumbakkam',
  'ekkattuthangal': 'Ekkattuthangal'
};

export function toTitleCase(str: string): string {
  if (!str) return '';
  const upper = str.toUpperCase().trim();
  if (upper === 'CMBT') return 'CMBT';
  if (upper === 'AG-DMS') return 'AG-DMS';
  if (upper === 'LIC') return 'LIC';
  if (upper === 'OTA') return 'OTA';
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-|\/)\S/g, (char) => char.toUpperCase());
}

export function getShortStationName(name: string, id?: string): string {
  if (id && STATION_NAME_MAP[id.toLowerCase()]) {
    return STATION_NAME_MAP[id.toLowerCase()];
  }
  if (!name) return '';

  let clean = name.trim();
  // Strip METRO or METRO STATION suffix
  clean = clean.replace(/\bMETRO\s*(STATION)?\b/gi, '').trim();

  // Strip known honorary prefixes
  clean = clean.replace(/PURATCHI\s+THALAIVAR\s+DR\.?\s*M\.?G\.?R(AMACHANDRAN)?/gi, '');
  clean = clean.replace(/PURATCHI\s+THALAIVI\s+DR\.?\s*J\.?\s*JAYALALITHAA/gi, '');
  clean = clean.replace(/SELVI\s+J\.?\s*JAYALALITHAA/gi, '');
  clean = clean.replace(/ARIGNAR\s+ANNA/gi, '');
  clean = clean.replace(/DR\.?\s*M\.?G\.?R(AMACHANDRAN)?/gi, '');
  clean = clean.trim();

  // Generic rule: if longer than 20 chars, keep its last 2 meaningful words
  if (clean.length > 20) {
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 2) {
      clean = words.slice(-2).join(' ');
    }
  }

  return toTitleCase(clean);
}

export function cleanDestinationHint(hint: string): string {
  if (!hint) return '';
  // Strip leading "likely" (case-insensitive) to avoid duplication
  let clean = hint.replace(/^likely\s+/i, '').trim();
  return clean;
}

