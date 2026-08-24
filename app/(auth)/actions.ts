"use server";

import { AuthError } from "next-auth";
import { z } from "zod";

import { signIn } from "./auth";

const authFormSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "invalid_data"
    | "error";
  message?: string;
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      username: formData.get("username"),
      password: formData.get("password"),
    });

    await signIn("credentials", {
      username: validatedData.username,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        status: "invalid_data",
        message: "Check the username and password fields.",
      };
    }

    if (error instanceof AuthError) {
      console.error("[auth] NextAuth error:", error.type, error.message);
      if (error.type === "CredentialsSignin") {
        return {
          status: "failed",
          message: "Invalid username or password.",
        };
      }
      return { status: "failed", message: error.message };
    }

    console.error("[auth] Login error:", error);
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "We couldn't sign you in. Try again.",
    };
  }
};
