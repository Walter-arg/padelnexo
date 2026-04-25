import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "./BottomQuickActionsBar";
import { colors, spacing } from "../config/theme";

export default function ScreenWrapper({ children, contentStyle, withQuickActions = false }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={[styles.container, withQuickActions && styles.containerWithQuickActions, contentStyle]}>
        {children}
      </View>
      {withQuickActions ? <BottomQuickActionsBar /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  containerWithQuickActions: {
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
  },
});

