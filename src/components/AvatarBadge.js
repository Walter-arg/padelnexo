import { Image, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { hasProfileImage } from "../utils/defaultProfileImage";

export default function AvatarBadge({
  color,
  size = 42,
  uri,
}) {
  const hasImage = hasProfileImage(uri);

  return (
    <View
      style={[
        styles.avatar,
        {
          backgroundColor: color || "#D1D5DB",
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      {hasImage ? (
        <Image
          source={{ uri }}
          style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            {
              width: size - 4,
              height: size - 4,
              borderRadius: (size - 4) / 2,
            },
          ]}
        >
          <Ionicons color="#9CA3AF" name="person" size={size * 0.54} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.6)",
    borderWidth: 2,
    justifyContent: "center",
  },
  placeholder: {
    alignItems: "center",
    backgroundColor: "#E5E7EB",
    justifyContent: "center",
  },
});

