import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function AutocompleteField({
  label,
  value,
  placeholder,
  onChangeText,
  suggestions,
  onSelect,
  showSuggestions,
}) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={value}
        />
      </View>

      {showSuggestions ? (
        <View style={styles.suggestionsCard}>
          {suggestions.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => onSelect(item)}
              style={styles.suggestionRow}
            >
              <Text style={styles.suggestionTitle}>{item.value}</Text>
              <Text style={styles.suggestionSubtitle}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: spacing.xs,
  },
  inputWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  input: {
    color: colors.text,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  suggestionsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: "hidden",
  },
  suggestionRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  suggestionSubtitle: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
});
