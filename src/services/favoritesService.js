const DEFAULT_USER_KEY = "guest";

const favoritesByUser = new Map();
const listenersByUser = new Map();

function getUserKey(userId) {
  return userId || DEFAULT_USER_KEY;
}

function ensureUserState(userId) {
  const userKey = getUserKey(userId);

  if (!favoritesByUser.has(userKey)) {
    favoritesByUser.set(userKey, {
      favoriteIds: new Set(),
      playersById: new Map(),
      initialized: false,
    });
  }

  return favoritesByUser.get(userKey);
}

function emit(userId) {
  const userKey = getUserKey(userId);
  const listeners = listenersByUser.get(userKey);

  if (!listeners) {
    return;
  }

  const favoritePlayers = getFavoritePlayers(userId);
  listeners.forEach((listener) => listener(favoritePlayers));
}

export function registerPlayersForFavorites(userId, players = []) {
  const state = ensureUserState(userId);

  players.forEach((player) => {
    if (player?.id) {
      state.playersById.set(player.id, player);
    }
  });

  if (!state.initialized) {
    state.favoriteIds = new Set(
      players.filter((player) => player?.esFavorito && player?.id).map((player) => player.id)
    );
    state.initialized = true;
  }

  return applyFavoriteFlags(userId, players);
}

export function applyFavoriteFlags(userId, players = []) {
  const state = ensureUserState(userId);

  return players.map((player) => ({
    ...player,
    esFavorito: state.favoriteIds.has(player.id),
  }));
}

export function toggleFavoritePlayer(userId, player) {
  if (!player?.id) {
    return false;
  }

  const state = ensureUserState(userId);

  if (state.favoriteIds.has(player.id)) {
    state.favoriteIds.delete(player.id);
  } else {
    state.favoriteIds.add(player.id);
  }

  state.playersById.set(player.id, {
    ...player,
    esFavorito: state.favoriteIds.has(player.id),
  });

  emit(userId);

  return state.favoriteIds.has(player.id);
}

export function getFavoritePlayers(userId) {
  const state = ensureUserState(userId);

  return Array.from(state.favoriteIds)
    .map((playerId) => state.playersById.get(playerId))
    .filter(Boolean)
    .map((player) => ({
      ...player,
      esFavorito: true,
    }));
}

export function subscribeToFavoritePlayers(userId, listener) {
  const userKey = getUserKey(userId);

  if (!listenersByUser.has(userKey)) {
    listenersByUser.set(userKey, new Set());
  }

  const listeners = listenersByUser.get(userKey);
  listeners.add(listener);
  listener(getFavoritePlayers(userId));

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      listenersByUser.delete(userKey);
    }
  };
}
