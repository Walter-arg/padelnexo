export const ADMIN_EMAIL = "wramirez.arg@gmail.com";

export function isAdminEmail(email = "") {
  return email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
}

export function canAccessAdminPanel(profile = {}) {
  return (
    isAdminEmail(profile.email || "") ||
    profile.role === "admin" ||
    profile.adminStatus === "active"
  );
}

