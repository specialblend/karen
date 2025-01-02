import * as Fmt from "jsr:@std/fmt/colors";
import { nanoid } from "npm:nanoid";
import { DefaultSettings, validateSettings } from "./Settings.ts";

export type Json = string | number | boolean | null | Json[] | {
    [key: string]: Json;
};

export function getStorageDir() {
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
    return `${home}/.karen`;
}

export function getStoragePath(storageDir: string) {
    return `${storageDir}/karen.db`;
}

export function getSettingsPath(storageDir: string) {
    return `${storageDir}/settings.json`;
}

export async function touchSettings(storageDir: string) {
    const settingsPath = getSettingsPath(storageDir);
    try {
        await Deno.stat(settingsPath);
    } catch {
        const settings = DefaultSettings();
        await Deno.writeTextFile(
            settingsPath,
            JSON.stringify(settings, null, 2),
        );
    }
}

export async function getSettings(storageDir: string) {
    await touchSettings(storageDir);
    const settingsPath = getSettingsPath(storageDir);
    const text = await Deno.readTextFile(settingsPath);
    try {
        const settings = JSON.parse(text);
        validateSettings(settings);
        return settings;
    } catch {
        console.error(Fmt.red(`Error loading settings from ${settingsPath}`));
        console.error(text);
        Deno.exit(1);
    }
}

export async function touchStorageDir(): Promise<string> {
    const storageDir = getStorageDir();
    try {
        await Deno.mkdir(storageDir, { recursive: true });
        return storageDir;
    } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) return storageDir;
        console.error(
            Fmt.red(`Error creating storage directory ${storageDir}`),
        );
        Deno.exit(1);
    }
}

export async function touchId(storage: Deno.Kv) {
    const cached = await storage.get(["meta", "id"]);
    const id = nanoid();
    if (!cached.value) await storage.set(["meta", "id"], id);
    return id;
}

export async function getStorage(storageDir: string): Promise<Deno.Kv> {
    const storagePath = getStoragePath(storageDir);
    const storage = await Deno.openKv(storagePath);
    await touchId(storage);
    return storage;
}

export function relativeDate(date: Date, now = new Date()): string {
    const formatter = new Intl.RelativeTimeFormat("en", {
        numeric: "auto",
    });
    const diff = date.getTime() - now.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);
    if (Math.abs(years) > 1) return formatter.format(years, "years");
    if (Math.abs(months) > 1) return formatter.format(months, "months");
    if (Math.abs(days) > 1) return formatter.format(days, "days");
    if (Math.abs(hours) > 1) return formatter.format(hours, "hours");
    if (Math.abs(minutes) > 1) return formatter.format(minutes, "minutes");
    return formatter.format(seconds, "seconds");
}

export async function hash(text: string) {
    const data = new TextEncoder().encode(text);
    return await crypto
        .subtle
        .digest("SHA-512", data)
        .then((hash) => new Uint8Array(hash))
        .then((hash) => Array.from(hash))
        .then((hash) =>
            hash.map((b) => b.toString(16).padStart(2, "0")).join("")
        );
}
