export const EDAD_MINIMA_MENSAJES = 14;

export function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const parts = String(fechaNacimiento).split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(Number);
  if (!year || !month || !day) return null;
  const today = new Date();
  const birth = new Date(year, month - 1, day);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function esMenorRestringido(fechaNacimiento) {
  if (!fechaNacimiento) return false;
  const age = calcularEdad(fechaNacimiento);
  return age !== null && age < EDAD_MINIMA_MENSAJES;
}

export function formatFechaNacimientoDisplay(fechaNacimiento) {
  if (!fechaNacimiento) return "";
  const parts = String(fechaNacimiento).split("-");
  if (parts.length !== 3) return fechaNacimiento;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function dateToFechaNacimiento(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fechaNacimientoToDate(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const parts = String(fechaNacimiento).split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return null;
  const [year, month, day] = parts;
  // Noon local time to avoid UTC timezone shift (e.g. UTC-3 would shift midnight to prev day)
  return new Date(year, month - 1, day, 12, 0, 0);
}
