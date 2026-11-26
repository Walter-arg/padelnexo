// Modulo unico de validacion de horarios de partidos de zona, usado por
// TournamentZonePlanningScreen.js y TournamentFixtureScreen.js. No decide nada
// sobre como se arman las zonas ni sobre los cruces (eso sigue en cada
// pantalla, en buildZoneMatchRows / getPlanningMatchPairNumbers, etc). Este
// modulo solo sabe de tiempo: dado un horario candidato y lo que ya esta
// ocupado, dice si se puede usar o no, y por que.
//
// Es deliberadamente "puro": no importa React Native ni Firestore. Cada
// pantalla resuelve sus propios ids de participantes, sus propias labels y su
// propia advertencia de disponibilidad (cada una ya tiene su forma de leer
// disponibilidad cargada) y le pasa a este modulo datos simples.

export const DEFAULT_MATCH_DURATION_MINUTES = 75;
// Descanso minimo entre partidos de una misma pareja/cancha. Por ahora se usa
// 0 (sin descanso obligatorio); queda como parametro para poder sumarlo mas
// adelante (ej. configurable en Preferencias) sin tocar esta funcion.
export const DEFAULT_REST_MINUTES = 0;

export function formatMinutesToTime(totalMinutes = 0) {
  const safeMinutes = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hours = Math.floor(safeMinutes / 60) % 24;
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function isSameMatchEntry(entry, excludeKey) {
  if (!excludeKey) {
    return false;
  }

  return (
    String(entry.tournamentId || "") === String(excludeKey.tournamentId || "") &&
    String(entry.zoneId || "") === String(excludeKey.zoneId || "") &&
    String(entry.matchKey || "") === String(excludeKey.matchKey || "")
  );
}

// scheduledMatches: lista plana de partidos ya agendados (propios + de
// categorias hermanas del mismo evento), cada uno:
// {
//   tournamentId, zoneId, matchKey,       -> identifican el partido
//   categoryLabel, zoneLabel,             -> solo para mensajes
//   dayKey, startMinutes,                 -> horario
//   venueId, courtIndex,                  -> cancha
//   participantIds: string[],             -> ids de las 2 parejas (puede ir
//                                             vacio para partidos de otra
//                                             categoria: una pareja nunca
//                                             puede estar en 2 categorias del
//                                             mismo evento, asi que esos
//                                             partidos solo importan para la
//                                             ocupacion de cancha, nunca para
//                                             la de pareja)
// }
export function buildScheduleOccupancy(scheduledMatches = [], matchDurationMinutes = DEFAULT_MATCH_DURATION_MINUTES) {
  const byCourt = new Map();
  const byPair = new Map();

  scheduledMatches.forEach((match) => {
    if (!match || !match.dayKey || !Number.isFinite(Number(match.startMinutes))) {
      return;
    }

    const startMinutes = Number(match.startMinutes);
    const entry = {
      tournamentId: match.tournamentId || "",
      zoneId: match.zoneId || "",
      matchKey: match.matchKey || "",
      categoryLabel: match.categoryLabel || "",
      zoneLabel: match.zoneLabel || "",
      dayKey: match.dayKey,
      startMinutes,
      endMinutes: startMinutes + matchDurationMinutes,
      venueId: match.venueId || "",
      courtIndex: Number(match.courtIndex || 0),
    };

    if (entry.venueId && entry.courtIndex > 0) {
      const courtKey = `${entry.dayKey}|${entry.venueId}|${entry.courtIndex}`;
      if (!byCourt.has(courtKey)) {
        byCourt.set(courtKey, []);
      }
      byCourt.get(courtKey).push(entry);
    }

    (Array.isArray(match.participantIds) ? match.participantIds : []).forEach((pairId) => {
      if (!pairId) {
        return;
      }
      if (!byPair.has(pairId)) {
        byPair.set(pairId, []);
      }
      byPair.get(pairId).push(entry);
    });
  });

  return { byCourt, byPair };
}

// Valida un horario candidato para UN partido puntual.
//
// occupancy: lo que devuelve buildScheduleOccupancy.
// excludeKey: { tournamentId, zoneId, matchKey } del propio partido que se
//   esta agendando, para no chocar contra su propio horario ya guardado.
// dependsOn: para zonas de 4 (G vs G / P vs P), los partidos de ida de esa
//   misma zona que ya tienen horario: [{ dayKey, endMinutes }]. Si un partido
//   de ida todavia no tiene horario asignado, el llamador simplemente no lo
//   incluye aca (no se bloquea por un dato que no existe).
// pairLabelsById: { [pairId]: "Nombre / Nombre" } solo para armar el mensaje.
// availabilityWarning: string ya resuelta por el llamador ("" si no hay
//   advertencia). Este modulo no sabe leer disponibilidad cargada: cada
//   pantalla ya tiene su propia forma de resolverla.
export function validateMatchSlot({
  dayKey,
  startMinutes,
  venueId,
  courtIndex,
  participantIds = [],
  excludeKey = null,
  occupancy,
  matchDurationMinutes = DEFAULT_MATCH_DURATION_MINUTES,
  restMinutes = DEFAULT_REST_MINUTES,
  dependsOn = [],
  pairLabelsById = {},
  availabilityWarning = "",
}) {
  const startMin = Number(startMinutes) || 0;
  const endMin = startMin + matchDurationMinutes;
  const safeOccupancy = occupancy || { byCourt: new Map(), byPair: new Map() };

  // a) Cancha: rango completo (inicio -> inicio+duracion), contando los
  // partidos de todas las categorias hermanas del evento.
  if (venueId && Number(courtIndex || 0) > 0) {
    const courtKey = `${dayKey}|${venueId}|${Number(courtIndex)}`;
    const courtEntries = (safeOccupancy.byCourt.get(courtKey) || []).filter(
      (entry) => !isSameMatchEntry(entry, excludeKey)
    );
    const courtConflict = courtEntries.find(
      (entry) => entry.dayKey === dayKey && rangesOverlap(startMin, endMin, entry.startMinutes, entry.endMinutes)
    );

    if (courtConflict) {
      const who = courtConflict.categoryLabel
        ? `${courtConflict.categoryLabel} · ${courtConflict.zoneLabel || "otro partido"}`
        : courtConflict.zoneLabel || "otro partido";

      return {
        blocked: true,
        blockReason: `Cancha ${courtConflict.courtIndex} ocupada por ${who} hasta las ${formatMinutesToTime(courtConflict.endMinutes)}`,
      };
    }
  }

  // b) Pareja: no puede tener dos partidos de zona superpuestos (con
  // descanso minimo, si se configura mas adelante).
  for (const pairId of participantIds) {
    const entries = (safeOccupancy.byPair.get(pairId) || []).filter(
      (entry) => !isSameMatchEntry(entry, excludeKey)
    );
    const conflict = entries.find(
      (entry) =>
        entry.dayKey === dayKey &&
        rangesOverlap(startMin, endMin, entry.startMinutes - restMinutes, entry.endMinutes + restMinutes)
    );

    if (conflict) {
      const label = pairLabelsById[pairId] || "Una de las parejas";
      return {
        blocked: true,
        blockReason: `${label} esta jugando hasta las ${formatMinutesToTime(conflict.endMinutes)}`,
      };
    }
  }

  // c) Zonas de 4: G vs G / P vs P deben empezar despues de que terminen los
  // dos partidos de ida (mas descanso).
  const sameDayDependencies = dependsOn.filter((dependency) => dependency && dependency.dayKey === dayKey);
  if (sameDayDependencies.length) {
    const earliestAllowed = Math.max(...sameDayDependencies.map((dependency) => Number(dependency.endMinutes) || 0)) + restMinutes;

    if (startMin < earliestAllowed) {
      return {
        blocked: true,
        blockReason: `Este cruce depende de los partidos de ida de la zona: no puede empezar antes de las ${formatMinutesToTime(earliestAllowed)}`,
      };
    }
  }

  // d) Disponibilidad cargada: advertencia confirmable, nunca bloqueo.
  if (availabilityWarning) {
    return { blocked: false, warning: availabilityWarning };
  }

  return { blocked: false, warning: "" };
}

// Anota una lista de slots candidatos (cada uno con dayKey/startMinutes/
// venueId/courtIndex) con el resultado de validateMatchSlot, sin sacar nada
// de la lista. El llamador decide si filtra los bloqueados o los muestra
// deshabilitados con el motivo.
export function annotateSlotCandidates(slots = [], context = {}) {
  return slots.map((slot) => ({
    ...slot,
    ...validateMatchSlot({
      ...context,
      dayKey: slot.dayKey,
      startMinutes: slot.startMinutes,
      venueId: slot.venueId,
      courtIndex: slot.courtIndex,
    }),
  }));
}
