# Motor de calendario de bonos y métricas (TIR / duration)

Este documento está pensado para **copiarlo a otro proyecto** (por ejemplo como `README.md` o `docs/BOND_PAYMENTS.md`) y que el asistente en Cursor implemente un parser y un motor de renta fija **compatible** con la misma fuente de datos que usa el Portfolio Dashboard.

## Objetivo

- Leer un **CSV de calendario de pagos** (export de Google Sheets) definido por la variable de entorno **`BOND_PAYMENTS_URL`** (este repo, Next.js). En un proyecto Vite suele llamarse `VITE_BOND_PAYMENTS_URL`.
- Producir una lista de **eventos por bono y fecha**: montos **por cada 100 de nominal** (`flowPer100`), más columnas opcionales (cupón/amort/moneda).
- Con esa curva + **valor de posición en USD** + **nominal** (o precio sucio + moneda del VN) + **tipo de cambio USD/ARS** si aplica, calcular **TIR (YTM anual efectiva)**, **Macaulay**, **duration modificada** y **convexidad** con las mismas convenciones descritas abajo.

**Importante:** el CSV de pagos **no** incluye metadata de emisor/curva/moneda de emisión; eso puede vivir en otro glosario. Este archivo solo define **qué paga el bono y cuándo**.

---

## Origen del CSV

- URL típica: export de Google Sheet  
  `https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}`
- En cliente: descargar con `fetch(url, { cache: 'no-store' })` para evitar caché obsoleta.

---

## Formato del archivo

### Separador

- Mirar la **primera línea no vacía** del archivo: si hay más `;` que `,`, usar `;`; si no, `,`.

### Filas

- Ignorar filas completamente vacías.
- El **encabezado no tiene que ser la fila 1**: escanear las **primeras 5 filas** de datos.

### Normalización de texto (headers y búsqueda)

Para cada celda de encabezado:

- Quitar BOM (`\uFEFF`), `trim`, minúsculas, quitar acentos (NFD + quitar marcas combinantes).

### Encabezados en dos líneas (planillas tipo Excel/Sheets)

Para cada fila candidata `i` (0..4):

1. Usar la fila `i` sola como vector de headers.
2. Construir también un vector **fusionado** con la fila `i-1` si existe:  
   `merged[col] = trim(prev[col] + " " + curr[col])`.

Probar **cada** header normal y fusionado hasta encontrar un mapeo válido (ver siguiente sección).

---

## Columnas requeridas y opcionales

Se elige el **primer** candidato (orden: fila 0, merge 0–1, fila 1, merge 1–2, …) donde existan **simultáneamente**:

| Campo lógico | Requisito | Cómo encontrar el índice de columna |
|--------------|-----------|-------------------------------------|
| **Fecha** | Obligatorio | Header que incluya `fecha`, `efectiva`, `payment date` o `date`. |
| **Ticker / bono** | Obligatorio | Incluya `ticker`, `bono`, `asset` o `especie`. |
| **Flujo total c/100 VN** | Obligatorio | Ver prioridad especial abajo. |
| **Moneda** | Opcional | `moneda`, `currency`, `denominacion`, `mon. pago`. Si no hay: asumir `USD`. |
| **Cupón c/100** | Opcional | Preferir: `c/100` + `vn` + algo de `inter`, sin `total`, sin `tasa`. Si no: `cupon`, `coupon`, `interes`. |
| **Amortización c/100** | Opcional | Similar con `amort` / `amortizacion` / `amortization`. |
| **Valor residual %** | Opcional | `valor residual`, `residual`, `valor resid` (informativo; el motor principal usa el **total**). |
| **Régimen (ley / AFIP)** | Opcional | Encabezados tipo `régimen impositivo`, `tratamiento fiscal`, `AFIP` (valores: ley general, régimen AFIP, etc.). Si hay **dos filas** para el mismo bono y fecha sin esta columna, el parser asigna **1.ª fila = ley general**, **2.ª = AFIP** (evita doble conteo; en la UI se elige qué brazo ver). |
| **Dos series en columna Ticker** | Convención | Mismo VN lógico con flujos distintos (p. ej. `BPOC7` vs `BPOC7 @AFIP`): la variante con `@AFIP` / `(AFIP)` es la serie AFIP; la otra se trata como ley general. El cruce con cartera sigue usando el ticker base (p. ej. `BPOC7`). |

### Prioridad para la columna “Flujo de fondos c/100 vn” (total)

1. Buscar header que tenga **`c/100`**, **`vn`** y **`total`**, y que **no** sea solo “flujo de fondos total” sin `c/100` (evita matchear la columna equivocada).
2. Si no hay: buscar `flujo de fondos total`, `flujo total`, `total flow`, `cash flow total`, o `total`.

Si no se resuelven **fecha + ticker + flujo total**, el parseo debe devolver **lista vacía**.

---

## Parseo de cada fila de datos

- Empezar en la fila **inmediatamente debajo** del `rowIndex` del encabezado elegido.

### Fecha (`parseDdMmYyyyDate`)

- Si el string es un número (regex tipo entero/decimal) y el valor es **> 20000**: tratarlo como **fecha serial de Excel** (epoch 30-dic-1899 UTC + días).
- Si no: partir por `/`, `-` o espacios en **3 partes** → interpretar como **`DD/MM/YYYY`** (mes 1–12, día 1–31), construir `Date` en **UTC** medianoche.

