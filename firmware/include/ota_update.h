#pragma once

#include <cctype>
#include <cstdio>
#include <string>

struct OtaManifest {
  bool valid = false;
  std::string version;
  std::string url;
  std::string sha256;
};

inline bool parseFirmwareVersion(const std::string &value, unsigned int &major,
                                 unsigned int &minor, unsigned int &patch) {
  char trailing = '\0';
  return std::sscanf(value.c_str(), "%u.%u.%u%c", &major, &minor, &patch,
                     &trailing) == 3;
}

inline bool isNewerFirmwareVersion(const std::string &current,
                                   const std::string &candidate) {
  unsigned int currentMajor, currentMinor, currentPatch;
  unsigned int candidateMajor, candidateMinor, candidatePatch;
  if (!parseFirmwareVersion(current, currentMajor, currentMinor, currentPatch) ||
      !parseFirmwareVersion(candidate, candidateMajor, candidateMinor,
                            candidatePatch)) {
    return false;
  }
  if (candidateMajor != currentMajor) return candidateMajor > currentMajor;
  if (candidateMinor != currentMinor) return candidateMinor > currentMinor;
  return candidatePatch > currentPatch;
}

inline bool isSha256Hex(const std::string &value) {
  if (value.size() != 64) return false;
  for (const unsigned char character : value) {
    if (!(std::isdigit(character) || (character >= 'a' && character <= 'f'))) return false;
  }
  return true;
}

inline std::string otaJsonString(const std::string &payload, const std::string &key) {
  const std::string property = "\"" + key + "\"";
  const size_t keyAt = payload.find(property);
  if (keyAt == std::string::npos) return "";
  const size_t colonAt = payload.find(':', keyAt + property.size());
  if (colonAt == std::string::npos) return "";
  const size_t valueStart = payload.find('"', colonAt + 1);
  if (valueStart == std::string::npos) return "";
  const size_t valueEnd = payload.find('"', valueStart + 1);
  if (valueEnd == std::string::npos) return "";
  return payload.substr(valueStart + 1, valueEnd - valueStart - 1);
}

inline OtaManifest parseOtaManifest(const std::string &payload) {
  OtaManifest manifest;
  manifest.version = otaJsonString(payload, "version");
  manifest.url = otaJsonString(payload, "url");
  manifest.sha256 = otaJsonString(payload, "sha256");
  unsigned int major, minor, patch;
  manifest.valid = parseFirmwareVersion(manifest.version, major, minor, patch) &&
                   manifest.url.rfind("https://", 0) == 0 &&
                   isSha256Hex(manifest.sha256);
  return manifest;
}
