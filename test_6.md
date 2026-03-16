# Tests Unitarios — Semana 6

---

# Tests Unitarios — `src/translation/mapping-loader.ts`

Archivo de test sugerido: `test/unit/translation/mapping-loader.test.ts`

## Estrategia general

Mockear `MappingRepository` (inyectado por constructor) y `logger`. Usar `jest.spyOn(Date, 'now')` para controlar el TTL.

## Test 1: Primera llamada consulta DB
- Llamar `loadMappings('PIX', 'TO_CANONICAL')`.
- Verificar que `repo.findByRail` fue llamado con `['PIX', 'TO_CANONICAL']`.
- Verificar que retorna las entries del mock.

## Test 2: Segunda llamada retorna de cache
- Llamar `loadMappings` dos veces con mismos params.
- Verificar que `repo.findByRail` fue llamado solo 1 vez.

## Test 3: Cache expira después de TTL (5 min)
- Llamar `loadMappings` una vez.
- Avanzar `Date.now()` 5 minutos + 1ms.
- Llamar de nuevo.
- Verificar que `repo.findByRail` fue llamado 2 veces.

## Test 4: Keys diferentes no comparten cache
- Llamar `loadMappings('PIX', 'TO_CANONICAL')` y luego `loadMappings('SPEI', 'TO_CANONICAL')`.
- Verificar que `repo.findByRail` fue llamado 2 veces con params distintos.

## Test 5: `clearCache()` fuerza recarga
- Llamar `loadMappings`, luego `clearCache()`, luego `loadMappings` de nuevo.
- Verificar que `repo.findByRail` fue llamado 2 veces.

## Test 6: Logging muestra source 'cache' o 'db'
- Llamar `loadMappings` dos veces.
- Verificar que `logger.debug` fue llamado con `source: 'db'` la primera vez y `source: 'cache'` la segunda.
