import * as Location from "expo-location";

function normalizeCoordinate(value) {
  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

export function getCoordinatesFromObject(source = {}) {
  const coordinates =
    source.coordinates ||
    source.coords ||
    source.location ||
    source.ubicacion ||
    source.geo ||
    {};
  const latitude = normalizeCoordinate(
    source.latitude ?? source.lat ?? source.latitud ?? coordinates.latitude ?? coordinates.lat
  );
  const longitude = normalizeCoordinate(
    source.longitude ??
      source.lng ??
      source.lon ??
      source.longitud ??
      coordinates.longitude ??
      coordinates.lng ??
      coordinates.lon
  );

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

export function calculateDistanceKm(origin = {}, destination = {}) {
  const originLatitude = normalizeCoordinate(origin.latitude);
  const originLongitude = normalizeCoordinate(origin.longitude);
  const destinationLatitude = normalizeCoordinate(destination.latitude);
  const destinationLongitude = normalizeCoordinate(destination.longitude);

  if (
    originLatitude === null ||
    originLongitude === null ||
    destinationLatitude === null ||
    destinationLongitude === null
  ) {
    return null;
  }

  const earthRadiusKm = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDistance = toRadians(destinationLatitude - originLatitude);
  const longitudeDistance = toRadians(destinationLongitude - originLongitude);
  const firstLatitude = toRadians(originLatitude);
  const secondLatitude = toRadians(destinationLatitude);
  const haversine =
    Math.sin(latitudeDistance / 2) * Math.sin(latitudeDistance / 2) +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDistance / 2) *
      Math.sin(longitudeDistance / 2);
  const angularDistance = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return earthRadiusKm * angularDistance;
}

export async function requestCurrentLocation() {
  let permission = null;

  try {
    permission = await Location.requestForegroundPermissionsAsync();
  } catch (error) {
    throw new Error("No pudimos solicitar el permiso de ubicacion. Intenta nuevamente.");
  }

  if (permission.status !== "granted") {
    throw new Error("Necesitamos permiso de ubicacion para buscar por cercania.");
  }

  let location = null;

  try {
    location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch (error) {
    throw new Error(
      "No pudimos detectar tu ubicacion actual. Revisa que el GPS este activo o intenta desde una zona con mejor senal."
    );
  }

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

export async function geocodeAddress(address = "") {
  const normalizedAddress = String(address || "").trim();

  if (!normalizedAddress) {
    return null;
  }

  const results = await Location.geocodeAsync(normalizedAddress);
  const firstResult = results?.[0];

  if (!firstResult) {
    return null;
  }

  return {
    latitude: firstResult.latitude,
    longitude: firstResult.longitude,
  };
}
