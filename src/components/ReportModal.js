import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function ReportModal({
  visible,
  title = "Reportar",
  targetLabel = "",
  submitting = false,
  onCancel,
  onSubmit,
}) {
  const [description, setDescription] = useState("");

  const handleSubmit = () => {
    onSubmit?.(description);
    setDescription("");
  };

  const handleCancel = () => {
    setDescription("");
    onCancel?.();
  };

  return (
    <Modal animationType="fade" onRequestClose={handleCancel} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable onPress={handleCancel} style={styles.backdrop} />
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {targetLabel ? <Text style={styles.target}>{targetLabel}</Text> : null}
          <TextInput
            multiline
            onChangeText={setDescription}
            placeholder="Contanos brevemente que queres reportar"
            placeholderTextColor={colors.muted}
            style={styles.input}
            textAlignVertical="top"
            value={description}
          />
          <View style={styles.actions}>
            <Pressable
              disabled={submitting}
              onPress={handleCancel}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryText}>Cancelar</Text>
            </Pressable>
            <Pressable
              disabled={submitting}
              onPress={handleSubmit}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryText}>{submitting ? "Enviando..." : "Enviar reporte"}</Text>
            </Pressable>
          </View>
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
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.lg,
    width: "100%",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  target: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: spacing.md,
    minHeight: 110,
    padding: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 16,
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
  },
  primaryText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  buttonPressed: {
    opacity: 0.9,
  },
});