### Ticker

- `trim` + **`.toUpperCase()`** (sin quitar `%` ni `_` aquí; el cruce con otras fuentes puede normalizar aparte).

### Números (`parseNumber`)

- `trim`; si es `nan` (case insensitive), ignorar.
- Reemplazar `,` por `.`, quitar todo lo que no sea dígitos, `-` o `.`.
- Parsear a `number`; si no es finito, `undefined`.

### Fila válida

- Requiere: fecha definida, ticker no vacío, **flujo total** numérico definido.
- Construir un objeto evento por fila, por ejemplo:

```ts
interface BondPaymentEvent {
  asset: string;           // ticker UPPERCASE
  date: Date;
  currency: string;        // default 'USD'
  flowPer100: number;      // columna "total" c/100 vn — escala el cash
  couponPer100?: number;
  amortizationPer100?: number;
  residualPctOfPar?: number; // si aplica: si raw ≤ 1, multiplicar ×100
  flowRegime?: 'afip' | 'normal'; // doble fila ley/AFIP (opcional)
}
```

### Semántica de `flowPer100`

Es el **“Flujo de fondos c/100 vn”**: ya refleja cupón + amort sobre nominal vivo en la convención de la planilla. **No** volver a aplicar el % residual para escalar el monto principal del cashflow (evita doble conteo).

Cash de la posición en moneda del flujo:

\[
\text{monto} = \frac{\text{flowPer100}}{100} \times N
\]

donde \(N\) = nominal de la posición en las mismas unidades que usa el precio “por 100”.

---

## De eventos a TIR y duration (misma lógica que el dashboard)

Entradas además del calendario:

- `valuationDate`: fecha de la cartera (usar día en UTC para comparar con fechas de cupones).
- `holdingValueUsd` \(V\): valor de la posición en USD.
- `nominalHeld` \(N\): desde archivo de posiciones, o \(N = V / (\text{dirtyPrice}/100)\) según moneda del VN y FX.
- `usdArsFxRate`: ARS por 1 USD (si algún flujo futuro está en ARS, convertir monto a USD dividiendo por este tipo).

### Filtrado

- Solo eventos con `asset` igual al ticker del bono (misma convención `toUpperCase()`).
- Solo fechas de cupón con **día ≥ día de valuación** (UTC).

### Monto en USD por evento

- Base: `flowOriginal = (flowPer100 / 100) * N`.
- Si `currency` es `ARS` o contiene `PESO`: `flowUsd = flowOriginal / usdArsFxRate` (requiere FX > 0).
- Si no: `flowUsd = flowOriginal`.

### Tiempo en años

- Entre `valuationDate` y `event.date`: fracción **ACT/365** (solo días calendario en UTC):

\[
t = \frac{\text{UTC}(event) - \text{UTC}(valuation)}{365 \times 86400000}
\]

### TIR (YTM)

Buscar \(y \geq 0\) tal que:

\[
\sum_t \frac{\text{amt}_t}{(1+y)^{t}} = V
\]

donde `amt_t` son los `flowUsd` futuros y \(V\) es el precio sucio / valor de mercado de la posición en USD. Implementación de referencia: bisección con tolerancia relativa ~1e-9 sobre el NPV.

Si el NPV a \(y=0\) ya es **menor** que \(V\), no hay solución YTM no negativa estándar con esos datos.

### Macaulay, duration modificada, convexidad

Con el \(y\) encontrado y los mismos flujos:

- Macaulay (años): \(\frac{1}{V} \sum_t t \cdot \frac{\text{amt}_t}{(1+y)^t}\)
- Modified duration: `macaulay / (1 + y)`
- Convexidad: fórmula estándar con factores \((1+y)\) y términos \(t(t+1)\) (ver implementación tipo `metricsFromYield`).

### TEA / TNA (opcional)

- En el dashboard, TEA ≈ TIR en % anual efectiva.
- TNA nominal anual con capitalización mensual equivalente:  
  `12 * ((1 + y)^(1/12) - 1) * 100`.

---

## Checklist de implementación (para Cursor en el otro proyecto)

1. [ ] Variable `BOND_PAYMENTS_URL` (Next.js / servidor) o `VITE_BOND_PAYMENTS_URL` (Vite) y fetch sin caché.
2. [ ] Parser CSV con detección de separador y headers en 5 filas + merge con fila anterior.
3. [ ] Mapeo de columnas con la tabla y prioridades de arriba.
4. [ ] `parseDdMmYyyyDate` + `parseNumber` como se describe.
5. [ ] Salida: `BondPaymentEvent[]`.
6. [ ] Módulo de métricas: filtrar por ticker y fechas futuras, FX ARS→USD, ACT/365, bisección para \(y\), duration/convexidad.
7. [ ] Tests con un CSV mínimo (2–3 filas) y un caso ARS con FX.

---

## Notas

- Este README describe el **contrato de datos** y la **matemática**; no copia código literal del repo origen.
- Si el otro proyecto solo necesita **curva de flujos** sin cartera, puede omitir TIR/duration y solo exponer `events` agregados por ticker y fecha.

---

## Versión

- Alineado conceptualmente con el parser en `parseBondPaymentCalendarCsv` y métricas en `computeBondYieldMetrics` / `solveAnnualEffectiveYield` del Portfolio Dashboard (misma semántica de columnas y de flujos c/100 VN).
