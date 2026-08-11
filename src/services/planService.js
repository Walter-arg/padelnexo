import { collection, getDocs, query, where } from "../../services/firebaseFirestore";
import { doc, getDoc } from "../../services/firebaseFirestore";
import { db } from "../../services/firebaseConfig";

const PLAN_LIMITS = {
  simple: { maxLigasMes: 3, maxTorneosMes: 2, turnosAccess: false, webAccess: false },
  plus: { maxLigasMes: 6, maxTorneosMes: 4, turnosAccess: true, webAccess: true },
  premium: { maxLigasMes: -1, maxTorneosMes: -1, turnosAccess: true, webAccess: true },
};

export function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || null;
}

export function getPlanLabel(plan) {
  const labels = { simple: "Nexo Simple", plus: "Nexo Plus", premium: "Nexo Premium" };
  return labels[plan] || "Sin plan";
}

export async function getUserPlanInfo(userId) {
  if (!userId) return { plan: null, planStatus: "none", isExpired: false };
  try {
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()) return { plan: null, planStatus: "none", isExpired: false };
    const data = snap.data() || {};
    const plan = data.plan || null;
    const planStatus = data.planStatus || "none";
    const trialEndDate = typeof data.trialEndDate === "number" ? data.trialEndDate : 0;
    const planExpiresAt = typeof data.planExpiresAt === "number" ? data.planExpiresAt : 0;
    // planExpiresAt vale tanto para trial como para plan pago (mensual/anual).
    // La funcion programada checkPlanExpirations ya pasa planStatus a
    // "expired" cuando vence, pero este chequeo evita una ventana de acceso
    // si todavia no corrio esa funcion (corre una vez por dia).
    const isExpired =
      (planStatus === "trial" || planStatus === "active") &&
      planExpiresAt > 0 &&
      Date.now() > planExpiresAt;
    const effectivePlan = isExpired ? null : plan;
    const effectiveStatus = isExpired ? "expired" : planStatus;
    return { plan: effectivePlan, planStatus: effectiveStatus, isExpired, trialEndDate, planExpiresAt };
  } catch {
    return { plan: null, planStatus: "none", isExpired: false };
  }
}

function getStartOfMonthMillis() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export async function checkCanCreateLeague(organizerId) {
  const { plan, planStatus } = await getUserPlanInfo(organizerId);
  if (!plan || planStatus === "expired" || planStatus === "none") {
    return { allowed: false, reason: "Sin plan activo" };
  }
  const limits = getPlanLimits(plan);
  if (!limits) return { allowed: false, reason: "Plan no reconocido" };
  if (limits.maxLigasMes === -1) return { allowed: true };
  try {
    const startOfMonth = getStartOfMonthMillis();
    const snap = await getDocs(
      query(
        collection(db, "leagues"),
        where("organizerId", "==", organizerId),
        where("createdAtMillis", ">=", startOfMonth)
      )
    );
    const count = snap.size;
    if (count >= limits.maxLigasMes) {
      return { allowed: false, reason: `Alcanzaste el límite de ${limits.maxLigasMes} liga${limits.maxLigasMes !== 1 ? "s" : ""} por mes para tu plan`, current: count, max: limits.maxLigasMes };
    }
    return { allowed: true, current: count, max: limits.maxLigasMes };
  } catch {
    return { allowed: true };
  }
}

export async function checkCanCreateTournament(organizerId) {
  const { plan, planStatus } = await getUserPlanInfo(organizerId);
  if (!plan || planStatus === "expired" || planStatus === "none") {
    return { allowed: false, reason: "Sin plan activo" };
  }
  const limits = getPlanLimits(plan);
  if (!limits) return { allowed: false, reason: "Plan no reconocido" };
  if (limits.maxTorneosMes === -1) return { allowed: true };
  try {
    const startOfMonth = getStartOfMonthMillis();
    const snap = await getDocs(
      query(
        collection(db, "tournaments"),
        where("organizerId", "==", organizerId),
        where("createdAtMillis", ">=", startOfMonth)
      )
    );
    const count = snap.size;
    if (count >= limits.maxTorneosMes) {
      return { allowed: false, reason: `Alcanzaste el límite de ${limits.maxTorneosMes} torneo${limits.maxTorneosMes !== 1 ? "s" : ""} por mes para tu plan`, current: count, max: limits.maxTorneosMes };
    }
    return { allowed: true, current: count, max: limits.maxTorneosMes };
  } catch {
    return { allowed: true };
  }
}

export async function checkTurnosAccess(organizerId) {
  const { plan, planStatus } = await getUserPlanInfo(organizerId);
  if (!plan || planStatus === "expired" || planStatus === "none") return false;
  return getPlanLimits(plan)?.turnosAccess ?? false;
}
