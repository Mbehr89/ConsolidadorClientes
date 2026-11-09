/** Composición estática. No sale de una API. Fecha de la fuente: 6 de noviembre de 2026. */

export const ETF_DATA_AS_OF = '2026-11-06';

/** Tecnología, Comunicación, Consumo, Financiero, Salud, Industriales, Otros, Sin datos. */
export const ETF_SECTORS: Record<string, number[]> = {
  SPY: [36.8, 8.5, 14.4, 10.6, 10.3, 8.3, 7.5, 3.6],
  IWM: [14.2, 2.7, 12.3, 17.3, 14.8, 17.1, 11.3, 10.3],
  KWEB: [13.33, 32.28, 38.24, 0.95, 4.13, 6.06, 4.9, 0.11],
  FXI: [6.13, 14.34, 25.65, 37.27, 3.18, 2.65, 10.14, 0.64],
  ILF: [0, 1.88, 6.51, 30.46, 1.2, 6.46, 36.88, 16.61],
  VNQ: [0, 0, 0, 0, 0, 0, 100, 0],
  NATO: [0, 0, 0, 0, 0, 100, 0, 0],
  EWJ: [0, 0, 0, 0, 0, 0, 0, 100],
};

/** Sin look-through: diversificados a "ETF multisector" (7); VNQ y NATO a Otros (6). */
export const ETF_NO_LOOK_SECTOR: Record<string, number> = {
  SPY: 7,
  IWM: 7,
  KWEB: 7,
  FXI: 7,
  ILF: 7,
  EWJ: 7,
  VNQ: 6,
  NATO: 6,
};

export const ETF_NAMES: Record<string, string> = {
  SPY: 'SPDR S&P 500',
  IWM: 'iShares Russell 2000',
  KWEB: 'KraneShares China Internet',
  FXI: 'iShares China Large-Cap',
  ILF: 'iShares Latin America 40',
  VNQ: 'Vanguard Real Estate',
  NATO: 'Themes Transatlantic Defense',
  EWJ: 'iShares MSCI Japan',
};

/** [ticker, nombre, peso % dentro del ETF]. EWJ no publica composición. */
export const HOLD: Record<string, [string, string, number][]> = {
  SPY: [['NVDA', 'NVIDIA', 7.67], ['AAPL', 'Apple', 7.43], ['MSFT', 'Microsoft', 5.93], ['GOOGL', 'Alphabet (A + C)', 4.55], ['AMZN', 'Amazon', 3.77], ['AVGO', 'Broadcom', 2.42], ['META', 'Meta', 2.1], ['LLY', 'Eli Lilly', 1.73], ['TSLA', 'Tesla', 1.72], ['BRK-B', 'Berkshire Hathaway', 1.59], ['MU', 'Micron', 1.48], ['JPM', 'JPMorgan', 1.38], ['AMD', 'AMD', 1.21], ['XOM', 'ExxonMobil', 1.12], ['V', 'Visa', 1.1], ['NFLX', 'Netflix', 0.41], ['CRWD', 'CrowdStrike', 0.38], ['ABNB', 'Airbnb', 0.11], ['OXY', 'Occidental', 0.07]],
  IWM: [['CRDO', 'Credo Technology', 0.86], ['IONQ', 'IonQ', 0.5], ['BE', 'Bloom Energy', 0.49], ['FN', 'Fabrinet', 0.46], ['KTOS', 'Kratos Defense', 0.42], ['CDE', 'Coeur Mining', 0.39], ['RMBS', 'Rambus', 0.37], ['HIMS', 'Hims & Hers', 0.37], ['OKLO', 'Oklo', 0.35], ['SATS', 'EchoStar', 0.35]],
  KWEB: [['TENCENT', 'Tencent', 9.84], ['PDD', 'PDD Holdings', 8.56], ['BABA', 'Alibaba', 8.53], ['MEITUAN', 'Meituan', 7.47], ['NTES', 'NetEase', 6.63], ['BEKE', 'KE Holdings', 4.9], ['LENOVO', 'Lenovo', 4.32], ['JD', 'JD.com', 4.12], ['TCOM', 'Trip.com', 3.79], ['YMM', 'Full Truck Alliance', 3.13]],
  FXI: [['CCB', 'China Construction Bank', 9.81], ['BABA', 'Alibaba', 8.63], ['TENCENT', 'Tencent', 8.6], ['ICBC', 'ICBC', 6.69], ['XIAOMI', 'Xiaomi', 4.86], ['BOC', 'Bank of China', 4.76], ['MEITUAN', 'Meituan', 4.58], ['NTES', 'NetEase', 3.85], ['PINGAN', 'Ping An', 3.49], ['BYD', 'BYD', 3.08]],
  ILF: [['PBR', 'Petrobras', 12.77], ['NU', 'Nu Holdings', 7.82], ['VALE', 'Vale', 7.19], ['ITUB', 'Itaú Unibanco', 7.1], ['GMEX', 'Grupo México', 6.14], ['BAP', 'Credicorp', 3.88], ['BBD', 'Bradesco', 3.12], ['SCCO', 'Southern Copper', 2.92], ['B3', 'B3', 2.81], ['WEG', 'WEG', 2.27]],
  VNQ: [['VRTPX', 'Vanguard Real Estate II', 14.51], ['WELL', 'Welltower', 9.12], ['PLD', 'Prologis', 6.86], ['EQIX', 'Equinix', 5.65], ['AMT', 'American Tower', 4.32], ['SPG', 'Simon Property', 3.69], ['DLR', 'Digital Realty', 3.68], ['O', 'Realty Income', 2.85], ['PSA', 'Public Storage', 2.69], ['VMRK', 'Vivmark Residential', 2.46]],
  NATO: [['RTX', 'RTX', 8.37], ['RR', 'Rolls-Royce', 8.24], ['GE', 'GE Aerospace', 7.73], ['BA', 'Boeing', 7.4], ['SAF', 'Safran', 6.48], ['AIR', 'Airbus', 6.22], ['LMT', 'Lockheed Martin', 4.75], ['HWM', 'Howmet', 4.17], ['BAE', 'BAE Systems', 4.05], ['GD', 'General Dynamics', 3.89]],
  EWJ: [],
};

export const HOLDING_NAMES: Record<string, string> = {
  MSFT: 'Microsoft',
  NVDA: 'NVIDIA',
  TSM: 'TSMC',
  MKSI: 'MKS',
  CRWD: 'CrowdStrike',
  ASML: 'ASML',
  GLOB: 'Globant',
  GOOGL: 'Alphabet (A + C)',
  NFLX: 'Netflix',
  META: 'Meta',
  MELI: 'MercadoLibre',
  AMZN: 'Amazon',
  TSLA: 'Tesla',
  BABA: 'Alibaba',
  ABNB: 'Airbnb',
  NU: 'Nu Holdings',
  MFG: 'Mizuho',
  GGAL: 'Grupo Galicia',
  OXY: 'Occidental',
  CHRD: 'Chord Energy',
  GRSD: 'Grandstand (GRSD)',
};
