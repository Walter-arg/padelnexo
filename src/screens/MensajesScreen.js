import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import SectionHeader from "../components/SectionHeader";
import FeedbackModal from "../components/FeedbackModal";
import ReportModal from "../components/ReportModal";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  blockUser,
  getConversationBlockStatus,
  subscribeToBlockedUsers,
  unblockUser,
} from "../services/blockingService";
import {
  deleteConversationForUser,
  markConversationAsRead,
  sendChatMessage,
  subscribeToConversation,
  subscribeToUserConversations,
} from "../services/chatService";
import { submitReport } from "../services/reportsService";

function buildConversation({ conversationId, playerId, playerName }) {
  if (!playerId && !playerName) {
    return null;
  }

  return {
    id: conversationId || `chat-${playerId ?? "new"}`,
    conversationId,
    playerId,
    title: playerName ?? "Jugador",
    subtitle: "Todavia no hay mensajes en esta conversacion.",
  };
}

const MESSAGE_MAX_LENGTH = 180;

function renderRichMessageText(text = "", baseStyle = null) {
  return String(text || "")
    .split(/(\*\*.*?\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      const isBold = part.startsWith("**") && part.endsWith("**");

      return (
        <Text key={`${part}-${index}`} style={isBold ? styles.messageTextBold : baseStyle}>
          {isBold ? part.slice(2, -2) : part}
        </Text>
      );
    });
}

