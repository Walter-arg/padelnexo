const fs = require("fs/promises");
const path = require("path");

const SOURCE_URLS = [
  "https://raw.githubusercontent.com/datasets-ar/argentina-localidades/master/data/localidades.csv",
  "https://infra.datos.gob.ar/catalog/modernizacion/dataset/7/distribution/7.10/download/localidades.csv",
];

const OUTPUT_PATH = path.resolve(__dirname, "../data/locations.json");
const MIN_LOCATIONS = 2000;

async function fetchCsv() {
  for (const url of SOURCE_URLS) {
    try {
      console.log(`[generateLocations] Descargando dataset desde ${url}`);
      const response = await fetch(url);

      if (!response.ok) {
        console.log(
          `[generateLocations] Fuente no disponible (${response.status}) para ${url}`
        );
        continue;
      }

      return response.text();
    } catch (error) {
      console.log(`[generateLocations] Error descargando ${url}:`, error.message);
    }
  }

  throw new Error("No pudimos descargar un dataset valido de localidades.");
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === "," && !insideQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function parseCsv(csv) {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error("El CSV no tiene suficientes filas para procesar.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);

    return headers.reduce((record, header, index) => {
      record[header] = (values[index] || "").trim();
      return record;
    }, {});
  });
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function toDisplayCase(value) {
  const lowerCased = normalizeWhitespace(value).toLocaleLowerCase("es-AR");

  return lowerCased.replace(
    /(^|[\s'/-])([a-záéíóúüñ])/g,
    (match, separator, letter) => `${separator}${letter.toLocaleUpperCase("es-AR")}`
  );
}

function buildSearchPrefixes(name) {
  const normalized = normalizeWhitespace(name).toLocaleLowerCase("es-AR");
  const prefixes = new Set();

  for (let index = 1; index <= normalized.length; index += 1) {
    prefixes.add(normalized.slice(0, index));
  }

  return [...prefixes];
}

function transformRecords(records) {
  const uniqueLocations = new Map();

  for (const record of records) {
    const rawName = normalizeWhitespace(record.nombre || "");
    const rawProvince = normalizeWhitespace(record.provincia_nombre || "");

    if (!rawName || !rawProvince) {
      continue;
    }

    const nombre = toDisplayCase(rawName);
    const provincia = toDisplayCase(rawProvince);
    const uniqueKey = `${nombre.toLocaleLowerCase("es-AR")}::${provincia.toLocaleLowerCase(
      "es-AR"
    )}`;

    if (uniqueLocations.has(uniqueKey)) {
      continue;
    }

    uniqueLocations.set(uniqueKey, {
      nombre,
      provincia,
      pais: "Argentina",
      search: buildSearchPrefixes(nombre),
    });
  }

  return [...uniqueLocations.values()].sort((left, right) => {
    const provinceComparison = left.provincia.localeCompare(right.provincia, "es-AR");

    if (provinceComparison !== 0) {
      return provinceComparison;
    }

    return left.nombre.localeCompare(right.nombre, "es-AR");
  });
}

async function ensureOutputDirectory() {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
}

async function main() {
  const csv = await fetchCsv();
  const records = parseCsv(csv);
  const locations = transformRecords(records);

  if (locations.length < MIN_LOCATIONS) {
    throw new Error(
      `Se generaron ${locations.length} localidades, menos de las ${MIN_LOCATIONS} requeridas.`
    );
  }

  await ensureOutputDirectory();
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(locations, null, 2)}\n`, "utf8");

  console.log(
    `[generateLocations] Archivo generado en ${OUTPUT_PATH} con ${locations.length} localidades`
  );
}

main().catch((error) => {
  console.error("[generateLocations] Error:", error);
  process.exit(1);
});
