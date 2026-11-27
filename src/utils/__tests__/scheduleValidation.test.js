// Tests del modulo puro de validacion de horarios. Se corren con el test
// runner que ya trae Node (node --test), sin instalar nada nuevo: el modulo
// bajo prueba usa sintaxis de ESM (export function/const), asi que este
// archivo registra un loader minimo que la transforma a CommonJS con
// @babel/core (que ya esta en node_modules como dependencia de Expo/Metro)
// solo para ESTE archivo, antes de requerirlo.

const Module = require("module");
const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const babel = require("@babel/core");

const TARGET_PATH = path.join(__dirname, "..", "scheduleValidation.js");
const originalJsLoader = Module._extensions[".js"];

Module._extensions[".js"] = function patchedJsLoader(moduleInstance, filename) {
  if (filename !== TARGET_PATH) {
    return originalJsLoader(moduleInstance, filename);
  }

  const source = fs.readFileSync(filename, "utf8");
  const { code } = babel.transform(source, {
    babelrc: false,
    configFile: false,
    filename,
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
  });

  moduleInstance._compile(code, filename);
};

const {
  DEFAULT_MATCH_DURATION_MINUTES,
  DEFAULT_REST_MINUTES,
  buildScheduleOccupancy,
  formatMinutesToTime,
  validateMatchSlot,
} = require("../scheduleValidation.js");

Module._extensions[".js"] = originalJsLoader;

test("DEFAULT_MATCH_DURATION_MINUTES es 75 y DEFAULT_REST_MINUTES es 0", () => {
  assert.equal(DEFAULT_MATCH_DURATION_MINUTES, 75);
  assert.equal(DEFAULT_REST_MINUTES, 0);
});

test("a) cancha ocupada por categoria hermana con rango superpuesto -> conflicto con el mensaje correcto", () => {
  const occupancy = buildScheduleOccupancy(
    [
      {
        categoryLabel: "5ta",
        courtIndex: 2,
        dayKey: "2026-03-06",
        matchKey: "1 vs 2",
        participantIds: [],
        startMinutes: 19 * 60,
        tournamentId: "sibling-tournament",
        venueId: "venue-1",
        zoneId: "zone-b",
        zoneLabel: "Zona B",
      },
    ],
    75
  );

  const result = validateMatchSlot({
    courtIndex: 2,
    dayKey: "2026-03-06",
    excludeKey: { matchKey: "1 vs 2", tournamentId: "own-tournament", zoneId: "zone-a" },
    occupancy,
    participantIds: [],
    startMinutes: 19 * 60 + 30,
    venueId: "venue-1",
  });

  assert.equal(result.hasConflict, true);
  assert.equal(result.conflictReason, "Cancha 2 ocupada por 5ta · Zona B hasta las 20:15");
  assert.equal(result.availabilityWarning, "");
});

test("b) un partido termina justo cuando empieza el otro (misma cancha) -> sin conflicto", () => {
  const occupancy = buildScheduleOccupancy(
    [
      {
        courtIndex: 2,
        dayKey: "2026-03-06",
        matchKey: "1 vs 2",
        participantIds: [],
        startMinutes: 19 * 60,
        tournamentId: "sibling-tournament",
        venueId: "venue-1",
        zoneId: "zone-b",
      },
    ],
    75
  );

  const result = validateMatchSlot({
    courtIndex: 2,
    dayKey: "2026-03-06",
    occupancy,
    participantIds: [],
    startMinutes: 20 * 60 + 15,
    venueId: "venue-1",
  });

  assert.equal(result.hasConflict, false);
  assert.equal(result.conflictReason, "");
});

test("c) una pareja con dos partidos superpuestos en distintas canchas -> conflicto", () => {
  const occupancy = buildScheduleOccupancy(
    [
      {
        courtIndex: 3,
        dayKey: "2026-03-06",
        matchKey: "1 vs 2",
        participantIds: ["pair-1", "pair-2"],
        startMinutes: 19 * 60,
        tournamentId: "own-tournament",
        venueId: "venue-1",
        zoneId: "zone-a",
      },
    ],
    75
  );

  const result = validateMatchSlot({
    courtIndex: 4,
    dayKey: "2026-03-06",
    excludeKey: { matchKey: "1 vs 3", tournamentId: "own-tournament", zoneId: "zone-a" },
    occupancy,
    participantIds: ["pair-1", "pair-3"],
    pairLabelsById: { "pair-1": "Gomez / Ruiz" },
    startMinutes: 19 * 60 + 30,
    venueId: "venue-1",
  });

  assert.equal(result.hasConflict, true);
  assert.equal(result.conflictReason, "Gomez / Ruiz esta jugando hasta las 20:15");
});

