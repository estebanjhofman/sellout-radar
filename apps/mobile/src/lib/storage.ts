import AsyncStorage from '@react-native-async-storage/async-storage';

/** Opslag op het toestel. Kan falen (privévenster, volle opslag): dan werkt de app gewoon zonder. */
export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Niet erg: de volgende keer wordt alles opnieuw opgehaald.
  }
}
