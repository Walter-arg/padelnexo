import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import AppButton from "../components/AppButton";
import ScreenWrapper from "../components/ScreenWrapper";
import { ADMIN_EMAIL, isAdminEmail } from "../config/admin";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  approveOrganizerRequest,
  listOrganizerRequests,
  rejectOrganizerRequest,
} from "../services/organizerService";

export default function AdminScreen() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  const canAccessAdmin = isAdminEmail(user?.email || "");

  const loadRequests = async () => {
    setLoading(true);

    try {
      const organizerRequests = await listOrganizerRequests();
      setRequests(organizerRequests);
    } catch (error) {
      Alert.alert("No pudimos cargar solicitudes", error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canAccessAdmin) {
      loadRequests();
    } else {
      setLoading(false);
    }
  }, [canAccessAdmin]);

  const handleApprove = async () => {
    if (!selectedRequest) {
      return;
    }

    try {
      await approveOrganizerRequest(selectedRequest.userId);
      Alert.alert("Solicitud aprobada", "El organizador ya quedo habilitado.");
      setSelectedRequest(null);
      loadRequests();
    } catch (error) {
      Alert.alert("No pudimos aprobar", error.message);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) {
      return;
    }

    try {
      await rejectOrganizerRequest(selectedRequest.userId);
      Alert.alert("Solicitud rechazada", "La solicitud fue marcada como rechazada.");
      setSelectedRequest(null);
      loadRequests();
    } catch (error) {
      Alert.alert("No pudimos rechazar", error.message);
    }
  };

  if (!canAccessAdmin) {
    return (
      <ScreenWrapper>
        <View style={styles.card}>
          <Text style={styles.title}>Panel Admin</Text>
          <Text style={styles.subtitle}>
            Esta pantalla esta reservada para {ADMIN_EMAIL}.
          </Text>
        </View>
      </ScreenWrapper>
    );
  }

  const renderRequestItem = ({ item }) => (
    <Pressable
      onPress={() => setSelectedRequest(item)}
      style={({ pressed }) => [
        styles.requestCard,
        pressed && styles.requestCardPressed,
      ]}
    >
      <View style={styles.requestTopRow}>
        <Text style={styles.requestName}>{item.nombre}</Text>
        <Text style={styles.statusBadge}>{item.status}</Text>
      </View>
      <Text style={styles.requestMeta}>DNI: {item.dni}</Text>
      <Text style={styles.requestMeta}>Telefono: {item.telefono}</Text>
      <Text style={styles.requestMeta}>Complejos: {item.complejos?.length || 0}</Text>
    </Pressable>
  );

  return (
    <>
      <ScreenWrapper>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Solicitudes de organizador</Text>
              <Text style={styles.subtitle}>
                Revisa complejos, datos de contacto y aprueba desde la app.
              </Text>
            </View>
            <AppButton
              title="Actualizar"
              onPress={loadRequests}
              style={styles.refreshButton}
              variant="secondary"
            />
          </View>

          <FlatList
            contentContainerStyle={styles.listContent}
            data={requests}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {loading ? "Cargando solicitudes..." : "No hay solicitudes para revisar."}
              </Text>
            }
            renderItem={renderRequestItem}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </ScreenWrapper>

      <Modal animationType="slide" transparent visible={Boolean(selectedRequest)}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setSelectedRequest(null)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Detalle de solicitud</Text>

            {selectedRequest ? (
              <ScrollView
                contentContainerStyle={styles.modalContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Nombre</Text>
                  <Text style={styles.detailValue}>{selectedRequest.nombre}</Text>
                  <Text style={styles.detailLabel}>DNI</Text>
                  <Text style={styles.detailValue}>{selectedRequest.dni}</Text>
                  <Text style={styles.detailLabel}>Telefono</Text>
                  <Text style={styles.detailValue}>{selectedRequest.telefono}</Text>
                </View>

                {(selectedRequest.complejos || []).map((complex, index) => (
                  <View key={`${complex.nombre}-${index}`} style={styles.detailCard}>
                    <Text style={styles.complexTitle}>Complejo {index + 1}</Text>
                    <Text style={styles.detailValue}>{complex.nombre}</Text>
                    <Text style={styles.detailMeta}>Blindex: {complex.blindex}</Text>
                    <Text style={styles.detailMeta}>
                      Cemento con cesped sintetico: {complex.cesped}
                    </Text>
                    <Text style={styles.detailMeta}>
                      Cemento piso de cemento: {complex.cemento}
                    </Text>
                    <Text style={styles.detailMeta}>
                      Total de canchas: {complex.totalCanchas}
                    </Text>
                    <Text style={styles.detailAddress}>{complex.direccion}</Text>
                  </View>
                ))}

                <View style={styles.modalActions}>
                  <AppButton title="Aprobar" onPress={handleApprove} style={styles.compactButton} />
                  <AppButton
                    title="Rechazar"
                    onPress={handleReject}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                  <AppButton
                    title="Cerrar"
                    onPress={() => setSelectedRequest(null)}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    flex: 1,
    padding: spacing.lg,
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  refreshButton: {
    marginBottom: 0,
    minHeight: 48,
    paddingVertical: 12,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  requestCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  requestCardPressed: {
    opacity: 0.92,
  },
  requestTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  requestName: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    marginRight: spacing.sm,
  },
  statusBadge: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  requestMeta: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "90%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  modalContent: {
    paddingBottom: spacing.sm,
  },
  detailCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  detailValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  complexTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  detailMeta: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  detailAddress: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  modalActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  compactButton: {
    marginBottom: 0,
    minHeight: 48,
    paddingVertical: 12,
  },
});