test("d) zona de 4: G vs G antes de que terminen los dos de ida -> conflicto; justo al terminar -> sin conflicto", () => {
  const dependsOn = [
    { dayKey: "2026-03-06", endMinutes: 20 * 60 + 15 },
    { dayKey: "2026-03-06", endMinutes: 20 * 60 + 30 },
  ];

  const tooEarly = validateMatchSlot({
    courtIndex: 5,
    dayKey: "2026-03-06",
    dependsOn,
    occupancy: buildScheduleOccupancy([], 75),
    participantIds: [],
    startMinutes: 20 * 60,
    venueId: "venue-1",
  });

  assert.equal(tooEarly.hasConflict, true);
  assert.equal(
    tooEarly.conflictReason,
    "Este cruce depende de los partidos de ida de la zona: no puede empezar antes de las 20:30"
  );

  const rightOnTime = validateMatchSlot({
    courtIndex: 5,
    dayKey: "2026-03-06",
    dependsOn,
    occupancy: buildScheduleOccupancy([], 75),
    participantIds: [],
    startMinutes: 20 * 60 + 30,
    venueId: "venue-1",
  });

  assert.equal(rightOnTime.hasConflict, false);
});

test("e) horario fuera de la disponibilidad cargada -> advertencia, nunca conflicto", () => {
  const result = validateMatchSlot({
    availabilityWarning: "Este horario esta fuera de la disponibilidad cargada por alguna de las parejas.",
    courtIndex: 1,
    dayKey: "2026-03-06",
    occupancy: buildScheduleOccupancy([], 75),
    participantIds: ["pair-1"],
    startMinutes: 19 * 60,
    venueId: "venue-1",
  });

  assert.equal(result.hasConflict, false);
  assert.equal(
    result.availabilityWarning,
    "Este horario esta fuera de la disponibilidad cargada por alguna de las parejas."
  );
});

test("f) la duracion sale de matchDurationMinutes; si no se pasa, usa 75 por defecto", () => {
  const occupancy = buildScheduleOccupancy(
    [
      {
        courtIndex: 1,
        dayKey: "2026-03-06",
        matchKey: "1 vs 2",
        participantIds: [],
        startMinutes: 19 * 60,
        tournamentId: "sibling",
        venueId: "venue-1",
        zoneId: "zone-b",
      },
    ],
    60
  );

  // Con duracion de 60 (configurada), 20:00 ya no se superpone con 19:00-20:00.
  const withConfiguredDuration = validateMatchSlot({
    courtIndex: 1,
    dayKey: "2026-03-06",
    matchDurationMinutes: 60,
    occupancy,
    participantIds: [],
    startMinutes: 20 * 60,
    venueId: "venue-1",
  });

  assert.equal(withConfiguredDuration.hasConflict, false);

  // La misma ocupacion, pero validando SIN pasar matchDurationMinutes: el
  // partido existente (armado con 60) se registro con endMinutes = 19:00+60,
  // y el candidato usa el default (75) para SU propio rango, asi que
  // 20:00-21:15 si se superpone con el existente (19:00-20:00)... en
  // realidad el existente termina a las 20:00, asi que no se superponen.
  // Probamos en cambio que el candidato por defecto (75) choca si el
  // existente se construyo tambien con 75.
  const occupancyWithDefaultDuration = buildScheduleOccupancy(
    [
      {
        courtIndex: 1,
        dayKey: "2026-03-06",
        matchKey: "1 vs 2",
        participantIds: [],
        startMinutes: 19 * 60,
        tournamentId: "sibling",
        venueId: "venue-1",
        zoneId: "zone-b",
      },
    ],
    DEFAULT_MATCH_DURATION_MINUTES
  );

  const withDefaultDuration = validateMatchSlot({
    courtIndex: 1,
    dayKey: "2026-03-06",
    occupancy: occupancyWithDefaultDuration,
    participantIds: [],
    startMinutes: 20 * 60,
    venueId: "venue-1",
  });

  assert.equal(withDefaultDuration.hasConflict, true);
  assert.equal(withDefaultDuration.conflictReason, "Cancha 1 ocupada por otro partido hasta las 20:15");
});

test("formatMinutesToTime da formato HH:MM", () => {
  assert.equal(formatMinutesToTime(19 * 60 + 5), "19:05");
  assert.equal(formatMinutesToTime(0), "00:00");
});
