function normalizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d]/g, "");
}

export function buildWhatsAppPhoneNumber(phone = "", countryCode = "+54") {
  const phoneDigits = normalizePhoneNumber(phone);
  const countryDigits = normalizePhoneNumber(countryCode || "+54") || "54";

  if (!phoneDigits) {
    return "";
  }

  if (phoneDigits.startsWith(countryDigits)) {
    return countryDigits === "54" && !phoneDigits.startsWith("549")
      ? `549${phoneDigits.slice(2)}`
      : phoneDigits;
  }

  if (countryDigits === "54") {
    const localDigits = phoneDigits.replace(/^0+/, "").replace(/^15/, "");

    return localDigits.startsWith("9") ? `54${localDigits}` : `549${localDigits}`;
  }

  return `${countryDigits}${phoneDigits.replace(/^0+/, "")}`;
}
