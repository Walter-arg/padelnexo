import {
  addDoc,
  arrayUnion,
  arrayRemove,
  collection,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { ADMIN_EMAIL, canAccessAdminPanel } from "../config/admin";
import { getConversationBlockStatus } from "./blockingService";

export const SYSTEM_NOTIFICATION_USER_ID = "padelnexo-system";
export const SYSTEM_NOTIFICATION_USER_NAME = "PadelNexo";

function buildConversationId(userA, userB) {
  return [userA, userB].sort().join("__");
}

function getOtherUserIdFromConversationId(conversationId = "", currentUserId = "") {
  return String(conversationId || "")
    .split("__")
    .find((item) => item && item !== currentUserId) || "";
}

function normalizeDate(value) {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value?.seconds) {
    return new Timestamp(value.seconds, value.nanoseconds || 0).toDate();
  }

  return value instanceof Date ? value : new Date(0);
}

export function subscribeToConversation({ currentUserId, otherUserId, onData, onError }) {
  if (!currentUserId || !otherUserId) {
    onData([]);
    return () => {};
  }

  const conversationId = buildConversationId(currentUserId, otherUserId);
  const messagesRef = collection(db, "conversations", conversationId, "messages");
  const messagesQuery = query(messagesRef, orderBy("createdAt", "asc"));

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data() || {};

          return {
            id: docSnapshot.id,
            sender: data.senderId === currentUserId ? "me" : "them",
            senderId: data.senderId || "",
            text: data.text || "",
            action: data.action || null,
            priority: data.priority || "",
            createdAt: normalizeDate(data.createdAt),
          };
      });

      onData(messages);
    },
    onError
  );
}

