import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { getUserPushTokens, sendExpoPushNotificationAsync } from "./pushNotificationsService";

function normalizeDate(value) {
  if (value?.toDate) {
    return value.toDate();
  }

  if (value?.seconds) {
    return new Date(value.seconds * 1000);
  }

  return value instanceof Date ? value : new Date(0);
}

export async function createInvitation({
  senderId,
  senderName,
  recipientId,
  recipientName,
  title = "Invitacion a partido",
  subtitle = "",
  type = "match",
  metadata = {},
}) {
  if (!senderId || !recipientId || senderId === recipientId) {
    return;
  }

  const notificationBody = subtitle || `${senderName || "Jugador"} te invito a coordinar un partido.`;

  await addDoc(collection(db, "invitations"), {
    senderId,
    senderName: senderName || "Jugador",
    recipientId,
    recipientName: recipientName || "Jugador",
    title,
    subtitle: notificationBody,
    type,
    metadata,
    responseStatus: "pending",
    viewed: false,
    createdAt: serverTimestamp(),
  });

  getUserPushTokens(recipientId)
    .then((tokens) =>
      sendExpoPushNotificationAsync({
        tokens,
        title,
        body: notificationBody,
        data: { type, ...metadata },
      })
    )
    .catch(() => null);
}

export async function listUserInvitations(currentUserId) {
  if (!currentUserId) {
    return [];
  }

  const invitationsQuery = query(
    collection(db, "invitations"),
    where("recipientId", "==", currentUserId)
  );
  const snapshot = await getDocs(invitationsQuery);

  return snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() || {};

      return {
        id: docSnapshot.id,
        title: data.title || "Invitacion",
        subtitle: data.subtitle || "Tienes una nueva invitacion.",
        metadata: data.metadata || {},
        responseStatus: data.responseStatus || "pending",
        senderId: data.senderId || "",
        senderName: data.senderName || "Jugador",
        type: data.type || "match",
        viewed: Boolean(data.viewed),
        createdAt: normalizeDate(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribeToUserInvitations({ currentUserId, onData, onError }) {
  if (!currentUserId) {
    onData([]);
    return () => {};
  }

  const invitationsQuery = query(
    collection(db, "invitations"),
    where("recipientId", "==", currentUserId)
  );

  return onSnapshot(
    invitationsQuery,
    (snapshot) => {
      const invitations = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {};

          return {
            id: docSnapshot.id,
            title: data.title || "Invitacion",
            subtitle: data.subtitle || "Tienes una nueva invitacion.",
            metadata: data.metadata || {},
            responseStatus: data.responseStatus || "pending",
            senderId: data.senderId || "",
            senderName: data.senderName || "Jugador",
            type: data.type || "match",
            viewed: Boolean(data.viewed),
            createdAt: normalizeDate(data.createdAt),
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);

      onData(invitations);
    },
    onError
  );
}

export async function respondToInvitation(invitation = {}, accepted = false) {
  if (!invitation?.id) {
    return;
  }

  const responseStatus = accepted ? "accepted" : "rejected";

  await updateDoc(doc(db, "invitations", invitation.id), {
    responseStatus,
    viewed: true,
    respondedAt: serverTimestamp(),
  });

  if (invitation.type === "league_pair_invitation" && invitation.metadata?.requestId) {
    const requestRef = doc(db, "leagueRegistrationRequests", invitation.metadata.requestId);

    await updateDoc(requestRef, {
      status: accepted ? "pending" : "partner_rejected",
      updatedAt: serverTimestamp(),
    });

    if (accepted) {
      getDoc(requestRef)
        .then((requestSnapshot) => {
          const requestData = requestSnapshot.data();

          if (!requestData?.organizerId) {
            return null;
          }

          const requesterName = [requestData.requester?.nombre, requestData.requester?.apellido]
            .filter(Boolean)
            .join(" ");
          const partnerName = [requestData.partner?.nombre, requestData.partner?.apellido]
            .filter(Boolean)
            .join(" ");

          return getUserPushTokens(requestData.organizerId).then((tokens) =>
            sendExpoPushNotificationAsync({
              tokens,
              title: "Nueva solicitud de inscripcion",
              body: `${requesterName || "Un jugador"} y ${partnerName || "su pareja"} quieren inscribirse en ${
                requestData.leagueName || "tu liga"
              }.`,
              data: { type: "league_registration_request", leagueId: requestData.leagueId },
            })
          );
        })
        .catch(() => null);
    }
  }
}

export async function markInvitationsAsViewed(currentUserId) {
  if (!currentUserId) {
    return;
  }

  const invitationsQuery = query(
    collection(db, "invitations"),
    where("recipientId", "==", currentUserId),
    where("viewed", "==", false)
  );
  const snapshot = await getDocs(invitationsQuery);

  await Promise.all(
    snapshot.docs.map((docSnapshot) =>
      updateDoc(docSnapshot.ref, {
        viewed: true,
      })
    )
  );
}

export async function getUnreadInvitationsCount(currentUserId) {
  if (!currentUserId) {
    return 0;
  }

  const invitationsQuery = query(
    collection(db, "invitations"),
    where("recipientId", "==", currentUserId),
    where("viewed", "==", false)
  );
  const snapshot = await getDocs(invitationsQuery);

  return snapshot.size;
}

export function subscribeToUnreadInvitationsCount({ currentUserId, onData, onError }) {
  if (!currentUserId) {
    onData(0);
    return () => {};
  }

  const invitationsQuery = query(
    collection(db, "invitations"),
    where("recipientId", "==", currentUserId)
  );

  return onSnapshot(
    invitationsQuery,
    (snapshot) => {
      const unreadCount = snapshot.docs.filter(
        (docSnapshot) => !Boolean(docSnapshot.data()?.viewed)
      ).length;

      onData(unreadCount);
    },
    onError
  );
}

