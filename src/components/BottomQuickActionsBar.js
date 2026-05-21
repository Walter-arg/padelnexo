import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { subscribeToUnreadMessageSummary } from "../services/chatService";
import { subscribeToUnreadInvitationsCount } from "../services/invitationsService";
import {
  getOrganizerRegistrationsSummary,
  subscribeToOrganizerReplacementCount,
} from "../services/organizerTasksService";
import { isApprovedOrganizer } from "../services/roleService";

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

function QuickActionButton({ label, onPress, renderIcon, showBadge = false, badgeTone = "default" }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, pressed && styles.actionButtonPressed]}
    >
      <View style={styles.iconFrame}>
        {renderIcon()}
        {showBadge ? (
          <View
            style={[
              styles.notificationDot,
              badgeTone === "important" ? styles.notificationDotImportant : null,
            ]}
          />
        ) : null}
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
  const { userData } = useAuth();
  const [unreadSummary, setUnreadSummary] = useState({ count: 0, hasImportant: false });
  const [unreadInvitationsCount, setUnreadInvitationsCount] = useState(0);
  const [pendingReplacementsCount, setPendingReplacementsCount] = useState(0);
  const [pendingRegistrationsCount, setPendingRegistrationsCount] = useState(0);
  const isOrganizer = isApprovedOrganizer(userData);

  useEffect(() => {
    const unsubscribe = subscribeToUnreadMessageSummary({
      currentUserId: userData?.uid,
      onData: setUnreadSummary,
      onError: () => setUnreadSummary({ count: 0, hasImportant: false }),
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

  useEffect(() => {
    if (!isOrganizer) {
      setPendingReplacementsCount(0);
      return () => {};
    }

    const unsubscribe = subscribeToOrganizerReplacementCount({
      organizerId: userData?.uid,
      onData: setPendingReplacementsCount,
      onError: () => setPendingReplacementsCount(0),
    });

    return unsubscribe;
  }, [isOrganizer, userData?.uid]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const syncRegistrations = async () => {
        if (!isOrganizer || !userData?.uid) {
          setPendingRegistrationsCount(0);
          return;
        }

        try {
          const summary = await getOrganizerRegistrationsSummary(userData.uid);

          if (isActive) {
            setPendingRegistrationsCount(summary.count);
          }
        } catch (error) {
          if (isActive) {
            setPendingRegistrationsCount(0);
          }
        }
      };

      syncRegistrations();

      return () => {
        isActive = false;
      };
    }, [isOrganizer, userData?.uid])
  );

  if (!userData?.uid) {
    return null;
  }

  return (
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
            <Ionicons
              color={unreadSummary.hasImportant ? "#FF7A00" : "#67439C"}
              name="chatbubble-ellipses-outline"
              size={20}
            />
          )}
          showBadge={unreadSummary.count > 0}
          badgeTone={unreadSummary.hasImportant ? "important" : "default"}
        />
        {!isOrganizer ? (
          <QuickActionButton
            label="Invitaciones"
            onPress={() => navigation.navigate("Invitaciones")}
            renderIcon={() => <InvitationsActionIcon />}
            showBadge={unreadInvitationsCount > 0}
          />
        ) : null}
        {isOrganizer ? (
          <QuickActionButton
            label="Remplazos"
            onPress={() => navigation.navigate("OrganizerReplacements")}
            renderIcon={() => (
              <View style={styles.composedIconWrap}>
                <Ionicons color="#1E7A43" name="swap-horizontal-outline" size={21} />
                {pendingReplacementsCount > 0 ? (
                  <Ionicons color="#FF8A00" name="alert-circle" size={12} style={styles.timeIcon} />
                ) : null}
              </View>
            )}
            showBadge={pendingReplacementsCount > 0}
            badgeTone="important"
          />
        ) : null}
        {isOrganizer ? (
          <QuickActionButton
            label="Notificaciones"
            onPress={() => navigation.navigate("OrganizerRegistrations")}
            renderIcon={() => (
              <View style={styles.composedIconWrap}>
                <Ionicons color="#2D5E97" name="clipboard-outline" size={20} />
                {pendingRegistrationsCount > 0 ? (
                  <Ionicons color="#FF8A00" name="alert-circle" size={12} style={styles.timeIcon} />
                ) : null}
              </View>
            )}
          />
        ) : null}
      </View>
    </View>
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
  notificationDotImportant: {
    backgroundColor: "#FF7A00",
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