function formatMessageDate(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function formatMessageTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function buildMessagesWithDateDividers(messages = []) {
  let lastDate = "";

  return messages.flatMap((item) => {
    const currentDate = formatMessageDate(item.createdAt);
    const rows = [];

    if (currentDate !== lastDate) {
      rows.push({
        id: `date-${currentDate}`,
        type: "date-divider",
        label: currentDate,
      });
      lastDate = currentDate;
    }

    rows.push({
      ...item,
      type: "message",
      timeLabel: formatMessageTime(item.createdAt),
    });

    return rows;
  });
}

export default function MensajesScreen({ navigation, route }) {
  const { userData } = useAuth();
  const insets = useSafeAreaInsets();
  const currentUserId = userData?.uid || userData?.id;
  const currentUserName = userData?.name || userData?.email || "Jugador";
  const selectedPlayerId = route?.params?.playerId;
  const selectedPlayerName = route?.params?.playerName?.trim();
  const selectedConversationId = route?.params?.conversationId;
  const activeConversation = useMemo(
    () =>
      buildConversation({
        conversationId: selectedConversationId,
        playerId: selectedPlayerId,
        playerName: selectedPlayerName,
      }),
    [selectedConversationId, selectedPlayerId, selectedPlayerName]
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [conversationMessages, setConversationMessages] = useState([]);
  const [conversationList, setConversationList] = useState([]);
  const [blockedUserIds, setBlockedUserIds] = useState([]);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [deletingConversationId, setDeletingConversationId] = useState("");
  const [deleteSelectionMode, setDeleteSelectionMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState([]);
  const [pendingDeleteConversations, setPendingDeleteConversations] = useState([]);
  const [pendingBlockConversation, setPendingBlockConversation] = useState(null);
  const [reportingConversation, setReportingConversation] = useState(null);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [activeBlockState, setActiveBlockState] = useState({
    blockedByCurrentUser: false,
    blockedByOtherUser: false,
    isBlocked: false,
  });
  const listRef = useRef(null);

  const handleMessageAction = (action) => {
    if (!action?.type) {
      return;
    }

    if (action.type === "admin_organizer_requests") {
      navigation.navigate("Admin", { initialTab: "requests" });
    }
  };

  useEffect(() => {
    setDraftMessage("");
  }, [activeConversation]);

  useEffect(() => {
    const unsubscribe = subscribeToUserConversations({
      currentUserId,
      onData: (nextConversations) => {
        setConversationList(
          nextConversations.map((item) => ({
            ...item,
            blockedByCurrentUser: blockedUserIds.includes(item.playerId),
          }))
        );
      },
      onError: () => setConversationList([]),
    });

    return unsubscribe;
  }, [blockedUserIds, currentUserId]);

  useEffect(() => {
    const unsubscribe = subscribeToBlockedUsers({
      blockerId: currentUserId,
      onData: setBlockedUserIds,
      onError: () => setBlockedUserIds([]),
    });

    return unsubscribe;
  }, [currentUserId]);

  useEffect(() => {
    if (!activeConversation?.playerId || !currentUserId) {
      setConversationMessages([]);
      return undefined;
    }

    const unsubscribe = subscribeToConversation({
      currentUserId,
      otherUserId: activeConversation.playerId,
      onData: setConversationMessages,
      onError: () => setConversationMessages([]),
    });

    return unsubscribe;
  }, [activeConversation, currentUserId]);

  useEffect(() => {
    if (!activeConversation?.playerId || !currentUserId) {
      setActiveBlockState({
        blockedByCurrentUser: false,
        blockedByOtherUser: false,
        isBlocked: false,
      });
      return;
    }

    getConversationBlockStatus({
      currentUserId,
      otherUserId: activeConversation.playerId,
    })
      .then(setActiveBlockState)
      .catch(() =>
        setActiveBlockState({
          blockedByCurrentUser: false,
          blockedByOtherUser: false,
          isBlocked: false,
        })
      );
  }, [activeConversation, currentUserId, blockedUserIds]);

  useEffect(() => {
    if (!activeConversation?.playerId || !currentUserId) {
      return;
    }

    markConversationAsRead({
      currentUserId,
      otherUserId: activeConversation.playerId,
    }).catch((error) => {
      console.log("[MensajesScreen] No pudimos marcar como leido", error);
    });
  }, [activeConversation, currentUserId, conversationMessages]);

  useEffect(() => {
    if (!conversationMessages.length) {
      return;
    }

    listRef.current?.scrollToEnd({ animated: true });
  }, [conversationMessages]);

  useEffect(() => {
    if (!isKeyboardVisible) {
      return;
    }

    const timeoutId = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 120);

    return () => clearTimeout(timeoutId);
  }, [isKeyboardVisible]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const handleSendMessage = async () => {
    const normalizedMessage = draftMessage.trim().slice(0, MESSAGE_MAX_LENGTH);

    if (!normalizedMessage || !activeConversation) {
      return;
    }

    try {
      await sendChatMessage({
        currentUserId,
        currentUserName,
        otherUserId: activeConversation.playerId,
        otherUserName: activeConversation.title,
        text: normalizedMessage,
      });
      setDraftMessage("");
    } catch (error) {
      console.log("[MensajesScreen] No pudimos enviar el mensaje", error);
      if (error?.message === "CHAT_BLOCKED") {
        Alert.alert(
          "Chat bloqueado",
          "No puedes enviar mensajes en esta conversacion porque uno de los dos usuarios esta bloqueado."
        );
        return;
      }
      Alert.alert(
        "No pudimos enviar el mensaje",
        "Revisa tu conexion o las reglas de Firestore e intenta nuevamente."
      );
    }
  };

  const handleToggleBlock = (conversation) => {
    setPendingBlockConversation(conversation);
  };

  const handleOpenDeleteModal = (conversations, { leaveChat = false } = {}) => {
    const nextConversations = Array.isArray(conversations)
      ? conversations.filter(Boolean)
      : [conversations].filter(Boolean);

    if (!nextConversations.length || !currentUserId) {
      return;
    }

    setPendingDeleteConversations(
      nextConversations.map((item) => ({
        ...item,
        leaveChat,
      }))
    );
  };

  const handleCloseDeleteModal = () => {
    if (deletingConversationId) {
      return;
    }

    setPendingDeleteConversations([]);
  };

  const handleConfirmDeleteConversations = async () => {
    if (!pendingDeleteConversations.length || !currentUserId) {
      return;
    }

    try {
      setDeletingConversationId("bulk");
      await Promise.all(
        pendingDeleteConversations.map((conversation) =>
          deleteConversationForUser({
            conversationId:
              conversation.conversationId ||
              (String(conversation.id || "").includes("__") ? conversation.id : undefined),
            currentUserId,
            otherUserId: conversation.playerId,
          })
        )
      );

      const shouldLeaveChat = pendingDeleteConversations.some((item) => item.leaveChat);
      setPendingDeleteConversations([]);
      setSelectedConversationIds([]);
      setDeleteSelectionMode(false);

      if (shouldLeaveChat) {
        navigation.navigate("Mensajes");
      }
    } catch (error) {
      Alert.alert("No pudimos eliminar", "Intenta nuevamente en unos instantes.");
    } finally {
      setDeletingConversationId("");
    }
  };

  const toggleConversationSelection = (conversationId) => {
    setSelectedConversationIds((current) =>
      current.includes(conversationId)
        ? current.filter((item) => item !== conversationId)
        : [...current, conversationId]
    );
  };

  const handleSelectAllConversations = () => {
    setSelectedConversationIds((current) =>
      current.length === conversationList.length ? [] : conversationList.map((item) => item.id)
    );
  };

  const selectedConversations = conversationList.filter((item) =>
    selectedConversationIds.includes(item.id)
  );

  const deleteModalCount = pendingDeleteConversations.length;

  const deleteConfirmModal = (
    <Modal
      animationType="fade"
      onRequestClose={handleCloseDeleteModal}
      transparent
      visible={deleteModalCount > 0}
    >
      <View style={styles.modalOverlay}>
        <Pressable onPress={handleCloseDeleteModal} style={styles.modalBackdrop} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>
            {deleteModalCount > 1 ? "Eliminar conversaciones" : "Eliminar conversacion"}
          </Text>
          <Text style={styles.modalText}>
            {deleteModalCount > 1
              ? `Se quitaran ${deleteModalCount} conversaciones de tus mensajes.`
              : `Se quitara esta conversacion con ${
                  pendingDeleteConversations[0]?.title || "este usuario"
                } de tus mensajes.`}
          </Text>
          <View style={styles.modalActions}>
            <Pressable
              disabled={Boolean(deletingConversationId)}
              onPress={handleCloseDeleteModal}
              style={({ pressed }) => [
                styles.modalSecondaryButton,
                pressed && !deletingConversationId ? styles.modalButtonPressed : null,
              ]}
            >
              <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable
              disabled={Boolean(deletingConversationId)}
              onPress={handleConfirmDeleteConversations}
              style={({ pressed }) => [
                styles.modalPrimaryButton,
                styles.modalDeleteButton,
                pressed && !deletingConversationId ? styles.modalButtonPressed : null,
              ]}
            >
              <Text style={styles.modalPrimaryButtonText}>
                {deletingConversationId ? "Eliminando..." : "Eliminar"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  const handleConfirmBlockToggle = async () => {
    if (!pendingBlockConversation) {
      return;
    }

    const isBlockedByCurrentUser = blockedUserIds.includes(pendingBlockConversation.playerId);

    try {
      if (isBlockedByCurrentUser) {
        await unblockUser({
          blockerId: currentUserId,
          blockedId: pendingBlockConversation.playerId,
        });
      } else {
        await blockUser({
          blockerId: currentUserId,
          blockerName: currentUserName,
          blockedId: pendingBlockConversation.playerId,
          blockedName: pendingBlockConversation.title,
        });
      }

      setPendingBlockConversation(null);
    } catch (error) {
      setPendingBlockConversation(null);
      Alert.alert(
        "No pudimos actualizar el bloqueo",
        "Intenta nuevamente en unos instantes."
      );
    }
  };

  const handleSubmitConversationReport = async (description) => {
    if (!reportingConversation || !currentUserId) {
      return;
    }

    try {
      setSubmittingReport(true);
      await submitReport({
        reporter: userData,
        targetType: "conversation",
        targetId: reportingConversation.conversationId || reportingConversation.id,
        targetTitle: reportingConversation.title,
        description,
        metadata: {
          otherUserId: reportingConversation.playerId,
          reportedUserId: reportingConversation.playerId,
          reportedUserName: reportingConversation.title,
        },
      });
      setReportingConversation(null);
      setFeedback({
        visible: true,
        title: "Reporte enviado",
        message: "Gracias. El equipo administrador lo va a revisar.",
        tone: "default",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos enviar el reporte",
        message: "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSubmittingReport(false);
    }
  };

  if (activeConversation) {
    const messagesToRender =
      conversationMessages.length > 0
        ? buildMessagesWithDateDividers(conversationMessages)
        : [
            {
              id: `placeholder-${activeConversation.id}`,
              sender: "system",
              createdAt: new Date(),
              timeLabel: formatMessageTime(new Date()),
              text: "Todavia no hay mensajes en esta conversacion. Cuando empiecen a chatear, apareceran aca.",
              type: "message",
            },
          ];

    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Mensajes" />
        <Text style={styles.globalWarningText}>
          EL ENVIO DE SPAM O PUBLICIDAD ES CAUSA DE BLOQUEO
        </Text>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
          style={styles.container}
        >
          <View pointerEvents="none" style={styles.backgroundRacketLeft} />
          <View pointerEvents="none" style={styles.backgroundRacketRight} />
          <View pointerEvents="none" style={styles.backgroundBall} />
          <View style={styles.chatHeader}>
            <View style={styles.chatTitleRow}>
              <Pressable
                hitSlop={8}
                onPress={() => handleOpenDeleteModal(activeConversation, { leaveChat: true })}
                style={({ pressed }) => [
                  styles.chatDeleteButton,
                  pressed && styles.blockButtonPressed,
                ]}
              >
                <Ionicons color="#B43A32" name="trash-outline" size={16} />
              </Pressable>
              <Text style={styles.chatTitle}>{activeConversation.title}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => handleToggleBlock(activeConversation)}
                style={({ pressed }) => [
                  styles.chatBlockButton,
                  activeBlockState.blockedByCurrentUser && styles.chatBlockButtonActive,
                  pressed && styles.blockButtonPressed,
                ]}
              >
                <Ionicons
                  color={activeBlockState.blockedByCurrentUser ? "#7A1F1F" : "#7D8790"}
                  name={activeBlockState.blockedByCurrentUser ? "ban" : "ban-outline"}
                  size={16}
                />
              </Pressable>
              <Pressable
                hitSlop={8}
                onPress={() => setReportingConversation(activeConversation)}
                style={({ pressed }) => [
                  styles.chatReportButton,
                  pressed && styles.blockButtonPressed,
                ]}
              >
                <Ionicons color="#C45B00" name="flag-outline" size={16} />
              </Pressable>
            </View>
            <Text style={styles.chatSubtitle}>
              Conversacion individual con este jugador
            </Text>
            {activeBlockState.isBlocked ? (
              <View style={styles.blockBanner}>
                <Ionicons color="#7A1F1F" name="ban-outline" size={16} />
                <Text style={styles.blockBannerText}>
                  {activeBlockState.blockedByCurrentUser
                    ? "Bloqueaste a este jugador. El chat esta deshabilitado."
                    : "Este jugador esta bloqueando el chat. No puedes enviar mensajes."}
                </Text>
              </View>
            ) : null}
          </View>

          <FlatList
            ref={listRef}
            contentContainerStyle={styles.chatContent}
            data={messagesToRender}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.type === "date-divider") {
                return (
                  <View style={styles.dateDividerWrap}>
                    <Text style={styles.dateDividerText}>{item.label}</Text>
                  </View>
                );
              }

              const isOwnMessage = item.sender === "me";
              const isSystemMessage = item.sender === "system";

              return (
                <View
                  style={[
                    styles.messageRow,
                    isOwnMessage && styles.messageRowOwn,
                    isSystemMessage && styles.messageRowSystem,
                  ]}
                >
                  <View style={[styles.messageInline, isOwnMessage && styles.messageInlineOwn]}>
                    <View
                      style={[
                        styles.messageBubble,
                        isOwnMessage && styles.messageBubbleOwn,
                        isSystemMessage && styles.messageBubbleSystem,
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageText,
                          isOwnMessage && styles.messageTextOwn,
                          isSystemMessage && styles.messageTextSystem,
                        ]}
                      >
                        {renderRichMessageText(
                          item.text,
                          isOwnMessage
                            ? styles.messageTextOwn
                            : isSystemMessage
                              ? styles.messageTextSystem
                              : null
                        )}
                      </Text>
                      {item.action?.type ? (
                        <Pressable
                          onPress={() => handleMessageAction(item.action)}
                          style={({ pressed }) => [
                            styles.messageActionButton,
                            pressed && styles.blockButtonPressed,
                          ]}
                        >
                          <Text style={styles.messageActionText}>
                            {item.action.label || "Ver detalle"}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {!isSystemMessage ? (
                      <Text
                        style={[
                          styles.messageTime,
                          isOwnMessage && styles.messageTimeOwn,
                        ]}
                      >
                        {item.timeLabel}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
            showsVerticalScrollIndicator={false}
          />

          <View style={styles.composerWrap}>
            <View style={{ paddingBottom: isKeyboardVisible ? 4 : Math.max(insets.bottom, 10) }}>
            <View style={styles.composer}>
            <TextInput
              editable={!activeBlockState.isBlocked}
              maxLength={MESSAGE_MAX_LENGTH}
              onChangeText={setDraftMessage}
              placeholder={
                activeBlockState.isBlocked
                  ? "Chat bloqueado"
                  : "Escribi un mensaje..."
              }
              placeholderTextColor="#8D96A0"
              style={styles.composerInput}
              value={draftMessage}
            />
            <Pressable
              disabled={activeBlockState.isBlocked || !draftMessage.trim()}
              onPress={handleSendMessage}
              style={({ pressed }) => [
                styles.sendButton,
                (activeBlockState.isBlocked || !draftMessage.trim()) && styles.sendButtonDisabled,
                pressed &&
                  !activeBlockState.isBlocked &&
                  draftMessage.trim() &&
                  styles.sendButtonPressed,
              ]}
            >
              <Ionicons color="#FFFFFF" name="send" size={18} />
            </Pressable>
            </View>
            <Text style={styles.composerHint}>
              {draftMessage.length}/{MESSAGE_MAX_LENGTH}
            </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
        {deleteConfirmModal}
        <ReportModal
          onCancel={() => setReportingConversation(null)}
          onSubmit={handleSubmitConversationReport}
          submitting={submittingReport}
          targetLabel={reportingConversation?.title}
          title="Reportar conversacion"
          visible={Boolean(reportingConversation)}
        />
        <FeedbackModal
          message={feedback.message}
          onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
          title={feedback.title}
          tone={feedback.tone}
          visible={feedback.visible}
        />
        <Modal
          animationType="fade"
          onRequestClose={() => setPendingBlockConversation(null)}
          transparent
          visible={Boolean(pendingBlockConversation)}
        >
          <View style={styles.modalOverlay}>
            <Pressable
              onPress={() => setPendingBlockConversation(null)}
              style={styles.modalBackdrop}
            />
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>
                {pendingBlockConversation &&
                blockedUserIds.includes(pendingBlockConversation.playerId)
                  ? "Desbloquear jugador"
                  : "Bloquear jugador"}
              </Text>
              <Text style={styles.modalText}>
                {pendingBlockConversation &&
                blockedUserIds.includes(pendingBlockConversation.playerId)
                  ? `Volveras a poder enviar y recibir mensajes con ${pendingBlockConversation.title}.`
                  : `Ya no podras enviar ni recibir mensajes con ${pendingBlockConversation?.title}.`}
              </Text>
              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setPendingBlockConversation(null)}
                  style={({ pressed }) => [
                    styles.modalSecondaryButton,
                    pressed && styles.modalButtonPressed,
                  ]}
                >
                  <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  onPress={handleConfirmBlockToggle}
                  style={({ pressed }) => [
                    styles.modalPrimaryButton,
                    pressed && styles.modalButtonPressed,
                  ]}
                >
                  <Text style={styles.modalPrimaryButtonText}>
                    {pendingBlockConversation &&
                    blockedUserIds.includes(pendingBlockConversation.playerId)
                      ? "Desbloquear"
                      : "Bloquear"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Mensajes" />
      <View style={styles.container}>
        <View pointerEvents="none" style={styles.backgroundRacketLeft} />
        <View pointerEvents="none" style={styles.backgroundRacketRight} />
        <View pointerEvents="none" style={styles.backgroundBall} />
        <Text style={styles.subtitle}>Conversaciones activas con la comunidad</Text>
        {conversationList.length > 0 ? (
          <View style={styles.selectionToolbar}>
            <Pressable
              onPress={() => {
                if (!deleteSelectionMode) {
                  setDeleteSelectionMode(true);
                  setSelectedConversationIds(conversationList.map((item) => item.id));
                  return;
                }

                handleSelectAllConversations();
              }}
              style={({ pressed }) => [
                styles.selectionAllButton,
                deleteSelectionMode &&
                selectedConversationIds.length === conversationList.length
                  ? styles.selectionCheckActive
                  : null,
                pressed && styles.blockButtonPressed,
              ]}
            >
              {deleteSelectionMode &&
              selectedConversationIds.length === conversationList.length ? (
                <Ionicons color="#FFFFFF" name="checkmark" size={13} />
              ) : null}
            </Pressable>
            {deleteSelectionMode ? (
              <>
                <Pressable
                  disabled={!selectedConversations.length}
                  onPress={() => handleOpenDeleteModal(selectedConversations)}
                  style={({ pressed }) => [
                    styles.selectionToolbarButton,
                    styles.selectionToolbarDeleteButton,
                    !selectedConversations.length ? styles.selectionToolbarButtonDisabled : null,
                    pressed && selectedConversations.length ? styles.blockButtonPressed : null,
                  ]}
                >
                  {selectedConversations.length ? (
                    <>
                      <Ionicons color="#B43A32" name="trash-outline" size={15} />
                      <Text style={styles.selectionToolbarDeleteText}>
                        {selectedConversations.length}
                      </Text>
                    </>
                  ) : null}
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        <FlatList
          contentContainerStyle={styles.listContent}
          data={conversationList}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No hay mensajes</Text>
              <Text style={styles.emptyText}>Cuando inicies un chat, aparecera aca.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const hasUnread = item.hasUnread || item.unreadCount > 0;

            return (
              <Pressable
                onLongPress={() => {
                  setDeleteSelectionMode(true);
                  toggleConversationSelection(item.id);
                }}
                onPress={() => {
                  if (deleteSelectionMode) {
                    toggleConversationSelection(item.id);
                    return;
                  }

                  navigation.navigate("Mensajes", {
                    conversationId: item.id,
                    playerId: item.playerId,
                    playerName: item.title,
                  });
                }}
                style={({ pressed }) => [
                  styles.card,
                  hasUnread ? styles.cardUnread : null,
                  selectedConversationIds.includes(item.id) ? styles.cardSelected : null,
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={styles.cardRow}>
                  {deleteSelectionMode ? (
                    <View
                      style={[
                        styles.selectionCheck,
                        selectedConversationIds.includes(item.id) ? styles.selectionCheckActive : null,
                      ]}
                    >
                      {selectedConversationIds.includes(item.id) ? (
                        <Ionicons color="#FFFFFF" name="checkmark" size={13} />
                      ) : null}
                    </View>
                  ) : null}
                  <View style={styles.cardContent}>
                    <Text
                      numberOfLines={1}
                      style={[styles.cardTitle, hasUnread ? styles.cardTitleUnread : null]}
                    >
                      {item.title}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[styles.cardSubtitle, hasUnread ? styles.cardSubtitleUnread : null]}
                    >
                      {item.subtitle}
                    </Text>
                  </View>
                  {item.unreadCount > 0 ? (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      </View>
      {deleteConfirmModal}
      <ReportModal
        onCancel={() => setReportingConversation(null)}
        onSubmit={handleSubmitConversationReport}
        submitting={submittingReport}
        targetLabel={reportingConversation?.title}
        title="Reportar conversacion"
        visible={Boolean(reportingConversation)}
      />
      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => setPendingBlockConversation(null)}
        transparent
        visible={Boolean(pendingBlockConversation)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setPendingBlockConversation(null)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {pendingBlockConversation &&
              blockedUserIds.includes(pendingBlockConversation.playerId)
                ? "Desbloquear jugador"
                : "Bloquear jugador"}
            </Text>
            <Text style={styles.modalText}>
              {pendingBlockConversation &&
              blockedUserIds.includes(pendingBlockConversation.playerId)
                ? `Volveras a poder enviar y recibir mensajes con ${pendingBlockConversation.title}.`
                : `Ya no podras enviar ni recibir mensajes con ${pendingBlockConversation?.title}.`}
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setPendingBlockConversation(null)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed && styles.modalButtonPressed,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmBlockToggle}
                style={({ pressed }) => [
                  styles.modalPrimaryButton,
                  pressed && styles.modalButtonPressed,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>
                  {pendingBlockConversation &&
                  blockedUserIds.includes(pendingBlockConversation.playerId)
                    ? "Desbloquear"
                    : "Bloquear"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6FBF8",
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  backgroundRacketLeft: {
    position: "absolute",
    left: -26,
    top: 110,
    width: 120,
    height: 150,
    borderRadius: 60,
    borderWidth: 6,
    borderColor: "rgba(24, 128, 93, 0.08)",
    backgroundColor: "rgba(24, 128, 93, 0.03)",
    transform: [{ rotate: "-22deg" }],
  },
  backgroundRacketRight: {
    position: "absolute",
    right: -30,
    bottom: 130,
    width: 132,
    height: 164,
    borderRadius: 66,
    borderWidth: 6,
    borderColor: "rgba(53, 109, 168, 0.08)",
    backgroundColor: "rgba(53, 109, 168, 0.03)",
    transform: [{ rotate: "18deg" }],
  },
  backgroundBall: {
    position: "absolute",
    top: 70,
    right: 32,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(194, 221, 90, 0.18)",
    borderWidth: 2,
    borderColor: "rgba(171, 196, 71, 0.22)",
  },
  subtitle: {
    color: "#456F61",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  globalWarningText: {
    color: "#C53131",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 13,
    marginTop: -10,
    marginBottom: 2,
    paddingHorizontal: spacing.lg,
    textAlign: "center",
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  selectionToolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-start",
    marginBottom: spacing.sm,
  },
  selectionToolbarButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  selectionAllButton: {
    alignItems: "center",
    backgroundColor: "#F4F7F5",
    borderColor: "#B8C8C0",
    borderRadius: 9,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  selectionToolbarButtonActive: {
    backgroundColor: "#E7F7EF",
    borderColor: "#7ECFA5",
  },
  selectionToolbarButtonDisabled: {
    opacity: 0.5,
  },
  selectionToolbarText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  selectionToolbarTextActive: {
    color: "#0C6A49",
  },
  selectionToolbarDeleteButton: {
    backgroundColor: "#FFF0EE",
    borderColor: "#F2B8B2",
  },
  selectionToolbarDeleteText: {
    color: "#B43A32",
    fontSize: 12,
    fontWeight: "900",
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 18,
    borderWidth: 1,
    height: 92,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  cardUnread: {
    borderColor: "#7ECFA5",
    borderWidth: 1.5,
  },
  cardSelected: {
    backgroundColor: "#F0FAF5",
    borderColor: "#0C6A49",
  },
  cardPressed: {
    opacity: 0.9,
  },
  cardRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  cardContent: {
    flex: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  selectionCheck: {
    alignItems: "center",
    backgroundColor: "#F4F7F5",
    borderColor: "#B8C8C0",
    borderRadius: 9,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  selectionCheckActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  unreadBadge: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 24,
    minWidth: 24,
    paddingHorizontal: 7,
  },
  unreadBadgeText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 20,
  },
  cardTitleUnread: {
    fontWeight: "900",
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
    marginTop: spacing.xs,
    maxWidth: "96%",
  },
  cardSubtitleUnread: {
    color: colors.text,
    fontWeight: "900",
  },
  blockButtonPressed: {
    opacity: 0.9,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  chatHeader: {
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  chatTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 40,
    position: "relative",
  },
  chatTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 22,
    textAlign: "center",
  },
  chatSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 16,
    marginTop: 0,
    textAlign: "center",
  },
  chatBlockButton: {
    alignItems: "center",
    backgroundColor: "#FFF5F5",
    borderColor: "#D96B6B",
    borderRadius: 14,
    borderWidth: 1.5,
    height: 30,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    width: 30,
  },
  chatDeleteButton: {
    alignItems: "center",
    backgroundColor: "#FFF0EE",
    borderColor: "#F2B8B2",
    borderRadius: 14,
    borderWidth: 1.5,
    height: 30,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    width: 30,
  },
  chatReportButton: {
    alignItems: "center",
    backgroundColor: "#FFF3E0",
    borderColor: "#FFB866",
    borderRadius: 14,
    borderWidth: 1.5,
    height: 30,
    justifyContent: "center",
    position: "absolute",
    right: 36,
    width: 30,
  },
  chatBlockButtonActive: {
    backgroundColor: "#FCEBEB",
    borderColor: "#B94141",
  },
  blockBanner: {
    alignItems: "center",
    backgroundColor: "#FCEBEB",
    borderColor: "#E7B7B7",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  blockBannerText: {
    color: "#7A1F1F",
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  chatContent: {
    flexGrow: 1,
    paddingBottom: spacing.md,
  },
  messageRow: {
    alignItems: "flex-start",
    marginBottom: 4,
  },
  messageRowOwn: {
    alignItems: "flex-end",
  },
  messageRowSystem: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  messageInline: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
  },
  messageInlineOwn: {
    flexDirection: "row-reverse",
  },
  messageBubble: {
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: "82%",
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  messageBubbleOwn: {
    backgroundColor: "#E7F7EF",
    borderColor: "#B9E1CB",
  },
  messageBubbleSystem: {
    backgroundColor: "#F7FBF8",
    borderColor: "#D7E6DE",
  },
  messageText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 17,
  },
  messageTextBold: {
    fontWeight: "900",
  },
  messageTime: {
    color: "#6E8D82",
    fontSize: 10,
    marginBottom: 1,
    textAlign: "center",
  },
  messageTimeOwn: {
    color: "#3D7B63",
  },
  messageTextOwn: {
    color: "#0C6A49",
  },
  messageTextSystem: {
    color: colors.muted,
    textAlign: "center",
  },
  messageActionButton: {
    alignSelf: "center",
    backgroundColor: "#FFF3E0",
    borderColor: "#FF9D2E",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  messageActionText: {
    color: "#C45B00",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  dateDividerWrap: {
    alignItems: "center",
    marginBottom: 4,
    marginTop: 2,
  },
  dateDividerText: {
    color: "#6E8D82",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  composerWrap: {
    backgroundColor: "transparent",
    paddingBottom: 0,
    paddingTop: spacing.sm,
  },
  composer: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    shadowColor: "rgba(23,58,46,0.08)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 3,
  },
  composerInput: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    minHeight: 34,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
  },
  composerHint: {
    color: "#6E8D82",
    fontSize: 11,
    marginTop: 2,
    textAlign: "right",
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: "#456F61",
    borderRadius: 16,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  sendButtonDisabled: {
    backgroundColor: "#B7C9C2",
  },
  sendButtonPressed: {
    opacity: 0.88,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(23,58,46,0.28)",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: "#D7E6DE",
    borderRadius: 24,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  modalTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
  },
  modalText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  modalSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#F4F7F5",
    borderColor: "#D7E6DE",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  modalPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#C53B3B",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  modalDeleteButton: {
    backgroundColor: "#C53B3B",
  },
  modalSecondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  modalPrimaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  modalButtonPressed: {
    opacity: 0.9,
  },
});

