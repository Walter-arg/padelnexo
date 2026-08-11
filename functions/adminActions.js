const { onRequest } = require("firebase-functions/v2/https");

const { admin, getDb, withAdminHandler } = require("./adminShared");

const USER_ROLE = "user";
const ADMIN_ROLE = "admin";
const ORGANIZER_ROLE = "organizer";
const ORGANIZER_STATUS = {
  NONE: "none",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function requireUserId(req) {
  const userId = String(req.body?.userId || "").trim();

  if (!userId) {
    const error = new Error("userId_required");
    error.statusCode = 400;
    throw error;
  }

  return userId;
}

const grantAdminAccess = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);

    await getDb().collection("users").doc(userId).update({
      adminStatus: "active",
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const revokeAdminAccess = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const currentRole = String(req.body?.currentRole || "");
    const payload = {
      adminStatus: "revoked",
      updatedAt: serverTimestamp(),
    };

    if (currentRole === ADMIN_ROLE) {
      payload.role = USER_ROLE;
    }

    await getDb().collection("users").doc(userId).update(payload);

    res.status(200).json({ ok: true });
  })
);

const revokeOrganizerAccess = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);

    await getDb().collection("users").doc(userId).update({
      role: USER_ROLE,
      organizerStatus: ORGANIZER_STATUS.REJECTED,
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const blockUserAccount = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const mode = String(req.body?.mode || "indefinite");
    const userRef = getDb().collection("users").doc(userId);
    const snapshot = await userRef.get();
    const currentProfile = snapshot.exists ? snapshot.data() || {} : {};

    const isTemporary = mode === "temporary_7_days";
    const blockedUntilMillis = isTemporary ? Date.now() + 1000 * 60 * 60 * 24 * 7 : 0;
    const payload = {
      adminStatus: "revoked",
      accountDeleted: false,
      blockStatus: isTemporary ? "temporary" : "indefinite",
      blockedAt: serverTimestamp(),
      blockedUntilMillis,
      blockReason: isTemporary
        ? "Bloqueo temporal por acciones impropias"
        : "Bloqueo indefinido por acciones impropias",
      preBlockRole:
        currentProfile.role && currentProfile.role !== "blocked" ? currentProfile.role : USER_ROLE,
      preBlockOrganizerStatus: currentProfile.organizerStatus || ORGANIZER_STATUS.NONE,
      updatedAt: serverTimestamp(),
    };

    if (!isTemporary) {
      payload.role = "blocked";
    }

    await userRef.update(payload);

    res.status(200).json({ ok: true });
  })
);

const restoreUserAccount = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const userRef = getDb().collection("users").doc(userId);
    const snapshot = await userRef.get();
    const data = snapshot.exists ? snapshot.data() || {} : {};

    await userRef.update({
      accountDeleted: false,
      blockStatus: "none",
      blockedUntilMillis: 0,
      blockReason: "",
      preBlockRole: "",
      preBlockOrganizerStatus: "",
      role: data.preBlockRole || (data.role === "blocked" ? USER_ROLE : data.role || USER_ROLE),
      organizerStatus:
        data.preBlockOrganizerStatus || data.organizerStatus || ORGANIZER_STATUS.NONE,
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

// Borrado real de una cuenta por un admin: Auth + Firestore (perfil, datos
// privados, solicitud de organizador) + foto de perfil en Storage. Ademas
// agrega el email a blockedEmails para que no pueda volver a registrarse.
// A diferencia del bloqueo (blockUserAccount), esto es irreversible.
const deleteUserAccount = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const reason = String(req.body?.reason || "").trim();
    const db = getDb();
    const userRef = db.collection("users").doc(userId);
    const privateRef = userRef.collection("private").doc("contact");
    const organizerRequestRef = db.collection("organizerRequests").doc(userId);

    const privateSnapshot = await privateRef.get();
    const email = String(privateSnapshot.exists ? privateSnapshot.data()?.email || "" : "")
      .trim()
      .toLowerCase();

    if (email) {
      await db.collection("blockedEmails").doc(email).set({
        email,
        reason: reason || "Cuenta eliminada por un administrador",
        blockedAt: serverTimestamp(),
      });
    }

    try {
      await admin.storage().bucket().file(`profileImages/${userId}`).delete();
    } catch (error) {
      // La foto puede no existir, seguimos igual con el resto del borrado.
    }

    try {
      await admin.auth().deleteUser(userId);
    } catch (error) {
      // Si la cuenta de Auth ya no existe (o algo falla), igual limpiamos Firestore.
    }

    const batch = db.batch();

    batch.delete(privateRef);
    batch.delete(organizerRequestRef);
    batch.delete(userRef);

    await batch.commit();

    res.status(200).json({ ok: true });
  })
);

