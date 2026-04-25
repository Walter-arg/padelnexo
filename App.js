import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import { colors, spacing } from "./src/config/theme";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
      info: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    console.log("[RootErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.title}>PadelNexo encontro un error</Text>
            <Text style={styles.subtitle}>
              Esta pantalla nos ayuda a ver exactamente que esta fallando en el build.
            </Text>

            <View style={styles.block}>
              <Text style={styles.blockLabel}>Mensaje</Text>
              <Text style={styles.blockText}>
                {String(this.state.error?.message || this.state.error || "Error desconocido")}
              </Text>
            </View>

            {this.state.error?.stack ? (
              <View style={styles.block}>
                <Text style={styles.blockLabel}>Stack</Text>
                <Text style={styles.stackText}>{String(this.state.error.stack)}</Text>
              </View>
            ) : null}

            {this.state.info?.componentStack ? (
              <View style={styles.block}>
                <Text style={styles.blockLabel}>Componente</Text>
                <Text style={styles.stackText}>{String(this.state.info.componentStack)}</Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
}

export default function App() {
  return (
    <RootErrorBoundary>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  block: {
    marginTop: spacing.lg,
  },
  blockLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  blockText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  stackText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
});
