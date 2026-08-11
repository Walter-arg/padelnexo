export const USER_ROLE = "user";
export const ORGANIZER_ROLE = "organizer";
export const ADMIN_ROLE = "admin";

export const ORGANIZER_STATUS = {
  NONE: "none",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export function getDefaultRoleData(wantsOrganizer = false) {
  if (wantsOrganizer) {
    return {
      role: ORGANIZER_ROLE,
      organizerStatus: ORGANIZER_STATUS.PENDING,
    };
  }

  return {
    role: USER_ROLE,
    organizerStatus: ORGANIZER_STATUS.NONE,
  };
}

export function isApprovedOrganizer(profile) {
  return (
    profile?.role === ORGANIZER_ROLE &&
    profile?.organizerStatus === ORGANIZER_STATUS.APPROVED
  );
}

export function isAdminProfile(profile) {
  return profile?.role === ADMIN_ROLE || profile?.adminStatus === "active";
}

export function isPendingOrganizer(profile) {
  return (
    profile?.role === ORGANIZER_ROLE &&
    profile?.organizerStatus === ORGANIZER_STATUS.PENDING
  );
}

export function isRejectedOrganizer(profile) {
  return profile?.organizerStatus === ORGANIZER_STATUS.REJECTED;
}

// El plan de organizador tiene vencimiento (trial o pago, mensual/anual).
// planExpiresAt es la fecha en milisegundos; checkPlanExpirations (Cloud
// Function programada) ya pasa planStatus a "expired" cuando vence, pero
// este chequeo evita una ventana de acceso si todavia no corrio esa funcion.
export function hasActivePlan(profile) {
  if (!profile?.plan) {
    return false;
  }

  if (profile.planStatus === "expired" || profile.planStatus === "none") {
    return false;
  }

  if (profile.planExpiresAt && Date.now() > profile.planExpiresAt) {
    return false;
  }

  return true;
}

export function getOrganizerRestrictionMessage(profile) {
  if (isPendingOrganizer(profile)) {
    return "Tu solicitud esta en revision";
  }

  if (isRejectedOrganizer(profile)) {
    return "Acceso organizador rechazado.";
  }

  if (isApprovedOrganizer(profile) && !hasActivePlan(profile)) {
    return "Tu plan de organizador vencio. Renoválo para seguir creando ligas, torneos y turnos.";
  }

  return "Esta funcion esta disponible solo para organizadores aprobados.";
}

export function getAccountTypeLabel(profile) {
  if (isAdminProfile(profile)) {
    return "Administrador";
  }

  if (isRejectedOrganizer(profile)) {
    return "Jugador";
  }

  if (profile?.role !== ORGANIZER_ROLE) {
    return "Jugador";
  }

  if (profile?.organizerStatus === ORGANIZER_STATUS.APPROVED) {
    return "Organizador";
  }

  return "Organizador (Pendiente)";
}

