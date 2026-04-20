/**
 * Typed accessors for each config store.
 * Import these instead of using getStore/setStore directly.
 */
import { getStore, setStore, STORE_KEYS } from './index';
import {
  AliasStoreSchema,
  GruposStoreSchema,
  TickersMetadataStoreSchema,
  TickersPendientesStoreSchema,
  ClienteAdvisorStoreSchema,
  MappingCuentasStoreSchema,
  TipoCuentaMsStoreSchema,
  FxDefaultsStoreSchema,
  DriveImportedStoreSchema,
  type AliasStore,
  type GruposStore,
  type TickersMetadataStore,
  type TickersPendientesStore,
  type ClienteAdvisorStore,
  type MappingCuentasStore,
  type TipoCuentaMsStore,
  type FxDefaultsStore,
  type DriveImportedStore,
} from './types';

// ─── Aliases ────────────────────────────────────────────

export async function getAliases(): Promise<AliasStore> {
  return getStore(STORE_KEYS.ALIASES, AliasStoreSchema, []);
}

export async function setAliases(value: AliasStore): Promise<void> {
  return setStore(STORE_KEYS.ALIASES, AliasStoreSchema, value);
}

// ─── Grupos ─────────────────────────────────────────────

export async function getGrupos(): Promise<GruposStore> {
  return getStore(STORE_KEYS.GRUPOS, GruposStoreSchema, []);
}

export async function setGrupos(value: GruposStore): Promise<void> {
  return setStore(STORE_KEYS.GRUPOS, GruposStoreSchema, value);
}

// ─── Tickers metadata ───────────────────────────────────

export async function getTickersMetadata(): Promise<TickersMetadataStore> {
  return getStore(STORE_KEYS.TICKERS_METADATA, TickersMetadataStoreSchema, {});
}

export async function setTickersMetadata(value: TickersMetadataStore): Promise<void> {
  return setStore(STORE_KEYS.TICKERS_METADATA, TickersMetadataStoreSchema, value);
}

// ─── Tickers pendientes (glosario) ──────────────────────

export async function getTickersPendientes(): Promise<TickersPendientesStore> {
  return getStore(STORE_KEYS.TICKERS_PENDIENTES, TickersPendientesStoreSchema, {});
}

export async function setTickersPendientes(value: TickersPendientesStore): Promise<void> {
  return setStore(STORE_KEYS.TICKERS_PENDIENTES, TickersPendientesStoreSchema, value);
}

// ─── Advisor por cliente ────────────────────────────────

export async function getClienteAdvisors(): Promise<ClienteAdvisorStore> {
  return getStore(STORE_KEYS.CLIENTE_ADVISORS, ClienteAdvisorStoreSchema, {});
}

export async function setClienteAdvisors(value: ClienteAdvisorStore): Promise<void> {
  return setStore(STORE_KEYS.CLIENTE_ADVISORS, ClienteAdvisorStoreSchema, value);
}

// ─── Mapping cuentas ────────────────────────────────────

export async function getMappingCuentas(): Promise<MappingCuentasStore> {
  return getStore(STORE_KEYS.MAPPING_CUENTAS, MappingCuentasStoreSchema, {
    MS: {},
    GMA: {},
    NETX360: {},
    IEB: {},
  });
}

export async function setMappingCuentas(value: MappingCuentasStore): Promise<void> {
  return setStore(STORE_KEYS.MAPPING_CUENTAS, MappingCuentasStoreSchema, value);
}

// ─── Tipo cuenta MS ─────────────────────────────────────

export async function getTipoCuentaMs(): Promise<TipoCuentaMsStore> {
  return getStore(STORE_KEYS.TIPO_CUENTA_MS, TipoCuentaMsStoreSchema, {
    'B-': 'brokerage', // confirmado por el usuario
  });
}

export async function setTipoCuentaMs(value: TipoCuentaMsStore): Promise<void> {
  return setStore(STORE_KEYS.TIPO_CUENTA_MS, TipoCuentaMsStoreSchema, value);
}

// ─── FX defaults ────────────────────────────────────────

const FX_DEFAULTS_INITIAL: FxDefaultsStore = {
  mep: 1438,
  fecha_actualizacion: new Date().toISOString(),
  actualizado_por: 'system',
};

export async function getFxDefaults(): Promise<FxDefaultsStore> {
  return getStore(STORE_KEYS.FX_DEFAULTS, FxDefaultsStoreSchema, FX_DEFAULTS_INITIAL);
}

export async function setFxDefaults(value: FxDefaultsStore): Promise<void> {
  return setStore(STORE_KEYS.FX_DEFAULTS, FxDefaultsStoreSchema, value);
}

// ─── Drive imported state ────────────────────────────────

export async function getDriveImported(): Promise<DriveImportedStore> {
  return getStore(STORE_KEYS.DRIVE_IMPORTED, DriveImportedStoreSchema, {});
}

export async function setDriveImported(value: DriveImportedStore): Promise<void> {
  return setStore(STORE_KEYS.DRIVE_IMPORTED, DriveImportedStoreSchema, value);
}
