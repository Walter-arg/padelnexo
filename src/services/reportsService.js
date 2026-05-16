import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";

function resolveTimestampMillis(value) {
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

export async function submitReport({
  reporter = {},
  targetType = "",
  targetId = "",
  targetTitle = "",
  description = "",
  metadata = {},
}) {
  const normalizedTargetType = String(targetType || "").trim();

  if (!reporter?.uid || !normalizedTargetType) {
    throw new Error("No pudimos preparar el reporte.");
  }

  await addDoc(collection(db, "reports"), {
    reporterId: reporter.uid,
    reporterName: reporter.name || reporter.email || "Usuario",
    reporterRole: reporter.role || "user",
    targetType: normalizedTargetType,
    targetId: String(targetId || "").trim(),
    targetTitle: String(targetTitle || "").trim(),
    description: String(description || "").trim(),
    metadata,
    status: "pending",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function listAdminReports() {
  const reportsQuery = query(collection(db, "reports"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(reportsQuery);

  return snapshot.docs.map((docSnapshot) => {
    const data = docSnapshot.data() || {};

    return {
      id: docSnapshot.id,
      ...data,
      createdAtMillis: resolveTimestampMillis(data.createdAt),
      updatedAtMillis: resolveTimestampMillis(data.updatedAt),
    };
  });
}

export async function updateReportStatus(reportId, status = "reviewed") {
  if (!reportId) {
    return;
  }

  await updateDoc(doc(db, "reports", reportId), {
    status,
    updatedAt: serverTimestamp(),
  });
}
