import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AvailabilityEditor from "./AvailabilityEditor";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { subscribeToUnreadMessageCount } from "../services/chatService";
import { subscribeToUnreadInvitationsCount } from "../services/invitationsService";

export const BOTTOM_QUICK_ACTIONS_SPACE = 108;

function InvitationsActionIcon() {
  return (
    <View style={styles.composedIconWrap}>
      <Ionicons color="#2D5E97" name="mail-outline" size={20} />
      <Ionicons color="#1FAB89" name="arrow-up-circle" size={12} style={styles.inviteArrowUp} />
      <Ionicons
        color="#D64545"
        name="arrow-down-circle"
        size={12}
        style={styles.inviteArrowDown}
      />
    </View>
  );
}

function QuickActionButton({ label, onPress, renderIcon, showBadge = false }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
    >
      <View style={styles.iconFrame}>
        {renderIcon()}
        {showBadge ? <View style={styles.notificationDot} /> : null}
      </View>
      <Text numberOfLines={1} style={styles.actionLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function BottomQuickActionsBar() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { updateProfile, userData } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadInvitationsCount, setUnreadInvitationsCount] = useState(0);
  const [isAvailabilityVisible, setIsAvailabilityVisible] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToUnreadMessageCount({
      currentUserId: userData?.uid,
      onData: setUnreadCount,
      onError: () => setUnreadCount(0),
    });

    return unsubscribe;
  }, [userData?.uid]);

  useEffect(() => {
    const unsubscribe = subscribeToUnreadInvitationsCount({
      currentUserId: userData?.uid,
      onData: setUnreadInvitationsCount,
      onError: () => setUnreadInvitationsCount(0),
    });

    return unsubscribe;
  }, [userData?.uid]);

  if (!userData?.uid) {
    return null;
  }

  const handleSaveAvailability = async (availability) => {
    setAvailabilitySaving(true);

    try {
      await updateProfile({ availability });
    } finally {
      setAvailabilitySaving(false);
    }
  };

  return (
    <>
      <View
        pointerEvents="box-none"
        style={[
          styles.wrapper,
          {
            paddingBottom: Math.max(insets.bottom, 6),
          },
        ]}
      >
        <View style={styles.bar}>
          <QuickActionButton
            label="Mensajes"
            onPress={() => navigation.navigate("Mensajes")}
            renderIcon={() => (
              <Ionicons color="#67439C" name="chatbubble-ellipses-outline" size={20} />
            )}
            showBadge={unreadCount > 0}
          />
          <QuickActionButton
            label="Invitaciones"
            onPress={() => navigation.navigate("Invitaciones")}
            renderIcon={() => <InvitationsActionIcon />}
            showBadge={unreadInvitationsCount > 0}
          />
          <QuickActionButton
            label="Disponibilidad"
            onPress={() => setIsAvailabilityVisible(true)}
            renderIcon={() => (
              <View style={styles.composedIconWrap}>
                <Ionicons color="#2F7F96" name="calendar-outline" size={20} />
                <Ionicons color="#2F7F96" name="time-outline" size={12} style={styles.timeIcon} />
              </View>
            )}
          />
        </View>
      </View>

      <AvailabilityEditor
        initialAvailability={userData?.availability}
        loading={availabilitySaving}
        onClose={() => setIsAvailabilityVisible(false)}
        onSave={handleSaveAvailability}
        visible={isAvailabilityVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.lg,
    position: "absolute",
    right: 0,
    zIndex: 100,
  },
  bar: {
    backgroundColor: "rgba(255,255,255,0.96)",
    borderColor: "rgba(207,231,220,0.96)",
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#F8FCFA",
    borderColor: "#D8EBE1",
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 60,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  actionButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  iconFrame: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 24,
    minWidth: 24,
    position: "relative",
  },
  actionLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 6,
    textAlign: "center",
  },
  notificationDot: {
    backgroundColor: "#E5484D",
    borderColor: colors.surface,
    borderRadius: 999,
    borderWidth: 2,
    height: 12,
    position: "absolute",
    right: -6,
    top: -4,
    width: 12,
  },
  composedIconWrap: {
    alignItems: "center",
    height: 22,
    justifyContent: "center",
    position: "relative",
    width: 22,
  },
  inviteArrowUp: {
    position: "absolute",
    right: -4,
    top: -4,
  },
  inviteArrowDown: {
    left: -4,
    position: "absolute",
    top: 10,
  },
  timeIcon: {
    position: "absolute",
    right: -3,
    top: 10,
  },
});
