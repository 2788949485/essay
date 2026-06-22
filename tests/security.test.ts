import { describe, expect, it } from "vitest";
import {
  CURRENT_PIN_KDF_PARAMS,
  CURRENT_STORAGE_KDF_PARAMS,
  DEFAULT_SETTINGS,
  decodeStoredBytes,
  encodeStoredBytes,
  hashPinScrypt,
  resolveVerifiedPin,
  verifyPin
} from "../src/main/security";

describe("security helpers", () => {
  it("加密内容可以正确往返解密", () => {
    const pin = "123456";
    const salt = "abcdef1234567890";
    const encoded = encodeStoredBytes(Buffer.from("hello", "utf8"), pin, salt, true);
    const envelope = JSON.parse(encoded.toString("utf8"));
    expect(envelope.kdf.N).toBe(CURRENT_STORAGE_KDF_PARAMS.N);
    const decoded = decodeStoredBytes(encoded, pin).toString("utf8");
    expect(decoded).toBe("hello");
  });

  it("明文内容不会被误判为加密", () => {
    const encoded = encodeStoredBytes(Buffer.from("plain", "utf8"), null, null, false);
    const decoded = decodeStoredBytes(encoded, null).toString("utf8");
    expect(decoded).toBe("plain");
  });

  it("可以校验和解析当前 PIN", () => {
    const salt = "salt-1";
    const settings = {
      ...DEFAULT_SETTINGS,
      privacyPinSalt: salt,
      privacyPinHash: hashPinScrypt("2468", salt, CURRENT_PIN_KDF_PARAMS),
      privacyPinKdf: CURRENT_PIN_KDF_PARAMS,
      storageEncrypted: true
    };

    expect(verifyPin(settings, "2468")).toBe(true);
    expect(resolveVerifiedPin(settings, "2468", null, false)).toBe("2468");
  });
});
