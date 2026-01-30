export function maskEmail(email: string) {
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  const start = name.slice(0, 2);
  return `${start}${"*".repeat(Math.max(3, name.length - 2))}@${domain}`;
}

export function maskMobile(mobile: string) {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 4) return "******";
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
}
