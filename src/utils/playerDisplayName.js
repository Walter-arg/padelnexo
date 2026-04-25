export function formatPlayerShortName(player = {}) {
  const firstName = String(player.nombre || player.name || "").trim();
  const lastName = String(player.apellido || player.lastName || "").trim();

  if (lastName && firstName) {
    return `${lastName} ${firstName.charAt(0).toUpperCase()}.`;
  }

  const nameParts = firstName.split(/\s+/).filter(Boolean);

  if (nameParts.length >= 2) {
    const inferredLastName = nameParts[nameParts.length - 1];
    const inferredFirstInitial = nameParts[0].charAt(0).toUpperCase();

    return `${inferredLastName} ${inferredFirstInitial}.`;
  }

  return firstName || "Jugador";
}

export function formatTeamShortLabel(players = [], fallback = "Pareja") {
  const label = players.map(formatPlayerShortName).filter(Boolean).join(" / ");

  return label || fallback;
}

