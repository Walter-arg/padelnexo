import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function FeedbackModal({
  visible,
  title,
  message,
  confirmLabel = "Entendido",
  onClose,
  tone = "default",
}) {
  const isDanger = tone === "danger";

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.button,
              isDanger ? styles.buttonDanger : null,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.buttonText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  message: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 16,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  buttonDanger: {
    backgroundColor: colors.danger,
  },
  buttonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  buttonPressed: {
    opacity: 0.9,
  },
});
