import { compare } from "bcryptjs";
import type { AllowedUser } from "./users";

export async function verifyPassword(
  password: string,
  allowedUser: AllowedUser | undefined,
  dummyPasswordHash: string
): Promise<boolean> {
  const hash = allowedUser?.passwordHash ?? dummyPasswordHash;
  const match = await compare(password, hash);
  return !!allowedUser && match;
}
