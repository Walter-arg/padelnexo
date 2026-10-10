import { InputAccessoryView, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

// Los teclados number-pad/phone-pad/decimal-pad de iOS no tienen tecla de
// retorno: sin este boton "Listo" explicito, el teclado queda abierto sin
// forma de cerrarlo. Usar solo en iOS (Platform.OS === "ios") junto con
// inputAccessoryViewID en el/los TextInput correspondientes, pasando el
// mismo nativeID a ambos.
export default function NumericKeyboardDoneBar({ nativeID }) {
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <Pressable onPress={() => Keyboard.dismiss()} style={styles.button}>
          <Text style={styles.buttonText}>Listo</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "flex-end",
    backgroundColor: "#F4F4F4",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  button: {
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  buttonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
});