export async function sendChatMessage({
  currentUserId,
  currentUserName,
  otherUserId,
  otherUserName,
  text,
}) {
  const normalizedText = String(text || "").trim();

  if (!currentUserId || !otherUserId || !normalizedText) {
    return;
  }

  const blockStatus = await getConversationBlockStatus({
    currentUserId,
    otherUserId,
  });

  if (blockStatus.isBlocked) {
    throw new Error("CHAT_BLOCKED");
  }

  const conversationId = buildConversationId(currentUserId, otherUserId);
  const conversationRef = doc(db, "conversations", conversationId);
  const messagesRef = collection(db, "conversations", conversationId, "messages");
  const payload = {
    text: normalizedText,
    senderId: currentUserId,
    recipientId: otherUserId,
    createdAt: serverTimestamp(),
  };

  await setDoc(
    conversationRef,
    {
      participants: [currentUserId, otherUserId].sort(),
      participantNames: {
        [currentUserId]: currentUserName || "Jugador",
        [otherUserId]: otherUserName || "Jugador",
      },
      unreadBy: [otherUserId],
      lastMessageText: normalizedText,
      lastMessageSenderId: currentUserId,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  await addDoc(messagesRef, payload);

  await updateDoc(conversationRef, {
    updatedAt: serverTimestamp(),
    [`unreadCountBy.${otherUserId}`]: increment(1),
    [`unreadCountBy.${currentUserId}`]: 0,
    hiddenFor: arrayRemove(currentUserId, otherUserId),
    unreadBy: [otherUserId],
    lastMessageText: normalizedText,
    lastMessageSenderId: currentUserId,
    participantNames: {
      [currentUserId]: currentUserName || "Jugador",
      [otherUserId]: otherUserName || "Jugador",
    },
  });
}

export function subscribeToUserConversations({ currentUserId, onData, onError }) {
  if (!currentUserId) {
    onData([]);
    return () => {};
  }

  const conversationsRef = collection(db, "conversations");
  const conversationsQuery = query(
    conversationsRef,
    where("participants", "array-contains", currentUserId)
  );

  return onSnapshot(
    conversationsQuery,
    (snapshot) => {
      const conversations = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data() || {};
          const participants = Array.isArray(data.participants) ? data.participants : [];
          const otherUserId =
            participants.find((item) => item !== currentUserId) ||
            getOtherUserIdFromConversationId(docSnapshot.id, currentUserId);
          const participantNames = data.participantNames || {};
          const unreadCountBy = data.unreadCountBy || {};
          const unreadCount = Number(unreadCountBy[currentUserId] || 0);
          const hiddenFor = Array.isArray(data.hiddenFor) ? data.hiddenFor : [];

          if (hiddenFor.includes(currentUserId)) {
            return null;
          }

          return {
            id: docSnapshot.id,
            playerId: otherUserId,
            title: participantNames[otherUserId] || "Usuario eliminado",
            subtitle: data.lastMessageText || "Todavia no hay mensajes.",
            action: data.lastMessageAction || null,
            priority: data.lastMessagePriority || "",
            hasUnread:
              (Array.isArray(data.unreadBy) && data.unreadBy.includes(currentUserId)) ||
              unreadCount > 0,
            unreadCount:
              unreadCount > 0
                ? unreadCount
                : Array.isArray(data.unreadBy) && data.unreadBy.includes(currentUserId)
                  ? 1
                  : 0,
            updatedAt: normalizeDate(data.updatedAt),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      onData(conversations);
    },
    onError
  );
}

async function listAdminNotificationRecipients() {
  const snapshot = await getDocs(collection(db, "users"));

  return snapshot.docs
    .map((docSnapshot) => ({
      uid: docSnapshot.id,
      ...(docSnapshot.data() || {}),
    }))
    .filter((profile) =>
      canAccessAdminPanel({
        uid: profile.uid,
        email: profile.email || "",
        role: profile.role || "",
        adminStatus: profile.adminStatus || "",
      })
    );
}

export async function sendOrganizerRequestNotificationToAdmins(request = {}) {
  const admins = await listAdminNotificationRecipients();
  const requesterName = request.nombre || request.name || "Un usuario";
  const text = `Nueva solicitud de organizador recibida de ${requesterName}. Revisa los datos y complejos cargados.`;
  const action = {
    type: "admin_organizer_requests",
    label: "Ver la solicitud",
    targetScreen: "Admin",
    params: {
      initialTab: "requests",
    },
  };

  await Promise.all(
    admins.map(async (admin) => {
      const adminId = admin.uid || admin.id;

      if (!adminId) {
        return;
      }

      const conversationId = buildConversationId(SYSTEM_NOTIFICATION_USER_ID, adminId);
      const conversationRef = doc(db, "conversations", conversationId);
      const messagesRef = collection(db, "conversations", conversationId, "messages");
      const payload = {
        text,
        senderId: SYSTEM_NOTIFICATION_USER_ID,
        recipientId: adminId,
        priority: "important",
        action,
        createdAt: serverTimestamp(),
      };

      await setDoc(
        conversationRef,
        {
          participants: [SYSTEM_NOTIFICATION_USER_ID, adminId].sort(),
          participantNames: {
            [SYSTEM_NOTIFICATION_USER_ID]: SYSTEM_NOTIFICATION_USER_NAME,
            [adminId]: admin.nombre || admin.name || admin.email || ADMIN_EMAIL,
          },
          unreadBy: [adminId],
          lastMessageText: text,
          lastMessageSenderId: SYSTEM_NOTIFICATION_USER_ID,
          lastMessagePriority: "important",
          lastMessageAction: action,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      await addDoc(messagesRef, payload);

      await updateDoc(conversationRef, {
        updatedAt: serverTimestamp(),
        [`unreadCountBy.${adminId}`]: increment(1),
        hiddenFor: arrayRemove(adminId),
        unreadBy: [adminId],
        lastMessageText: text,
        lastMessageSenderId: SYSTEM_NOTIFICATION_USER_ID,
        lastMessagePriority: "important",
        lastMessageAction: action,
      });
    })
  );
}

export async function deleteConversationForUser({ currentUserId, otherUserId, conversationId }) {
  const resolvedConversationId =
    conversationId || (currentUserId && otherUserId ? buildConversationId(currentUserId, otherUserId) : "");

  if (!currentUserId || !resolvedConversationId) {
    return;
  }

  const conversationRef = doc(db, "conversations", resolvedConversationId);

  await updateDoc(conversationRef, {
    [`unreadCountBy.${currentUserId}`]: 0,
    hiddenFor: arrayUnion(currentUserId),
    unreadBy: arrayRemove(currentUserId),
  });
}

export async function markConversationAsRead({ currentUserId, otherUserId }) {
  if (!currentUserId || !otherUserId) {
    return;
  }

  const conversationId = buildConversationId(currentUserId, otherUserId);
  const conversationRef = doc(db, "conversations", conversationId);

  await updateDoc(conversationRef, {
    [`unreadCountBy.${currentUserId}`]: 0,
    unreadBy: arrayRemove(currentUserId),
  }).catch(async () => {
    await setDoc(
      conversationRef,
      {
        unreadCountBy: {
          [currentUserId]: 0,
        },
      },
      { merge: true }
    );
  });
}

export function subscribeToUnreadMessageCount({ currentUserId, onData, onError }) {
  if (!currentUserId) {
    onData(0);
    return () => {};
  }

  return subscribeToUserConversations({
    currentUserId,
    onData: (conversations) => {
      onData(conversations.filter((item) => item.hasUnread).length);
    },
    onError,
  });
}

export function subscribeToUnreadMessageSummary({ currentUserId, onData, onError }) {
  if (!currentUserId) {
    onData({ count: 0, hasImportant: false });
    return () => {};
  }

  return subscribeToUserConversations({
    currentUserId,
    onData: (conversations) => {
      const unreadConversations = conversations.filter((item) => item.hasUnread);

      onData({
        count: unreadConversations.length,
        hasImportant: unreadConversations.some((item) => item.priority === "important"),
      });
    },
    onError,
  });
}

