/**
 * Config store schemas.
 * Estos son los datos que SÍ se persisten (Vercel KV).
 * Solo config — nunca PII ni tenencias.
 */
import { z } from 'zod';
import { BrokerCodeSchema } from '../schema';

// ─── Aliases de titulares ───────────────────────────────

export const AliasEntrySchema = z.object({
  /** Nombre variante (como aparece en algún broker) */
  variante: z.string(),
  /** Nombre canónico al que resuelve */
  canonico: z.string(),
  /** Quién lo creó */
  creado_por: z.string(),
  /** Timestamp ISO */
  fecha: z.string(),
});
export type AliasEntry = z.infer<typeof AliasEntrySchema>;

export const AliasStoreSchema = z.array(AliasEntrySchema);
export type AliasStore = z.infer<typeof AliasStoreSchema>;

// ─── Grupos de clientes ─────────────────────────────────

export const GrupoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  /** cliente_ids que pertenecen al grupo */
  cliente_ids: z.array(z.string()),
  creado_por: z.string(),
  fecha: z.string(),
});
export type Grupo = z.infer<typeof GrupoSchema>;

export const GruposStoreSchema = z.array(GrupoSchema);
export type GruposStore = z.infer<typeof GruposStoreSchema>;

// ─── Tickers metadata (clasificados) ────────────────────

export const TickerMetaSchema = z.object({
  pais: z.string().length(2).nullable(),
  clase: z.string(),
  es_etf: z.boolean(),
  nombre: z.string(),
  confirmado: z.boolean(),
  fuente: z.enum(['seed', 'admin', 'heuristica']),
  confirmado_por: z.string().nullable(),
  fecha: z.string(),
});
export type TickerMeta = z.infer<typeof TickerMetaSchema>;

export const TickersMetadataStoreSchema = z.record(z.string(), TickerMetaSchema);
export type TickersMetadataStore = z.infer<typeof TickersMetadataStoreSchema>;

// ─── Tickers pendientes (glosario) ──────────────────────

export const TickerPendienteSchema = z.object({
  ticker: z.string(),
  descripcion_muestra: z.string(),
  brokers_detectados: z.array(BrokerCodeSchema),
  clase_sugerida: z.string(),
  pais_sugerido: z.string().nullable(),
  primera_aparicion: z.string(),
  ocurrencias: z.number(),
  estado: z.enum(['pendiente', 'en_revision']),
});
export type TickerPendiente = z.infer<typeof TickerPendienteSchema>;

export const TickersPendientesStoreSchema = z.record(z.string(), TickerPendienteSchema);
export type TickersPendientesStore = z.infer<typeof TickersPendientesStoreSchema>;

// ─── Advisor por cliente ────────────────────────────────

export const ClienteAdvisorStoreSchema = z.record(
  z.string(), // cliente_id
  z.string() // advisor name
);
export type ClienteAdvisorStore = z.infer<typeof ClienteAdvisorStoreSchema>;

// ─── Mapping cuentas → titulares (GMA + MS) ─────────────

export const MappingCuentaEntrySchema = z.object({
  titular: z.string(),
  productor: z.string().nullable().optional(),
  advisor: z.string().nullable().optional(),
});
export type MappingCuentaEntry = z.infer<typeof MappingCuentaEntrySchema>;

export const MappingCuentaValueSchema = z.union([z.string(), MappingCuentaEntrySchema]);
export type MappingCuentaValue = z.infer<typeof MappingCuentaValueSchema>;

export const MappingCuentasStoreSchema = z.record(
  BrokerCodeSchema, // broker
  z.record(z.string(), MappingCuentaValueSchema) // cuenta → titular | { titular, productor, advisor }
);
export type MappingCuentasStore = z.infer<typeof MappingCuentasStoreSchema>;

// ─── Tipo cuenta MS (prefijos) ──────────────────────────

export const TipoCuentaMsStoreSchema = z.record(
  z.string(), // prefijo (ej. "B-", "" para sin prefijo)
  z.string()  // tipo (advisory, brokerage, lending, etc.)
);
export type TipoCuentaMsStore = z.infer<typeof TipoCuentaMsStoreSchema>;

// ─── FX defaults (tasa de referencia admin) ─────────────

export const FxDefaultsStoreSchema = z.object({
  /** Tasa MEP de referencia ARS/USD */
  mep: z.number().positive(),
  /** Fecha de la última actualización */
  fecha_actualizacion: z.string(),
  actualizado_por: z.string(),
});
export type FxDefaultsStore = z.infer<typeof FxDefaultsStoreSchema>;

// ─── Estado de imports automáticos desde Google Drive ───

export const DriveImportedEntrySchema = z.object({
  file_id: z.string(),
  name: z.string(),
  modified_time: z.string(),
  imported_at: z.string(),
});
export type DriveImportedEntry = z.infer<typeof DriveImportedEntrySchema>;

export const DriveImportedStoreSchema = z.record(z.string(), DriveImportedEntrySchema);
export type DriveImportedStore = z.infer<typeof DriveImportedStoreSchema>;
