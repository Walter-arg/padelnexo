import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "../../services/firebaseAuth";

import { auth } from "../../services/firebaseConfig";
import {
  deleteCurrentUserAccount,
  loginWithGoogleIdToken,
  loginUser,
  logoutUser,
  registerUser,
  resetPassword,
} from "../services/authService";
import {
  createUserProfile,
  deleteUserProfileData,
  getUserProfile,
  hideUserProfile,
  recordUserLogin,
  removeUserProfilePhoto,
  updateUserProfile,
} from "../services/userService";
import {
  submitComplexRequest as persistComplexRequest,
  submitOrganizerRequest,
  updateOrganizerComplexes as persistOrganizerComplexes,
} from "../services/organizerService";
import {
  getOrganizerRestrictionMessage,
  isApprovedOrganizer,
  isPendingOrganizer,
} from "../services/roleService";
import { registerForPushNotificationsAsync } from "../services/pushNotificationsService";

const AuthContext = createContext(null);
const LAST_LOGIN_EMAIL_KEY = "@padelnexo:last-login-email";

const FALLBACK_PROFILE = {
  name: "Jugador",
  email: "",
  phone: "",
  countryCode: "+54",
  phoneCountry: "Argentina",
  isPhonePublic: false,
  category: "Iniciante",
  sex: "Masculino",
  manoHabil: "",
  description: "",
  avatarUrl: "",
  organizerLogoUrl: "",
  avatarColor: undefined,
  city: "Buenos Aires",
  province: "Buenos Aires",
  localidad: {
    nombre: "Buenos Aires",
    provincia: "Buenos Aires",
    pais: "Argentina",
  },
  role: "user",
  organizerStatus: "none",
  availability: {},
  availabilityDays: [],
  complejos: [],
  location: {
    ciudad: "Buenos Aires",
    provincia: "Buenos Aires",
    pais: "Argentina",
    lat: null,
    lng: null,
  },
  createdAt: null,
};

function getAccountBlockMessage(profile = {}) {
  if (profile?.blockStatus === "temporary") {
    const blockedUntilMillis = Number(profile.blockedUntilMillis || 0);

    if (blockedUntilMillis && blockedUntilMillis <= Date.now()) {
      return "";
    }

    return "Tu cuenta se encuentra bloqueada por 7 dias por acciones impropias.";
  }

  if (
    profile?.blockStatus === "indefinite" ||
    (profile?.role === "blocked" && profile?.blockStatus !== "temporary")
  ) {
    return "Tu cuenta fue bloqueada por acciones impropias.";
  }

  if (profile?.accountDeleted) {
    return "Esta cuenta no se encuentra disponible.";
  }

  return "";
}

async function assertProfileCanAccess(profile = {}) {
  const blockMessage = getAccountBlockMessage(profile);

  if (!blockMessage) {
    return;
  }

  await logoutUser().catch(() => {});
  throw new Error(blockMessage);
}

function buildMissingProfilePayload(email = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const emailPrefix = normalizedEmail.split("@")[0] || FALLBACK_PROFILE.name;
  const normalizedName = emailPrefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return {
    name: normalizedName || FALLBACK_PROFILE.name,
    email: normalizedEmail,
    phone: FALLBACK_PROFILE.phone,
    countryCode: FALLBACK_PROFILE.countryCode,
    phoneCountry: FALLBACK_PROFILE.phoneCountry,
    isPhonePublic: FALLBACK_PROFILE.isPhonePublic,
    category: FALLBACK_PROFILE.category,
    sex: FALLBACK_PROFILE.sex,
    manoHabil: FALLBACK_PROFILE.manoHabil,
    ladoJuego: "ambos",
    description: FALLBACK_PROFILE.description,
    avatarUrl: FALLBACK_PROFILE.avatarUrl,
    organizerLogoUrl: FALLBACK_PROFILE.organizerLogoUrl,
    avatarColor: FALLBACK_PROFILE.avatarColor,
    city: FALLBACK_PROFILE.city,
    province: FALLBACK_PROFILE.province,
    country: FALLBACK_PROFILE.location.pais,
    localidad: FALLBACK_PROFILE.localidad,
    availability: FALLBACK_PROFILE.availability,
  };
}

