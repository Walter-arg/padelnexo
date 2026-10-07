import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMemo, useState } from "react";

import { colors, spacing } from "../config/theme";

export default function CountryCodeSelector({
  options,
  value,
  onChange,
  // TEMPORAL: iOS no puede presentar un <Modal> nativo arriba de otro ya
  // abierto (queda invisible). Cuando este selector se usa DENTRO de otro
  // modal ya abierto, pasar embedded para que se dibuje como una vista
  // superpuesta en vez de un Modal propio.
  embedded = false,
}) {
  const [visible, setVisible] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.country === value) || options[0],
    [options, value]
  );

  const optionsList = (
    <View style={styles.overlay}>
      <Pressable onPress={() => setVisible(false)} style={styles.backdrop} />
      <View style={styles.card}>
        <Text style={styles.title}>Selecciona tu pais</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {options.map((option) => {
            const isSelected = option.country === selectedOption?.country;

            return (
              <Pressable
                key={`${option.country}-${option.code}`}
                onPress={() => {
                  onChange?.(option);
                  setVisible(false);
                }}
                style={[styles.row, isSelected && styles.rowSelected]}
              >
                <Text style={styles.rowFlag}>{option.flag}</Text>
                <View style={styles.rowContent}>
                  <Text style={[styles.rowCountry, isSelected && styles.rowCountrySelected]}>
                    {option.country}
                  </Text>
                  <Text style={styles.rowCode}>{option.code}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );

  return (
    <>
      <Pressable onPress={() => setVisible(true)} style={styles.trigger}>
        <Text style={styles.flag}>{selectedOption?.flag || "🇦🇷"}</Text>
        <Text style={styles.code}>{selectedOption?.code || "+54"}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      {embedded
        ? (visible ? optionsList : null)
        : (
          <Modal animationType="fade" transparent visible={visible}>
            {optionsList}
          </Modal>
        )}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  flag: {
    fontSize: 16,
  },
  code: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  chevron: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "72%",
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  row: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: 16,
    flexDirection: "row",
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  rowFlag: {
    fontSize: 22,
    marginRight: spacing.sm,
  },
  rowContent: {
    flex: 1,
  },
  rowCountry: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  rowCountrySelected: {
    color: colors.primaryDark,
  },
  rowCode: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
});

