import {
  addDoc,
  arrayRemove,
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "../../services/firebaseConfig";
import { getConversationBlockStatus } from "./blockingService";

function buildConversationId(userA, userB) {
  return [userA, userB].sort().join("__");
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
          const otherUserId = participants.find((item) => item !== currentUserId) || "";
          const participantNames = data.participantNames || {};
          const unreadCountBy = data.unreadCountBy || {};
          const unreadCount = Number(unreadCountBy[currentUserId] || 0);

          return {
            id: docSnapshot.id,
            playerId: otherUserId,
            title: participantNames[otherUserId] || "Jugador",
            subtitle: data.lastMessageText || "Todavia no hay mensajes.",
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
        .sort((a, b) => b.updatedAt - a.updatedAt);

      onData(conversations);
    },
    onError
  );
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
