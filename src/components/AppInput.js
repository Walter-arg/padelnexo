import { useId } from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, spacing } from "../config/theme";

// Los teclados number-pad/phone-pad/decimal-pad de iOS no tienen tecla de
// retorno: sin un boton "Listo" explicito, el teclado queda abierto sin
// forma de cerrarlo.
const KEYBOARD_TYPES_WITHOUT_RETURN_KEY = ["number-pad", "phone-pad", "decimal-pad"];

export default function AppInput({
  label,
  helperText,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = "default",
  autoCapitalize = "none",
  containerStyle,
  inputStyle,
  labelStyle,
  leftElement,
  rightElement,
  ...props
}) {
  const accessoryId = `appInputDone-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const needsDoneAccessory =
    Platform.OS === "ios" && KEYBOARD_TYPES_WITHOUT_RETURN_KEY.includes(keyboardType);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <Text style={[styles.label, labelStyle]}>{label}</Text>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      <View style={styles.inputWrap}>
        {leftElement ? <View style={styles.leftElement}>{leftElement}</View> : null}
        <TextInput
          autoCapitalize={autoCapitalize}
          editable={props.editable}
          inputAccessoryViewID={needsDoneAccessory ? accessoryId : undefined}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={secureTextEntry}
          style={[
            styles.input,
            props.editable === false ? styles.disabledInput : null,
            leftElement ? styles.inputWithLeftElement : null,
            rightElement ? styles.inputWithRightElement : null,
            inputStyle,
          ]}
          value={value}
          {...props}
        />
        {rightElement ? <View style={styles.rightElement}>{rightElement}</View> : null}
      </View>
      {needsDoneAccessory ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={styles.doneAccessoryBar}>
            <Pressable onPress={() => Keyboard.dismiss()} style={styles.doneAccessoryButton}>
              <Text style={styles.doneAccessoryButtonText}>Listo</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 6,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  helperText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 2,
    marginTop: -1,
    textAlign: "center",
  },
  inputWrap: {
    justifyContent: "center",
    position: "relative",
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    fontSize: 16,
    color: colors.text,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  inputWithRightElement: {
    paddingRight: 52,
  },
  disabledInput: {
    textAlignVertical: "center",
  },
  inputWithLeftElement: {
    paddingLeft: 88,
  },
  leftElement: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 14,
    position: "absolute",
    top: 0,
    zIndex: 1,
  },
  rightElement: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    position: "absolute",
    right: 14,
    top: 0,
  },
  doneAccessoryBar: {
    alignItems: "flex-end",
    backgroundColor: "#F4F4F4",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  doneAccessoryButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  doneAccessoryButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
});

