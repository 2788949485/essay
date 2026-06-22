import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppSettings } from "../shared/types.js";

export const DEFAULT_HOTKEY = "CommandOrControl+Alt+J";
export const MAX_TEXT_FIELD_LENGTH = 500_000;
export const MAX_PIN_LENGTH = 128;
export const DEFAULT_BACKUP_HISTORY_LIMIT = 80;
export const MAX_BACKUP_HISTORY_LIMIT = 200;

export type StoredSettings = Omit<AppSettings, "hasPrivacyPin" | "storageUnlocked"> & {
  privacyPinHash: string | null;
  privacyPinSalt: string | null;
};

type EncryptedEnvelope = {
  app: "suiji";
  kind: "encrypted";
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
};

export const DEFAULT_SETTINGS: StoredSettings = {
  hotkey: DEFAULT_HOTKEY,
  startHidden: false,
  lockOnHide: true,
  idleLockMinutes: 0,
  backupHistoryEnabled: true,
  backupHistoryLimit: DEFAULT_BACKUP_HISTORY_LIMIT,
  storageEncrypted: false,
  launchAtLogin: false,
  theme: "light",
  fontFamily: "",
  fontSize: 16,
  lineWidth: 880,
  lineHeight: 1.72,
  privacyPinHash: null,
  privacyPinSalt: null
};

function coerceString(value: unknown, fallback = "", maxLength = MAX_TEXT_FIELD_LENGTH) {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxLength);
}

function hashPin(pin: string, salt: string) {
  return createHash("sha256").update(`${salt}:${pin}`).digest("hex");
}

export function hashPinScrypt(pin: string, salt: string) {
  return scryptSync(pin, salt, 64).toString("hex");
}

export function publicSettings(settings: StoredSettings, activePrivacyPin: string | null): AppSettings {
  const storageEncrypted = isStorageEncryptionEnabled(settings);
  return {
    hotkey: settings.hotkey,
    startHidden: settings.startHidden,
    lockOnHide: settings.lockOnHide,
    idleLockMinutes: settings.idleLockMinutes,
    backupHistoryEnabled: settings.backupHistoryEnabled,
    backupHistoryLimit: settings.backupHistoryLimit,
    storageEncrypted,
    storageUnlocked: !storageEncrypted || Boolean(activePrivacyPin),
    launchAtLogin: settings.launchAtLogin,
    theme: settings.theme,
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    lineWidth: settings.lineWidth,
    lineHeight: settings.lineHeight,
    hasPrivacyPin: Boolean(settings.privacyPinHash && settings.privacyPinSalt)
  };
}

export function isStorageEncryptionEnabled(settings: StoredSettings) {
  return Boolean(settings.storageEncrypted && settings.privacyPinHash && settings.privacyPinSalt);
}

export function verifyPin(settings: StoredSettings, pin: string) {
  if (!settings.privacyPinHash || !settings.privacyPinSalt) return true;
  const expected = Buffer.from(settings.privacyPinHash, "hex");
  const candidateHash = expected.length === 32 ? hashPin(pin, settings.privacyPinSalt) : hashPinScrypt(pin, settings.privacyPinSalt);
  const actual = Buffer.from(candidateHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function resolveVerifiedPin(
  settings: StoredSettings,
  suppliedPin: string | undefined,
  activePrivacyPin: string | null,
  allowSessionFallback = true
) {
  const candidate =
    coerceString(suppliedPin, "", MAX_PIN_LENGTH).trim() || (allowSessionFallback ? activePrivacyPin || "" : "");
  if (!candidate || !verifyPin(settings, candidate)) {
    throw new Error("需要先验证当前隐私密码");
  }
  return candidate;
}

export function sanitizeStoredSettings(raw: Partial<StoredSettings>): StoredSettings {
  return {
    hotkey: coerceString(raw.hotkey, DEFAULT_HOTKEY, 120).trim() || DEFAULT_HOTKEY,
    startHidden: Boolean(raw.startHidden),
    lockOnHide: Boolean(raw.lockOnHide),
    idleLockMinutes: Math.min(Math.max(Number(raw.idleLockMinutes) || 0, 0), 240),
    backupHistoryEnabled: raw.backupHistoryEnabled !== false,
    backupHistoryLimit: Math.min(
      Math.max(Number(raw.backupHistoryLimit) || DEFAULT_BACKUP_HISTORY_LIMIT, 1),
      MAX_BACKUP_HISTORY_LIMIT
    ),
    storageEncrypted: Boolean(raw.storageEncrypted),
    launchAtLogin: Boolean(raw.launchAtLogin),
    theme: raw.theme === "dark" ? "dark" : "light",
    fontFamily: coerceString(raw.fontFamily, "", 120),
    fontSize: Math.min(Math.max(Number(raw.fontSize) || 16, 13), 24),
    lineWidth: Math.min(Math.max(Number(raw.lineWidth) || 880, 640), 1200),
    lineHeight: Math.min(Math.max(Number(raw.lineHeight) || 1.72, 1.35), 2.2),
    privacyPinHash: typeof raw.privacyPinHash === "string" ? raw.privacyPinHash : null,
    privacyPinSalt: typeof raw.privacyPinSalt === "string" ? raw.privacyPinSalt : null
  };
}

function deriveStorageKey(pin: string, salt: string) {
  return scryptSync(pin, `${salt}:storage`, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
}

function parseEncryptedEnvelope(raw: Buffer): EncryptedEnvelope | null {
  const text = raw.toString("utf8").trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as Partial<EncryptedEnvelope>;
    if (
      parsed.app !== "suiji" ||
      parsed.kind !== "encrypted" ||
      parsed.version !== 1 ||
      typeof parsed.salt !== "string" ||
      typeof parsed.iv !== "string" ||
      typeof parsed.tag !== "string" ||
      typeof parsed.data !== "string"
    ) {
      return null;
    }
    return parsed as EncryptedEnvelope;
  } catch {
    return null;
  }
}

export function encodeStoredBytes(content: Uint8Array, pin: string | null, salt: string | null, encrypt: boolean) {
  if (!encrypt) return Buffer.from(content);
  if (!pin || !salt) {
    throw new Error("Storage key unavailable");
  }
  const iv = randomBytes(12);
  const key = deriveStorageKey(pin, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(content)), cipher.final()]);
  const envelope: EncryptedEnvelope = {
    app: "suiji",
    kind: "encrypted",
    version: 1,
    salt,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
  return Buffer.from(JSON.stringify(envelope), "utf8");
}

export function decodeStoredBytes(content: Buffer, pin: string | null) {
  const envelope = parseEncryptedEnvelope(content);
  if (!envelope) return content;
  if (!pin) {
    throw new Error("Storage locked");
  }
  const key = deriveStorageKey(pin, envelope.salt);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
}
