import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, spacing } from "../config/theme";
import BallButton from "./BallButton";

const ITEM_SIZE = 188;

const SLOT_LAYOUT = [
  { x: 0, y: 0, scale: 1, opacity: 1, dim: 0, zIndex: 40 },
  { x: 124, y: 28, scale: 0.8, opacity: 0.75, dim: 0.26, zIndex: 25 },
  { x: 0, y: 58, scale: 0.64, opacity: 0.5, dim: 0.42, zIndex: 10 },
  { x: -124, y: 28, scale: 0.8, opacity: 0.75, dim: 0.26, zIndex: 30 },
];

const normalizeIndex = (value, length) => ((value % length) + length) % length;

const getSlot = (itemIndex, activeIndex, length) => {
  const rawRelative = normalizeIndex(itemIndex - activeIndex, length);
  const slotIndex = rawRelative % SLOT_LAYOUT.length;
  return SLOT_LAYOUT[slotIndex];
};

export default function CircularMenu({ items, onItemPress, onSelectionChange }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const transition = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (items.length > 0) {
      onSelectionChange?.(items[activeIndex], activeIndex);
    }
  }, [activeIndex, items, onSelectionChange]);

  const rotateToIndex = (targetIndex) => {
    if (isAnimating || items.length === 0) {
      return;
    }

    const safeIndex = normalizeIndex(targetIndex, items.length);
    if (safeIndex === activeIndex) {
      return;
    }

    setPreviousIndex(activeIndex);
    setActiveIndex(safeIndex);
    setIsAnimating(true);
    transition.setValue(0);

    Animated.timing(transition, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setIsAnimating(false);
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
          Math.abs(gestureState.dx) > 10,
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx < -34) {
            rotateToIndex(activeIndex + 1);
            return;
          }

          if (gestureState.dx > 34) {
            rotateToIndex(activeIndex - 1);
          }
        },
      }),
    [activeIndex, items.length, isAnimating]
  );

  return (
    <View style={styles.wrapper}>
      <View style={styles.sphereStage} {...panResponder.panHandlers}>
        {items.map((item, index) => {
          const fromSlot = getSlot(index, previousIndex, items.length);
          const toSlot = getSlot(index, activeIndex, items.length);
          const isSelected = index === activeIndex;

          const translateX = transition.interpolate({
            inputRange: [0, 1],
            outputRange: [fromSlot.x, toSlot.x],
          });

          const translateY = transition.interpolate({
            inputRange: [0, 1],
            outputRange: [fromSlot.y, toSlot.y],
          });

          const scale = transition.interpolate({
            inputRange: [0, 1],
            outputRange: [fromSlot.scale, toSlot.scale],
          });

          const opacity = transition.interpolate({
            inputRange: [0, 1],
            outputRange: [fromSlot.opacity, toSlot.opacity],
          });

          const dimOpacity = transition.interpolate({
            inputRange: [0, 1],
            outputRange: [fromSlot.dim, toSlot.dim],
          });

          return (
            <Animated.View
              key={item.key}
              style={[
                styles.itemLayer,
                {
                  zIndex: toSlot.zIndex,
                  opacity,
                  transform: [{ perspective: 1100 }, { translateX }, { translateY }, { scale }],
                },
              ]}
            >
              <View style={isSelected ? styles.focusRing : styles.focusRingOff}>
                <BallButton
                  compact
                  label={item.label}
                  onPress={() => {
                    if (isSelected) {
                      onItemPress(item);
                      return;
                    }

                    rotateToIndex(index);
                  }}
                  size={ITEM_SIZE}
                  subtitle={item.subtitle}
                />
                <Animated.View pointerEvents="none" style={[styles.dimLayer, { opacity: dimOpacity }]} />
              </View>
            </Animated.View>
          );
        })}
      </View>

      <Text style={styles.swipeHint}>Desliza para rotar la esfera</Text>

      <View style={styles.dotRow}>
        {items.map((item, index) => (
          <View
            key={item.key}
            style={[styles.dot, index === activeIndex && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
    backgroundColor: "transparent",
    overflow: "visible",
    paddingTop: spacing.sm,
  },
  sphereStage: {
    alignItems: "center",
    backgroundColor: "transparent",
    height: ITEM_SIZE + 92,
    justifyContent: "flex-start",
    overflow: "visible",
    width: "100%",
  },
  itemLayer: {
    alignItems: "center",
    backgroundColor: "transparent",
    left: "50%",
    marginLeft: -ITEM_SIZE / 2,
    overflow: "visible",
    position: "absolute",
    top: 0,
    width: ITEM_SIZE,
  },
  focusRing: {
    backgroundColor: "transparent",
    borderColor: "rgba(255,255,255,0.88)",
    borderRadius: 999,
    borderWidth: 2,
    overflow: "visible",
  },
  focusRingOff: {
    backgroundColor: "transparent",
    borderRadius: 999,
    overflow: "visible",
  },
  dimLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(28, 66, 46, 0.62)",
    borderRadius: 999,
  },
  swipeHint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  dotRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: spacing.sm,
  },
  dot: {
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 7,
    marginHorizontal: 4,
    width: 7,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 18,
  },
});