const assignOrganizerPlan = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const plan = String(req.body?.plan || "").trim();
    const trialDays = Number(req.body?.trialDays || 0);

    if (!plan) {
      res.status(400).json({ error: "plan_required" });
      return;
    }

    const isTrial = trialDays > 0;
    const payload = {
      plan,
      planStatus: isTrial ? "trial" : "active",
      planUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (isTrial) {
      payload.trialEndDate = Date.now() + trialDays * 24 * 60 * 60 * 1000;
      payload.planActivatedDate = null;
    } else {
      payload.planActivatedDate = serverTimestamp();
      payload.trialEndDate = null;
    }

    await getDb().collection("users").doc(userId).update(payload);

    res.status(200).json({ ok: true });
  })
);

const revokeOrganizerPlan = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);

    await getDb().collection("users").doc(userId).update({
      plan: null,
      planStatus: "none",
      trialEndDate: null,
      planActivatedDate: null,
      planUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const updateUserProfileAsAdmin = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const updates = req.body?.updates || {};
    const city = String(updates.city || "").trim();
    const province = String(updates.province || "").trim();
    const country = String(updates.country || "Argentina").trim() || "Argentina";

    await getDb()
      .collection("users")
      .doc(userId)
      .update({
        nombre: String(updates.name || "").trim(),
        telefono: String(updates.phone || "").trim(),
        categoria: String(updates.category || "").trim(),
        sexo: String(updates.sex || "").trim(),
        ladoJuego: String(updates.side || "").trim(),
        manoHabil: String(updates.hand || "").trim(),
        descripcion: String(updates.description || "").trim(),
        localidad: { nombre: city, provincia: province, pais: country },
        location: { ciudad: city, provincia: province, pais: country },
        updatedAt: serverTimestamp(),
      });

    res.status(200).json({ ok: true });
  })
);

const archiveLeagueAsAdmin = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const leagueId = String(req.body?.leagueId || "").trim();

    if (!leagueId) {
      res.status(400).json({ error: "leagueId_required" });
      return;
    }

    await getDb().collection("leagues").doc(leagueId).update({
      status: "archived",
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const restoreLeagueAsAdmin = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const leagueId = String(req.body?.leagueId || "").trim();

    if (!leagueId) {
      res.status(400).json({ error: "leagueId_required" });
      return;
    }

    await getDb().collection("leagues").doc(leagueId).update({
      status: "active",
      restoredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const cancelTournamentAsAdmin = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const tournamentId = String(req.body?.tournamentId || "").trim();

    if (!tournamentId) {
      res.status(400).json({ error: "tournamentId_required" });
      return;
    }

    await getDb().collection("tournaments").doc(tournamentId).update({
      status: "cancelled",
      registrationStatus: "closed",
      cancellationReason: "Accion administrativa",
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const restoreTournamentAsAdmin = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const tournamentId = String(req.body?.tournamentId || "").trim();

    if (!tournamentId) {
      res.status(400).json({ error: "tournamentId_required" });
      return;
    }

    await getDb().collection("tournaments").doc(tournamentId).update({
      status: "published",
      restoredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    res.status(200).json({ ok: true });
  })
);

const approveOrganizerRequest = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const db = getDb();
    const requestRef = db.collection("organizerRequests").doc(userId);
    const userRef = db.collection("users").doc(userId);
    const requestSnapshot = await requestRef.get();

    if (!requestSnapshot.exists) {
      res.status(404).json({ error: "request_not_found" });
      return;
    }

    const requestData = requestSnapshot.data() || {};
    const complejos = Array.isArray(requestData.complejos) ? requestData.complejos : [];
    const batch = db.batch();

    batch.update(userRef, {
      organizerStatus: ORGANIZER_STATUS.APPROVED,
      role: ORGANIZER_ROLE,
      complejos,
    });
    batch.update(requestRef, { status: ORGANIZER_STATUS.APPROVED });

    await batch.commit();

    res.status(200).json({ ok: true });
  })
);

const rejectOrganizerRequest = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const db = getDb();
    const requestRef = db.collection("organizerRequests").doc(userId);
    const userRef = db.collection("users").doc(userId);
    const batch = db.batch();

    batch.update(requestRef, { status: ORGANIZER_STATUS.REJECTED });
    batch.update(userRef, {
      role: USER_ROLE,
      organizerStatus: ORGANIZER_STATUS.REJECTED,
      complejos: [],
    });

    await batch.commit();

    res.status(200).json({ ok: true });
  })
);

const deleteOrganizerRequest = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const userId = requireUserId(req);
    const db = getDb();
    const requestRef = db.collection("organizerRequests").doc(userId);
    const userRef = db.collection("users").doc(userId);
    const batch = db.batch();

    batch.delete(requestRef);
    batch.update(userRef, {
      role: USER_ROLE,
      organizerStatus: ORGANIZER_STATUS.NONE,
      complejos: [],
    });

    await batch.commit();

    res.status(200).json({ ok: true });
  })
);

