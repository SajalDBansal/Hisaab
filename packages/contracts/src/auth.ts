import { z } from "zod";
import { Email, Id, IsoDateTime, requiredText } from "./common";

/**
 * Indian mobile number to its stored form: "98370 45120", "09837045120" and
 * "+91 98370 45120" all become "+919837045120". Returns null if it isn't a valid mobile.
 */
export function normalizeMobile(input: string): string | null {
  let digits = input.replace(/[\s\-()]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("91") && digits.length === 12)
    digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11)
    digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export const Mobile = z
  .string("Enter your mobile number.")
  .refine(
    (value) => normalizeMobile(value) !== null,
    "Enter a 10-digit Indian mobile number.",
  );

export const Password = z
  .string("Enter a password.")
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.");

/** Sign-up: name, email, mobile and password. The email is checked by a 6-digit code. */
export const SignUpInput = z.object({
  name: requiredText("Enter your name.", 80),
  email: Email.transform((value) => value.trim().toLowerCase()),
  phoneNumber: Mobile,
  password: Password,
});

export const EmailCodeInput = z.object({
  email: Email,
  otp: z
    .string("Enter the 6-digit code.")
    .regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/**
 * Login. The second try, after the user agrees to log out the other device,
 * sends the header `x-confirm-takeover: true` as well.
 */
export const SignInInput = z.object({
  email: Email,
  password: z.string().min(1, "Enter your password."),
});

export const Platform = z.enum(["app", "web"]);

/** Every request from a client says which kind of client it is, and what to call the device. */
export const ClientHeaders = z.object({
  "x-platform": Platform,
  "x-device-name": z.string().max(80).optional(),
  "x-confirm-takeover": z.literal("true").optional(),
});

/** The person who is logged in. */
export const Me = z.object({
  id: Id,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  phoneNumber: z.string().nullable(),
  /** False until the mobile is checked (WhatsApp check is planned). Everything works meanwhile. */
  phoneVerified: z.boolean(),
  createdAt: IsoDateTime,
});

export const SessionInfo = z.object({
  id: Id,
  platform: Platform,
  deviceName: z.string().nullable(),
  lastActiveAt: IsoDateTime,
  createdAt: IsoDateTime,
  current: z.boolean(),
});

/** The body of the 409 sent when the same account is already open on another device. */
export const ActiveElsewhere = z.object({
  deviceName: z.string().nullable(),
  lastActiveAt: IsoDateTime,
});

export const MeUpdate = z.object({
  name: requiredText("Enter your name.", 80),
});

export type SignUpInput = z.infer<typeof SignUpInput>;
export type SignInInput = z.infer<typeof SignInInput>;
export type Me = z.infer<typeof Me>;
export type SessionInfo = z.infer<typeof SessionInfo>;
export type ActiveElsewhere = z.infer<typeof ActiveElsewhere>;