function buildGoogleProfilePayload(firebaseUser = {}) {
  const email = firebaseUser.email || "";
  const fallbackProfile = buildMissingProfilePayload(email);

  return {
    ...fallbackProfile,
    name: firebaseUser.displayName || fallbackProfile.name,
    avatarUrl: firebaseUser.photoURL || "",
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [lastLoginEmail, setLastLoginEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const lastRegisteredPushUidRef = useRef("");

  const persistLastLoginEmail = async (email) => {
    const normalizedEmail = (email || "").trim().toLowerCase();

    if (!normalizedEmail) {
      return;
    }

    setLastLoginEmail(normalizedEmail);
    await AsyncStorage.setItem(LAST_LOGIN_EMAIL_KEY, normalizedEmail);
  };

  useEffect(() => {
    let isMounted = true;

    AsyncStorage.getItem(LAST_LOGIN_EMAIL_KEY)
      .then((storedEmail) => {
        if (isMounted && storedEmail) {
          setLastLoginEmail(storedEmail);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        setUserData(null);
        setLoading(false);
        return;
      }

      try {
        if (firebaseUser.email) {
          await persistLastLoginEmail(firebaseUser.email);
        }

        let profile = await getUserProfile(firebaseUser.uid, firebaseUser.email || "");

        if (!profile && firebaseUser.email) {
          profile = await createUserProfile(
            firebaseUser.uid,
            buildMissingProfilePayload(firebaseUser.email)
          );
        }

        try {
          await assertProfileCanAccess(profile);
        } catch (error) {
          if (isMounted) {
            setUser(null);
            setUserData(null);
          }
          return;
        }

        await recordUserLogin(firebaseUser.uid).catch(() => {});

        setUserData(
          profile || {
            uid: firebaseUser.uid,
            ...FALLBACK_PROFILE,
            email: firebaseUser.email || "",
            name: firebaseUser.email?.split("@")[0] || FALLBACK_PROFILE.name,
          }
        );
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const uid = userData?.uid || user?.uid || "";

    if (!uid || lastRegisteredPushUidRef.current === uid || userData?.accountDeleted) {
      return;
    }

    lastRegisteredPushUidRef.current = uid;
    registerForPushNotificationsAsync(uid).catch((error) => {
      console.log("[AuthContext] No se pudo registrar push token:", error?.message || error);
    });
  }, [user?.uid, userData?.accountDeleted, userData?.uid]);

  const value = useMemo(
    () => ({
      user,
      userData,
      lastLoginEmail,
      loading,
      register: async (payload) => {
        setLoading(true);

        try {
          const credentials = await registerUser(payload.email, payload.password);
          const profile = await createUserProfile(credentials.user.uid, payload);
          await persistLastLoginEmail(payload.email);

          setUser(credentials.user);
          setUserData(profile);

          return {
            user: credentials.user,
            profile,
          };
        } finally {
          setLoading(false);
        }
      },
      login: async ({ email, password }) => {
        setLoading(true);

        try {
          const credentials = await loginUser(email, password);
          let profile = await getUserProfile(credentials.user.uid, email);

          if (!profile) {
            profile = await createUserProfile(
              credentials.user.uid,
              buildMissingProfilePayload(email)
            );
          }

          await assertProfileCanAccess(profile);

          await persistLastLoginEmail(email);

          setUser(credentials.user);
          setUserData(
            profile || {
              uid: credentials.user.uid,
              ...FALLBACK_PROFILE,
              email,
              name: email.split("@")[0] || FALLBACK_PROFILE.name,
            }
          );

          return credentials.user;
        } finally {
          setLoading(false);
        }
      },
      loginWithGoogle: async (idToken) => {
        setLoading(true);

        try {
          const credentials = await loginWithGoogleIdToken(idToken);
          const googleUser = credentials.user;
          const email = googleUser.email || "";
          let profile = await getUserProfile(googleUser.uid, email);

          if (!profile) {
            profile = await createUserProfile(
              googleUser.uid,
              buildGoogleProfilePayload(googleUser)
            );
          }

          await assertProfileCanAccess(profile);

          if (email) {
            await persistLastLoginEmail(email);
          }

          setUser(googleUser);
          setUserData(profile);

          return googleUser;
        } finally {
          setLoading(false);
        }
      },
      logout: async () => {
        setLoading(true);

        try {
          await logoutUser();
          setUser(null);
          setUserData(null);
        } finally {
          setLoading(false);
        }
      },
      sendResetPassword: async (email) => {
        await resetPassword(email);
      },
      refreshUserData: async () => {
        if (!auth.currentUser) {
          return null;
        }

        const profile = await getUserProfile(
          auth.currentUser.uid,
          auth.currentUser.email || ""
        );

        setUserData(profile);

        return profile;
      },
      updateProfile: async (updates) => {
        if (!auth.currentUser) {
          throw new Error("No hay una sesion activa.");
        }

        setLoading(true);

        try {
          const profile = await updateUserProfile(auth.currentUser.uid, {
            ...updates,
            email: auth.currentUser.email || "",
          });

          setUserData(profile);

          return profile;
        } finally {
          setLoading(false);
        }
      },
      removeProfilePhoto: async () => {
        if (!auth.currentUser) {
          throw new Error("No hay una sesion activa.");
        }

        setLoading(true);

        try {
          const profile = await removeUserProfilePhoto(auth.currentUser.uid);
          setUserData(profile);
          return profile;
        } finally {
          setLoading(false);
        }
      },
      deleteAccount: async () => {
        if (!auth.currentUser) {
          throw new Error("No hay una sesion activa.");
        }

        setLoading(true);

        try {
          const uid = auth.currentUser.uid;
          await hideUserProfile(uid);
          await deleteCurrentUserAccount();
          await deleteUserProfileData(uid);
          setUser(null);
          setUserData(null);
        } catch (error) {
          try {
            if (auth.currentUser?.uid) {
              await updateUserProfile(auth.currentUser.uid, {
                accountDeleted: false,
              });
            }
          } catch (revertError) {
            console.log("[AuthContext] No se pudo revertir accountDeleted:", revertError);
          }

          throw error;
        } finally {
          setLoading(false);
        }
      },
      submitOrganizerRequest: async (payload) => {
        if (!auth.currentUser) {
          throw new Error("No hay una sesion activa.");
        }

        setLoading(true);

        try {
          await submitOrganizerRequest(auth.currentUser.uid, payload);
          const profile = await getUserProfile(
            auth.currentUser.uid,
            auth.currentUser.email || ""
          );

          setUserData(profile);

          return profile;
        } finally {
          setLoading(false);
        }
      },
      updateOrganizerComplexes: async (complejos) => {
        if (!auth.currentUser) {
          throw new Error("No hay una sesion activa.");
        }

        setLoading(true);

        try {
          await persistOrganizerComplexes(auth.currentUser.uid, complejos);
          const profile = await getUserProfile(
            auth.currentUser.uid,
            auth.currentUser.email || ""
          );

          setUserData(profile);

          return profile;
        } finally {
          setLoading(false);
        }
      },
      submitComplexRequest: async (complejos) => {
        if (!auth.currentUser) {
          throw new Error("No hay una sesion activa.");
        }

        setLoading(true);

        try {
          return await persistComplexRequest(auth.currentUser.uid, {
            complejos,
            organizerName: userData?.name || "",
            organizerEmail: auth.currentUser.email || "",
          });
        } finally {
          setLoading(false);
        }
      },
      isApprovedOrganizer: () => isApprovedOrganizer(userData),
      isOrganizerPending: () => isPendingOrganizer(userData),
      canAccessOrganizerFeatures: () => isApprovedOrganizer(userData),
      getOrganizerAccessMessage: () => getOrganizerRestrictionMessage(userData),
    }),
    [lastLoginEmail, loading, user, userData]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider.");
  }

  return context;
}

