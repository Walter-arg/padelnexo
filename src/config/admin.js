export const ADMIN_EMAIL = "wramirez.arg@gmail.com";

export function isAdminEmail(email = "") {
  return email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
}

