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
  const isWarning = tone === "warning";
  const messageParts = String(message || "").split(/(\*\*[^*]+\*\*)/g);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={[styles.card, isWarning ? styles.cardWarning : null]}>
          {isWarning ? (
            <View style={styles.warningIcon}>
              <Text style={styles.warningIconText}>!</Text>
            </View>
          ) : null}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>
            {messageParts.map((part, index) => {
              const isBold = part.startsWith("**") && part.endsWith("**");
              const text = isBold ? part.slice(2, -2) : part;

              return (
                <Text key={`${text}-${index}`} style={isBold ? styles.messageBold : null}>
                  {text}
                </Text>
              );
            })}
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.button,
              isDanger ? styles.buttonDanger : null,
              isWarning ? styles.buttonWarning : null,
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
  cardWarning: {
    borderColor: "#F2C94C",
    borderWidth: 2,
  },
  warningIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#FFD84D",
    borderColor: "#E0A400",
    borderRadius: 999,
    borderWidth: 2,
    height: 58,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 58,
  },
  warningIconText: {
    color: "#7A4300",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
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
  messageBold: {
    color: colors.text,
    fontWeight: "900",
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
  buttonWarning: {
    backgroundColor: "#D99000",
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

