import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  collection,
  setDoc,
  where,
} from "firebase/firestore";

import { db } from "../../services/firebaseConfig";

function buildBlockId(blockerId, blockedId) {
  return `${blockerId}__${blockedId}`;
}

export async function blockUser({ blockerId, blockerName, blockedId, blockedName }) {
  if (!blockerId || !blockedId || blockerId === blockedId) {
    return;
  }

  await setDoc(doc(db, "userBlocks", buildBlockId(blockerId, blockedId)), {
    blockerId,
    blockerName: blockerName || "Jugador",
    blockedId,
    blockedName: blockedName || "Jugador",
  });
}

export async function unblockUser({ blockerId, blockedId }) {
  if (!blockerId || !blockedId) {
    return;
  }

  await deleteDoc(doc(db, "userBlocks", buildBlockId(blockerId, blockedId)));
}

export function subscribeToBlockedUsers({ blockerId, onData, onError }) {
  if (!blockerId) {
    onData([]);
    return () => {};
  }

  const blocksQuery = query(
    collection(db, "userBlocks"),
    where("blockerId", "==", blockerId)
  );

  return onSnapshot(
    blocksQuery,
    (snapshot) => {
      onData(snapshot.docs.map((docSnapshot) => docSnapshot.data()?.blockedId).filter(Boolean));
    },
    onError
  );
}

export async function getConversationBlockStatus({ currentUserId, otherUserId }) {
  if (!currentUserId || !otherUserId) {
    return {
      blockedByCurrentUser: false,
      blockedByOtherUser: false,
      isBlocked: false,
    };
  }

  const blockedByCurrentRef = doc(db, "userBlocks", buildBlockId(currentUserId, otherUserId));
  const blockedByOtherRef = doc(db, "userBlocks", buildBlockId(otherUserId, currentUserId));
  const [blockedByCurrentSnapshot, blockedByOtherSnapshot] = await Promise.all([
    getDoc(blockedByCurrentRef),
    getDoc(blockedByOtherRef),
  ]);

  const blockedByCurrentUser = blockedByCurrentSnapshot.exists();
  const blockedByOtherUser = blockedByOtherSnapshot.exists();

  return {
    blockedByCurrentUser,
    blockedByOtherUser,
    isBlocked: blockedByCurrentUser || blockedByOtherUser,
  };
}
