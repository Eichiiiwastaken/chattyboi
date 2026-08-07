import { randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth/credentials";
import type { AllowedUser } from "@/lib/auth/users";
import { getOrCreateUser } from "@/lib/db/queries";
import { authConfig } from "./auth.config";

function getEnvUsers(): AllowedUser[] {
  try {
    const raw = process.env.ALLOWED_USERS;
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("ALLOWED_USERS must be a JSON array");
    }

    return parsed.map(
      (u: {
        username: string;
        name: string;
        password?: string;
        passwordHash?: string;
      }) => {
        const username = u.username?.trim().toLowerCase();
        const name = u.name?.trim();
        const passwordHash = u.passwordHash?.trim();
        const password = u.password;

        if (
          !username ||
          !name ||
          (!passwordHash && typeof password !== "string")
        ) {
          throw new Error(
            "Each ALLOWED_USERS entry needs username, name, and passwordHash or password"
          );
        }

        return {
          username,
          name,
          passwordHash:
            passwordHash ??
            hashSync(password as NonNullable<typeof password>, 10),
        };
      }
    );
  } catch {
    console.error("[auth] Failed to parse ALLOWED_USERS env var");
    return [];
  }
}

const envUsers = getEnvUsers();

const dummyPasswordHash = hashSync(randomUUID(), 10);

function getAllowedUser(username: string) {
  return envUsers.find((u) => u.username === username);
}

export type UserType = "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    name?: string | null;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    email?: string | null;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials.username ?? "").toLowerCase();
        const password = String(credentials.password ?? "");

        const allowedUser = getAllowedUser(username);

        const passwordsMatch = await verifyPassword(
          password,
          allowedUser,
          dummyPasswordHash
        );
        if (!allowedUser || !passwordsMatch) {
          return null;
        }

        return {
          id: allowedUser.username,
          name: allowedUser.name,
          email: `${username}@chattyboi.local`,
          type: "regular",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.email = user.email ?? `${user.id}@chattyboi.local`;
        token.type = user.type;
      }

      const email =
        token.email ??
        (token.id && !token.id.includes("-")
          ? `${token.id}@chattyboi.local`
          : null);

      if (email) {
        try {
          const dbUser = await getOrCreateUser(email, randomUUID());

          if (dbUser) {
            token.id = dbUser.id;
          }
        } catch (err) {
          console.error("[auth] JWT: db error:", err);
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
