import { Console } from "./Console.ts";
import { Store } from "./Store.ts";

export type ConfigParam = {
    key: string;
    name?: string;
    defaultValue?: string;
    validate?: (value: string) => boolean;
    secret?: boolean;
    global?: boolean;
};

export const JIRA_URL = {
    key: "jira.url",
    name: "JIRA URL",
    defaultValue: "https://example.atlassian.net",
    validate: validateURL,
    global: true,
};

export const JIRA_USERNAME = {
    key: "jira.username",
    name: "JIRA username",
    defaultValue: "user@example.com",
    global: true,
};

export const JIRA_PASSWORD = {
    key: "jira.password",
    name: "JIRA API key",
    secret: true,
    global: true,
};

export const JIRA_PROJECT = {
    key: "jira.project",
    name: "JIRA project key",
    global: false,
};

export const JIRA_BOARD = {
    key: "jira.board",
    name: "JIRA board",
    global: false,
};

export const KnownConfigParams: ConfigParam[] = [
    JIRA_URL,
    JIRA_USERNAME,
    JIRA_PASSWORD,
    JIRA_PROJECT,
    JIRA_BOARD,
];

const console = Console();

export function ConfigStore(storage: Deno.Kv): Store<string> {
    return Store<string>(["config"], storage);
}

export async function remember(
    param: ConfigParam,
    options: { force?: boolean; defaultValue?: string },
    storage: Deno.Kv,
): Promise<string> {
    const config = ConfigStore(storage);
    const { key, validate } = param;
    const cached = await config.get(key).catch(() => null);
    if (!options.force && cached) return cached;
    const value = console.ask(param, options.defaultValue || cached);
    const { InvalidData } = Deno.errors;
    if (!value) throw new InvalidData("No value provided");
    if (validate && !validate(value)) throw new InvalidData(key);
    await config.put(key, value);
    return value;
}

export function validateURL(value: string) {
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}
