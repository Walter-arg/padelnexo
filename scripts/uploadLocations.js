const path = require("path");

const { initializeApp } = require("firebase/app");
const { collection, doc, getFirestore, writeBatch } = require("firebase/firestore");

const locations = require(path.resolve(__dirname, "../data/locations.json"));

const firebaseConfig = {
  apiKey: "AIzaSyD4hHUTo91MlrPSjcX2MgrRYMO28SyGLkc",
  authDomain: "padelnexo-7e4d5.firebaseapp.com",
  projectId: "padelnexo-7e4d5",
  storageBucket: "padelnexo-7e4d5.firebasestorage.app",
  messagingSenderId: "553114005250",
  appId: "1:553114005250:web:da65ffb127b781c1b1dc1b",
};

const BATCH_LIMIT = 500;

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildLocationDocId(location) {
  return `${slugify(location.provincia)}__${slugify(location.nombre)}`;
}

function normalizeLocation(location) {
  return {
    nombre: String(location.nombre || "").trim(),
    provincia: String(location.provincia || "").trim(),
    pais: String(location.pais || "Argentina").trim(),
    search: Array.isArray(location.search)
      ? [...new Set(location.search.map((value) => String(value).trim().toLowerCase()).filter(Boolean))]
      : [],
  };
}

function getValidLocations() {
  return locations
    .map(normalizeLocation)
    .filter((location) => location.nombre && location.provincia && location.pais);
}

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const locationsCollection = collection(db, "locations");
  const validLocations = getValidLocations();

  if (validLocations.length === 0) {
    throw new Error("No hay localidades validas para subir.");
  }

  let uploadedCount = 0;
  let batchNumber = 1;
  let batch = writeBatch(db);
  let operationsInBatch = 0;

  console.log(`[uploadLocations] Iniciando carga de ${validLocations.length} localidades`);

  for (const location of validLocations) {
    const locationRef = doc(locationsCollection, buildLocationDocId(location));

    batch.set(locationRef, {
      nombre: location.nombre,
      provincia: location.provincia,
      pais: location.pais,
      search: location.search,
    });

    operationsInBatch += 1;

    if (operationsInBatch === BATCH_LIMIT) {
      await batch.commit();
      uploadedCount += operationsInBatch;
      console.log(
        `[uploadLocations] Batch ${batchNumber} confirmado. Total subido: ${uploadedCount}/${validLocations.length}`
      );

      batchNumber += 1;
      batch = writeBatch(db);
      operationsInBatch = 0;
    }
  }

  if (operationsInBatch > 0) {
    await batch.commit();
    uploadedCount += operationsInBatch;
    console.log(
      `[uploadLocations] Batch ${batchNumber} confirmado. Total subido: ${uploadedCount}/${validLocations.length}`
    );
  }

  console.log(`[uploadLocations] Carga completada. Localidades subidas: ${uploadedCount}`);
}

main().catch((error) => {
  console.error("[uploadLocations] Error durante la carga:", error);
  process.exit(1);
});
