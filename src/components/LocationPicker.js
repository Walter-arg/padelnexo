import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { colors, spacing } from "../config/theme";
import locationsData from "../../data/locations.json";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 10;

function normalizeSearchText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LOCAL_LOCATIONS = Array.isArray(locationsData)
  ? locationsData.map((location, index) => ({
      id: `${location?.provincia || "provincia"}-${location?.nombre || "localidad"}-${index}`,
      nombre: location?.nombre || "",
      provincia: location?.provincia || "",
      pais: location?.pais || "Argentina",
      normalizedName: normalizeSearchText(location?.nombre || ""),
      normalizedProvince: normalizeSearchText(location?.provincia || ""),
    }))
  : [];

function searchLocationsLocally(queryText = "") {
  const normalizedQuery = normalizeSearchText(queryText);

  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return [];
  }

  return LOCAL_LOCATIONS.filter((location) => {
    return (
      location.normalizedName.startsWith(normalizedQuery) ||
      `${location.normalizedName} ${location.normalizedProvince}`.startsWith(normalizedQuery)
    );
  })
    .slice(0, MAX_RESULTS)
    .map(({ normalizedName, normalizedProvince, ...location }) => location);
}

export default function LocationPicker({
  label = "Localidad",
  onChangeText,
  onSelect,
  placeholder = "Escribe tu localidad",
  selectedLocation: selectedLocationProp = null,
  value = "",
  containerStyle,
  inputStyle,
  labelStyle,
  sanitizeText,
}) {
  const [inputValue, setInputValue] = useState(value);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [internalSelectedLocation, setInternalSelectedLocation] = useState(null);
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    const nextValue = value || "";
    setInputValue(nextValue);

    if (!nextValue.trim() && !selectedLocationProp) {
      setInternalSelectedLocation(null);
      setShowList(false);
    }
  }, [value, selectedLocationProp]);

  useEffect(() => {
    if (!selectedLocationProp?.nombre) {
      return;
    }

    setInputValue(selectedLocationProp.nombre);
    setInternalSelectedLocation({
      nombre: selectedLocationProp.nombre,
      provincia: selectedLocationProp.provincia || "",
      pais: selectedLocationProp.pais || "Argentina",
    });
    setResults([]);
    setShowList(false);
  }, [selectedLocationProp?.nombre, selectedLocationProp?.pais, selectedLocationProp?.provincia]);

  useEffect(() => {
    if (selectedLocationProp !== null) {
      return;
    }

    setInternalSelectedLocation(null);
  }, [selectedLocationProp]);

  useEffect(() => {
    const trimmedValue = inputValue.trim().toLowerCase();

    if (
      trimmedValue.length < MIN_QUERY_LENGTH ||
      !showList ||
      Boolean(internalSelectedLocation)
    ) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    let isCancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);

        const localResults = searchLocationsLocally(trimmedValue);

        if (localResults.length > 0) {
          if (!isCancelled) {
            setResults(localResults);
          }
          return;
        }

        const locationsQuery = query(
          collection(db, "locations"),
          where("search", "array-contains", trimmedValue),
          limit(MAX_RESULTS)
        );

        const snapshot = await getDocs(locationsQuery);

        if (isCancelled) {
          return;
        }

        const nextResults = snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();

          return {
            id: docSnapshot.id,
            nombre: data.nombre || "",
            provincia: data.provincia || "",
            pais: data.pais || "Argentina",
          };
        });

        setResults(nextResults);
      } catch (error) {
        console.log("[LocationPicker] Error al buscar localidades:", error);
        setResults([]);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [inputValue, internalSelectedLocation, showList]);

  const handleChangeText = (text) => {
    const nextText = sanitizeText ? sanitizeText(text) : text;
    const trimmedText = nextText.trim();

    setInputValue(nextText);
    onChangeText?.(nextText);

    if (internalSelectedLocation) {
      setInternalSelectedLocation(null);
      onSelect?.(null);
    }

    if (trimmedText.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setShowList(false);
      return;
    }

    setShowList(true);
  };

  const handleSelect = (location) => {
    setInputValue(location.nombre);
    setInternalSelectedLocation(location);
    setResults([]);
    setShowList(false);
    onSelect?.({
      nombre: location.nombre,
      provincia: location.provincia,
      pais: location.pais || "Argentina",
    });
  };

  const showResults =
    inputValue.trim().length >= MIN_QUERY_LENGTH &&
    showList &&
    (loading || results.length > 0) &&
    !internalSelectedLocation;

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <Text style={[styles.label, labelStyle]}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          style={[styles.input, inputStyle]}
          value={inputValue}
        />
      </View>

      {showResults ? (
        <View style={styles.resultsCard}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <Text style={styles.loadingText}>Buscando localidades...</Text>
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              style={styles.resultsList}
            >
              {results.map((location, index) => (
                <Pressable
                  key={location.id}
                  onPress={() => handleSelect(location)}
                  style={({ pressed }) => [
                    styles.resultRow,
                    index === results.length - 1 && styles.resultRowLast,
                    pressed && styles.resultRowPressed,
                  ]}
                >
                  <Text style={styles.resultTitle}>{location.nombre}</Text>
                  <Text style={styles.resultSubtitle}>{location.provincia}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
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
    fontSize: 15,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
  },
  resultsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 2,
    maxHeight: 240,
    overflow: "hidden",
  },
  resultsList: {
    maxHeight: 240,
  },
  resultRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultRowLast: {
    borderBottomWidth: 0,
  },
  resultRowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  resultTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  resultSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  loadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
  },
});


