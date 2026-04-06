import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { db } from "../../services/firebaseConfig";

function buildFavoriteId(userId, leagueId) {
  return `${userId}_${leagueId}`;
}

export function applyLeagueFavoriteFlags(leagues = [], favoriteIds = new Set()) {
  return leagues.map((league) => ({
    ...league,
    esMiLiga: favoriteIds.has(league.id),
  }));
}

export async function toggleLeagueFavorite(userId, league) {
  if (!userId || !league?.id) {
    throw new Error("No pudimos actualizar esta liga.");
  }

  const favoriteRef = doc(db, "leagueFavorites", buildFavoriteId(userId, league.id));

  if (league.esMiLiga) {
    await deleteDoc(favoriteRef);
    return false;
  }

  await setDoc(favoriteRef, {
    userId,
    leagueId: league.id,
    leagueName: league.nombre || "",
    createdAt: serverTimestamp(),
  });

  return true;
}

export function subscribeToFavoriteLeagueIds({ currentUserId, onData, onError }) {
  if (!currentUserId) {
    onData?.(new Set());
    return () => {};
  }

  const favoritesQuery = query(
    collection(db, "leagueFavorites"),
    where("userId", "==", currentUserId)
  );

  return onSnapshot(
    favoritesQuery,
    (snapshot) => {
      const favoriteIds = new Set(
        snapshot.docs.map((docSnapshot) => docSnapshot.data()?.leagueId).filter(Boolean)
      );
      onData?.(favoriteIds);
    },
    (error) => {
      console.log("[leagueFavoritesService] Error al leer mis ligas:", error);
      onError?.(error);
    }
  );
}
