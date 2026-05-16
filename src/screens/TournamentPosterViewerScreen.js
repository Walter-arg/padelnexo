import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import FeedbackModal from "../components/FeedbackModal";
import ReportModal from "../components/ReportModal";
import { useAuth } from "../context/AuthContext";
import { submitReport } from "../services/reportsService";

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const DOUBLE_TAP_DELAY = 280;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getDistanceBetweenTouches(touches = []) {
  if (!Array.isArray(touches) || touches.length < 2) {
    return 0;
  }

  const [firstTouch, secondTouch] = touches;
  const deltaX = Number(secondTouch.pageX || 0) - Number(firstTouch.pageX || 0);
  const deltaY = Number(secondTouch.pageY || 0) - Number(firstTouch.pageY || 0);

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

export default function TournamentPosterViewerScreen({ navigation, route }) {
  const { userData } = useAuth();
  const posterUrl = route?.params?.posterUrl || "";
  const tournamentName = route?.params?.tournamentName || "Torneo";
  const tournamentId = route?.params?.tournamentId || "";
  const organizerId = route?.params?.organizerId || "";
  const organizerName = route?.params?.organizerName || "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scaleValueRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const pinchStartDistanceRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const isPinchingRef = useRef(false);
  const lastTapRef = useRef(0);

  const resetTransform = () => {
    scaleValueRef.current = 1;
    translateRef.current = { x: 0, y: 0 };
    panOffsetRef.current = { x: 0, y: 0 };

    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const animateToScale = (nextScale) => {
    const normalizedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    scaleValueRef.current = normalizedScale;

    if (normalizedScale <= 1) {
      translateRef.current = { x: 0, y: 0 };
      panOffsetRef.current = { x: 0, y: 0 };
    }

    Animated.parallel([
      Animated.spring(scale, {
        toValue: normalizedScale,
        useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: normalizedScale <= 1 ? 0 : translateRef.current.x,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: normalizedScale <= 1 ? 0 : translateRef.current.y,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !isPinchingRef.current &&
          scaleValueRef.current > 1 &&
          (Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4),
        onPanResponderGrant: () => {
          panOffsetRef.current = { ...translateRef.current };
        },
        onPanResponderMove: (_, gestureState) => {
          if (scaleValueRef.current <= 1) {
            return;
          }

          const maxOffset = 140 * Math.max(scaleValueRef.current - 1, 0.45);
          const nextTranslateX = clamp(
            panOffsetRef.current.x + gestureState.dx,
            -maxOffset,
            maxOffset
          );
          const nextTranslateY = clamp(
            panOffsetRef.current.y + gestureState.dy,
            -maxOffset,
            maxOffset
          );

          translateRef.current = { x: nextTranslateX, y: nextTranslateY };
          translateX.setValue(nextTranslateX);
          translateY.setValue(nextTranslateY);
        },
        onPanResponderRelease: () => {
          panOffsetRef.current = { ...translateRef.current };
        },
        onPanResponderTerminationRequest: () => true,
      }),
    [scale, translateX, translateY]
  );

  const handleTouchStart = (event) => {
    const touches = event?.nativeEvent?.touches || [];

    if (touches.length >= 2) {
      isPinchingRef.current = true;
      pinchStartDistanceRef.current = getDistanceBetweenTouches(touches);
      pinchStartScaleRef.current = scaleValueRef.current;
      return;
    }

    if (touches.length === 1 && !isPinchingRef.current) {
      const now = Date.now();

      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        if (scaleValueRef.current > 1) {
          resetTransform();
        } else {
          animateToScale(2);
        }
      }

      lastTapRef.current = now;
    }
  };

  const handleTouchMove = (event) => {
    const touches = event?.nativeEvent?.touches || [];

    if (touches.length < 2 || !isPinchingRef.current) {
      return;
    }

    const nextDistance = getDistanceBetweenTouches(touches);

    if (!pinchStartDistanceRef.current || !nextDistance) {
      return;
    }

    const nextScale =
      pinchStartScaleRef.current * (nextDistance / pinchStartDistanceRef.current);
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);

    scaleValueRef.current = clampedScale;
    scale.setValue(clampedScale);

    if (clampedScale <= 1) {
      translateRef.current = { x: 0, y: 0 };
      translateX.setValue(0);
      translateY.setValue(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isPinchingRef.current) {
      return;
    }

    isPinchingRef.current = false;
    pinchStartDistanceRef.current = 0;
    pinchStartScaleRef.current = scaleValueRef.current;

    if (scaleValueRef.current <= 1.02) {
      resetTransform();
      return;
    }

    animateToScale(scaleValueRef.current);
  };

  const handleSubmitPosterReport = async (description) => {
    if (!userData?.uid || !posterUrl) {
      return;
    }

    try {
      setSubmittingReport(true);
      await submitReport({
        reporter: userData,
        targetType: "tournament_poster",
        targetId: tournamentId || posterUrl,
        targetTitle: tournamentName,
        description,
        metadata: {
          posterUrl,
          tournamentId,
          reportedUserId: organizerId,
          reportedUserName: organizerName,
        },
      });
      setReportVisible(false);
      setFeedback({
        visible: true,
        title: "Reporte enviado",
        message: "Gracias. El equipo administrador lo va a revisar.",
        tone: "default",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos enviar el reporte",
        message: "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Pressable
        onPress={() => navigation.goBack()}
        style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
      >
        <Ionicons color={colors.primaryDark} name="chevron-back" size={20} />
      </Pressable>
      {posterUrl ? (
        <Pressable
          onPress={() => setReportVisible(true)}
          style={({ pressed }) => [styles.reportButton, pressed ? styles.backButtonPressed : null]}
        >
          <Ionicons color="#C45B00" name="flag-outline" size={18} />
        </Pressable>
      ) : null}

      <View style={styles.container}>
        {!posterUrl ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No encontramos el afiche</Text>
            <Text style={styles.emptyText}>Este torneo no tiene una imagen disponible.</Text>
          </View>
        ) : (
          <View style={styles.posterCard}>
            {loading ? (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator color={colors.primaryDark} />
                <Text style={styles.loaderText}>Cargando afiche...</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No pudimos mostrar el afiche</Text>
                <Text style={styles.emptyText}>Intenta nuevamente en unos instantes.</Text>
              </View>
            ) : (
              <View
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchMove}
                onTouchStart={handleTouchStart}
                style={styles.posterTouchArea}
              >
                <Animated.View
                  {...panResponder.panHandlers}
                  style={[
                    styles.posterAnimatedWrap,
                    {
                      transform: [{ translateX }, { translateY }, { scale }],
                    },
                  ]}
                >
                  <Image
                    onError={() => {
                      setLoading(false);
                      setError(true);
                    }}
                    onLoadEnd={() => setLoading(false)}
                    source={{ uri: posterUrl }}
                    style={styles.posterImage}
                  />
                </Animated.View>
              </View>
            )}
          </View>
        )}
      </View>
      <ReportModal
        onCancel={() => setReportVisible(false)}
        onSubmit={handleSubmitPosterReport}
        submitting={submittingReport}
        targetLabel={tournamentName}
        title="Reportar afiche"
        visible={reportVisible}
      />
      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
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
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    left: spacing.md,
    position: "absolute",
    top: 56,
    width: 40,
    zIndex: 2,
  },
  backButtonPressed: {
    opacity: 0.86,
  },
  reportButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,243,224,0.96)",
    borderColor: "#FFB866",
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    top: 56,
    width: 40,
    zIndex: 2,
  },
  posterCard: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    width: "100%",
  },
  posterTouchArea: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  posterAnimatedWrap: {
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
  },
  posterImage: {
    resizeMode: "contain",
    height: "100%",
    width: "100%",
  },
  loaderOverlay: {
    alignItems: "center",
    bottom: 0,
    gap: spacing.xs,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  loaderText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
