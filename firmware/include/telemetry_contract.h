#pragma once

#include <cstdio>
#include <string>

inline std::string escapeJsonString(const std::string &value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (const char character : value) {
    switch (character) {
      case '"': escaped += "\\\""; break;
      case '\\': escaped += "\\\\"; break;
      case '\b': escaped += "\\b"; break;
      case '\f': escaped += "\\f"; break;
      case '\n': escaped += "\\n"; break;
      case '\r': escaped += "\\r"; break;
      case '\t': escaped += "\\t"; break;
      default:
        if (static_cast<unsigned char>(character) < 0x20) {
          char unicodeEscape[7];
          std::snprintf(unicodeEscape, sizeof(unicodeEscape), "\\u%04x",
                        static_cast<unsigned char>(character));
          escaped += unicodeEscape;
        } else {
          escaped += character;
        }
    }
  }
  return escaped;
}

inline std::string formatTemperatureC(double temperatureC) {
  char temperature[24];
  std::snprintf(temperature, sizeof(temperature), "%.2f", temperatureC);
  std::string formatted(temperature);
  formatted.erase(formatted.find_last_not_of('0') + 1);
  if (!formatted.empty() && formatted.back() == '.') formatted.pop_back();
  return formatted;
}

inline std::string buildTelemetryPayload(const std::string &deviceId,
                                         double temperatureC) {
  return "{\"deviceId\":\"" + escapeJsonString(deviceId) +
         "\",\"temperatureC\":" + formatTemperatureC(temperatureC) +
         ",\"sensor\":\"MAX6675\"}";
}
