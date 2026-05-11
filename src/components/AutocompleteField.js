import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import { hasProfileImage } from "../utils/defaultProfileImage";

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
              key={item.key || item.value || item.label}
              onPress={() => onSelect(item)}
              style={styles.suggestionRow}
            >
              {hasProfileImage(item.avatarUri) ? (
                <Image source={{ uri: item.avatarUri }} style={styles.suggestionAvatar} />
              ) : (
                <View style={styles.suggestionAvatarPlaceholder}>
                  <Ionicons color="#9CA3AF" name="person" size={18} />
                </View>
              )}
              <View style={styles.suggestionCopy}>
                <Text style={styles.suggestionTitle}>{item.value}</Text>
                <Text style={styles.suggestionSubtitle}>{item.label}</Text>
              </View>
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
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suggestionAvatar: {
    borderRadius: 20,
    height: 40,
    marginRight: spacing.sm,
    width: 40,
  },
  suggestionAvatarPlaceholder: {
    alignItems: "center",
    backgroundColor: "#E5E7EB",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 40,
  },
  suggestionCopy: {
    flex: 1,
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

