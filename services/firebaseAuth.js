export * from "firebase/auth";

const STORAGE_AVAILABLE_KEY = "__padelnexo_firebase_auth_storage_test__";

export function getReactNativePersistence(storage) {
  let ReactNativePersistence = class {
    constructor() {
      this.type = "LOCAL";
    }

    async _isAvailable() {
      try {
        if (!storage) {
          return false;
        }

        await storage.setItem(STORAGE_AVAILABLE_KEY, "1");
        await storage.removeItem(STORAGE_AVAILABLE_KEY);

        return true;
      } catch {
        return false;
      }
    }

    _set(key, value) {
      return storage.setItem(key, JSON.stringify(value));
    }

    async _get(key) {
      const json = await storage.getItem(key);
      return json ? JSON.parse(json) : null;
    }

    _remove(key) {
      return storage.removeItem(key);
    }

    _addListener() {}

    _removeListener() {}
  };

  ReactNativePersistence.type = "LOCAL";

  return ReactNativePersistence;
}

