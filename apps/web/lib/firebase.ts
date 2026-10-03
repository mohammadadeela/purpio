"use client";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, updateProfile } from "firebase/auth";
import { api } from "./api";
const app = getApps()[0] ?? initializeApp({ apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
export const auth = getAuth(app);
async function exchange(referral?: string) { const idToken = await auth.currentUser!.getIdToken(true); return api<{ user: any; isNew: boolean }>("/auth/session", { method: "POST", json: { idToken, referral } }); }
export const signInGoogle = (ref?: string) => signInWithPopup(auth, new GoogleAuthProvider()).then(() => exchange(ref));
export const signInGithub = (ref?: string) => signInWithPopup(auth, new GithubAuthProvider()).then(() => exchange(ref));
export const signInEmail = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password).then(() => exchange());
export async function signUpEmail(name: string, email: string, password: string, ref?: string) { const c = await createUserWithEmailAndPassword(auth, email, password); await updateProfile(c.user, { displayName: name }); await sendEmailVerification(c.user, { url: `${location.origin}/` }); return exchange(ref); }
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email, { url: `${location.origin}/login` });
