# Aranceles ALYC

Leé esto antes de tocar la sección. El historial real está en Drive (`aranceles-historial.json`), no en el repo. Las alícuotas que usa la app son las de `settings` de ese archivo. `DEFAULT_NET_RULES` en `lib/aranceles/settings.ts` es sólo el valor inicial.

## Fórmula

Para las dos ALYC, operación por operación, con la versión de alícuotas vigente a la fecha:

```
bruto ajustado = bruto + notas
IIBB           = bruto ajustado × alícuota, si ese tipo lleva IIBB
comisión neta  = bruto ajustado − IIBB
a pagar        = comisión neta × % ÷ IVA
```

El bruto es el arancel del archivo (`commission`), no el importe de la orden (`amount`). En IEB las notas de débito y crédito entran con signo en el tipo que indica la especie. Si el tipo no lleva IVA, el divisor es 1.

El % sale en este orden: el del manager para ese segmento, si no el arreglo comercial con fechas de ese productor IEB, si no el estándar de la versión vigente. Un casillero vacío en Configuración significa «usar el estándar».

## Segmentos

IEB: títulos privados, títulos públicos, licitaciones, diferencia de precios (SENEBI), fondos de terceros, FCI IEB.

GMA: títulos privados, títulos públicos, diferencia de precios (SENEBI), cauciones.

El Excel de GMA siempre trae el arancel sin IVA, aunque después ese instrumento se cobre con IVA. `lleva_iva` sólo multiplica por 1,21 la columna «con IVA» del resumen. No cambia la lectura ni el a pagar.

## Configuración

Pantalla: Aranceles → Configuración.

- El % de la tabla de alícuotas vale para todos.
- «Porcentaje por manager» pisa un segmento para una persona. En IEB se reconoce por el productor o su alias (MILI, MARTIN, CLAUDIO). En GMA, por el oficial de cuenta.
- Cada tipo se marca si lleva IIBB. En GMA, además, si la columna con IVA lo multiplica.
- Un arreglo comercial con fechas sólo aplica si ese casillero del manager está vacío.

No des por hecho el 65% o el 70% del código: mirá `settings.net_rules` y `settings.manager_shares` del historial.

## Identidad de cada operación

Código: `lib/aranceles/dedup.ts` y `applyImport` en `lib/aranceles/history.ts`.

Con boleto o ID, la clave es ALYC + familia de planilla + número. Público y privado de IEB comparten familia. ACDI, notas, licitaciones y diferencias tienen la suya.

- Mismo número y mismos datos: ya estaba. No se duplica.
- Mismo número y otros datos: conflicto. No se pisa, salvo ACDI.
- Sin número: se compara el contenido y se cuentan las repeticiones.
- Otro número, pero misma cuenta, fecha, instrumento, arancel y moneda: es la misma operación de títulos. IEB a veces cambia el boleto y también el bruto de la orden. No se suma. La fila que ya estaba pasa a tener el boleto y el bruto nuevos, así un archivo posterior la encuentra y no abre otra. Si ese archivo trae además otro arancel para ese boleto, queda como conflicto: no se pisa ni se duplica.
- Dos boletos de títulos dentro del mismo archivo se conservan: son dos operaciones.
- FCI IEB es una posición por cuenta, día, fondo y moneda cuando los boletos son de series distintas: se distancian 100.000 o más. Al reemitir, IEB cambia el boleto, el arancel y la cantidad, y a veces le agrega «ARS» o «USD» al nombre del fondo. No se suman las dos copias, aunque vengan en el mismo archivo. Queda la serie que volvió en el archivo más nuevo. Si se vieron juntas, queda el boleto más alto. Dos boletos cercanos son dos suscripciones y se conservan. Un archivo posterior pisa la posición reemitida: no abre una fila nueva.
- Antes de guardar, si apareciera un FCI dos veces en series distintas, la escritura se aborta.
- Si una fila de IEB viene sin productor, hereda el de esa cuenta en el mismo mes. Si en el mes no hay, el de la cuenta cuando en todo el historial tuvo un solo productor. Las filas en dólares de septiembre de Izzo, Vázquez, López Davio y Scalambrino quedan en Mili por esta regla.

ACDI es la excepción del mismo ID: si el ID ya existe, se actualiza la fecha y el resto de los datos. No es conflicto. La fecha sale de las columnas Año y Mes (se guarda como día 1 de ese mes). Sin esas columnas se usa la fecha de respaldo del archivo.

Un archivo de Drive que no cambió no se vuelve a leer. Si cambió, se sacan las filas de la importación anterior y se aplica de nuevo. Las que también vinieron en otro archivo se conservan.

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Neto, a pagar, columna con IVA | `lib/aranceles/net.ts` |
| Alícuotas, managers, arreglos | `lib/aranceles/settings.ts` |
| Leer y guardar el historial | `lib/aranceles/store.ts` |
| Importar desde Drive | `lib/aranceles/import-service.ts` |
| Planillas IEB, incluido ACDI | `lib/aranceles/mappers/ieb.ts` |
| Planilla GMA | `lib/aranceles/mappers/gma.ts` |
| Pantallas | `app/(app)/aranceles/` |

Para contrastar un número con la planilla, usá `buildNetReport` sobre el historial. No sumes filas a mano sin pasar por el neto: el bruto de la orden no es el arancel, y el dólar cable es `USD_EXT`.

## Balances

La sección Balances parte del a pagar de Aranceles, agrupado por grupo asesor y mes. El dólar billete y el dólar cable se valúan con el tipo de cambio en pesos que se carga para ese mes. Con eso el flujo se ve entero en pesos o entero en dólares.

```
ingresos  = a pagar en $ + a pagar en U$D × tipo de cambio
resultado = ingresos − sueldos − otros gastos
socio     = resultado × su % de beneficio
```

El % de equity no reparte el resultado: queda al lado, como «si se repartiera por capital». Si los % de beneficio no suman 100, el resto queda sin asignar y se muestra. Un mes sin tipo de cambio no inventa el número unificado.

Socios, sueldos, gastos y tipos de cambio se guardan en `settings.balances` del mismo historial de Drive. Guardar las alícuotas no los pisa. El cálculo está en `lib/balances/`.
