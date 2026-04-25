import AsyncStorage from "@react-native-async-storage/async-storage";

const SECTION_FILTER_PREFERENCES_KEY = "@padelnexo:section-filter-preferences";

export function normalizeFilterLocation(location) {
  if (!location?.nombre) {
    return null;
  }

  return {
    nombre: String(location.nombre || "").trim(),
    provincia: String(location.provincia || "").trim(),
    pais: String(location.pais || "Argentina").trim() || "Argentina",
  };
}

export function areSameFilterLocations(first, second) {
  if (!first || !second) {
    return false;
  }

  return (
    String(first.nombre || "").trim().toLowerCase() ===
      String(second.nombre || "").trim().toLowerCase() &&
    String(first.provincia || "").trim().toLowerCase() ===
      String(second.provincia || "").trim().toLowerCase()
  );
}

export function dedupeFilterLocations(locations = []) {
  return locations.reduce((accumulator, location) => {
    const normalizedLocation = normalizeFilterLocation(location);

    if (!normalizedLocation) {
      return accumulator;
    }

    if (accumulator.some((item) => areSameFilterLocations(item, normalizedLocation))) {
      return accumulator;
    }

    return [...accumulator, normalizedLocation];
  }, []);
}

export function buildGlobalFilterLocations(
  baseLocation,
  extraLocations = [],
  maxLocations = 5,
  options = {}
) {
  const includeBaseLocation = options.includeBaseLocation !== false;
  const normalizedBaseLocation = normalizeFilterLocation(baseLocation);
  const normalizedExtraLocations = dedupeFilterLocations(extraLocations).filter(
    (location) => !areSameFilterLocations(location, normalizedBaseLocation)
  );
  const mergedLocations = includeBaseLocation && normalizedBaseLocation
    ? [normalizedBaseLocation, ...normalizedExtraLocations]
    : normalizedExtraLocations;

  return mergedLocations.slice(0, maxLocations);
}

export async function loadSectionFilterPreferences() {
  try {
    const rawValue = await AsyncStorage.getItem(SECTION_FILTER_PREFERENCES_KEY);

    if (!rawValue) {
      return {
        includeBaseLocation: true,
        rememberByDefault: false,
        extraLocations: [],
      };
    }

    const parsedValue = JSON.parse(rawValue);

    return {
      includeBaseLocation:
        parsedValue?.includeBaseLocation === undefined
          ? true
          : Boolean(parsedValue?.includeBaseLocation),
      rememberByDefault: Boolean(parsedValue?.rememberByDefault),
      extraLocations: dedupeFilterLocations(parsedValue?.extraLocations || []),
    };
  } catch (error) {
    return {
      includeBaseLocation: true,
      rememberByDefault: false,
      extraLocations: [],
    };
  }
}

export async function saveSectionFilterPreferences({
  includeBaseLocation = true,
  rememberByDefault = false,
  extraLocations = [],
}) {
  if (!rememberByDefault) {
    await AsyncStorage.removeItem(SECTION_FILTER_PREFERENCES_KEY);
    return;
  }

  await AsyncStorage.setItem(
    SECTION_FILTER_PREFERENCES_KEY,
    JSON.stringify({
      includeBaseLocation: Boolean(includeBaseLocation),
      rememberByDefault: true,
      extraLocations: dedupeFilterLocations(extraLocations),
    })
  );
}