function resolveTimestampMillis(value) {
  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

// El email y el telefono real de cada usuario viven en users/{uid}/private/contact
// (solo legible por el propio dueño), asi que el panel de admin los pide via
// esta funcion en vez de leer Firestore directo desde el cliente.
const listAdminUsersData = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const db = getDb();
    const usersSnapshot = await db.collection("users").get();

    const users = await Promise.all(
      usersSnapshot.docs.map(async (docSnapshot) => {
        const data = docSnapshot.data() || {};
        const privateSnapshot = await docSnapshot.ref.collection("private").doc("contact").get();
        const privateData = privateSnapshot.exists ? privateSnapshot.data() || {} : {};
        const localidad = data.localidad || {};
        const location = data.location || {};

        return {
          id: docSnapshot.id,
          uid: docSnapshot.id,
          name: data.nombre || data.name || "Usuario",
          email: privateData.email || "",
          phone: privateData.telefono || data.telefono || "",
          avatarUrl: data.fotoURL || data.avatarUrl || "",
          avatarColor: data.avatarColor || "#0F8B5F",
          organizerLogoUrl: data.organizerLogoURL || data.organizerLogoUrl || "",
          category: data.categoria || data.category || "",
          sex: data.sexo || data.sex || "",
          side: data.ladoJuego || data.side || "",
          hand: data.manoHabil || data.hand || "",
          description: data.descripcion || data.description || "",
          city: localidad.nombre || location.ciudad || data.city || "",
          province: localidad.provincia || location.provincia || data.province || "",
          country: localidad.pais || location.pais || data.country || "Argentina",
          role: data.role || USER_ROLE,
          organizerStatus: data.organizerStatus || ORGANIZER_STATUS.NONE,
          adminStatus: data.adminStatus || "none",
          plan: data.plan || null,
          planStatus: data.planStatus || "none",
          trialEndDate: typeof data.trialEndDate === "number" ? data.trialEndDate : 0,
          planActivatedDateMillis: resolveTimestampMillis(data.planActivatedDate),
          accountDeleted: Boolean(data.accountDeleted),
          blockStatus: data.blockStatus || "none",
          blockedAtMillis: resolveTimestampMillis(data.blockedAt),
          blockedUntilMillis: Number(data.blockedUntilMillis || 0),
          blockReason: data.blockReason || "",
          createdAtMillis: resolveTimestampMillis(data.createdAt),
          lastLoginAtMillis: resolveTimestampMillis(data.lastLoginAt),
          updatedAtMillis: resolveTimestampMillis(data.updatedAt),
        };
      })
    );

    res.status(200).json({ users });
  })
);

const approveComplexRequest = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const requestId = String(req.body?.requestId || "").trim();

    if (!requestId) {
      res.status(400).json({ error: "requestId_required" });
      return;
    }

    const db = getDb();
    const requestRef = db.collection("complexRequests").doc(requestId);
    const requestSnapshot = await requestRef.get();

    if (!requestSnapshot.exists) {
      res.status(404).json({ error: "request_not_found" });
      return;
    }

    const requestData = requestSnapshot.data() || {};
    const userId = String(requestData.userId || "").trim();

    if (!userId) {
      res.status(400).json({ error: "request_missing_user" });
      return;
    }

    const userRef = db.collection("users").doc(userId);
    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }

    const currentComplexes = Array.isArray(userSnapshot.data()?.complejos)
      ? userSnapshot.data().complejos
      : [];
    const requestedComplexes = Array.isArray(requestData.complejos) ? requestData.complejos : [];
    const mergedComplexes = [...currentComplexes];

    requestedComplexes.forEach((complex) => {
      const alreadyExists = mergedComplexes.some(
        (item) =>
          String(item?.nombre || "").trim().toLowerCase() ===
            String(complex?.nombre || "").trim().toLowerCase() &&
          String(item?.direccion || "").trim().toLowerCase() ===
            String(complex?.direccion || "").trim().toLowerCase()
      );

      if (!alreadyExists) {
        mergedComplexes.push(complex);
      }
    });

    const batch = db.batch();

    batch.update(userRef, { complejos: mergedComplexes });
    batch.update(requestRef, {
      status: ORGANIZER_STATUS.APPROVED,
      approvedAt: serverTimestamp(),
    });

    await batch.commit();

    res.status(200).json({ ok: true });
  })
);

const deleteComplexRequestAsAdmin = onRequest(
  { invoker: "public" },
  withAdminHandler(async (req, res) => {
    const requestId = String(req.body?.requestId || "").trim();

    if (!requestId) {
      res.status(400).json({ error: "requestId_required" });
      return;
    }

    await getDb().collection("complexRequests").doc(requestId).delete();

    res.status(200).json({ ok: true });
  })
);

module.exports = {
  grantAdminAccess,
  revokeAdminAccess,
  revokeOrganizerAccess,
  blockUserAccount,
  restoreUserAccount,
  deleteUserAccount,
  assignOrganizerPlan,
  revokeOrganizerPlan,
  updateUserProfileAsAdmin,
  archiveLeagueAsAdmin,
  restoreLeagueAsAdmin,
  cancelTournamentAsAdmin,
  restoreTournamentAsAdmin,
  approveOrganizerRequest,
  rejectOrganizerRequest,
  deleteOrganizerRequest,
  approveComplexRequest,
  deleteComplexRequestAsAdmin,
  listAdminUsersData,
};
