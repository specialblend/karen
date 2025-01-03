export interface Store<T> {
    put(key: string, value: T): Promise<T>;
    get(key: string): Promise<T>;
    list(): AsyncGenerator<T>;
    keys(): AsyncGenerator<string>;
    entries(): AsyncGenerator<Deno.KvEntry<T>>;
    remove(key: string): Promise<void>;
    removeAll(): Promise<void>;
}

export function Store<T>(
    namespace: string[],
    storage: Deno.Kv,
): Store<T> {
    return { put, get, list, remove, removeAll, keys, entries };

    async function put(key: string, value: T) {
        await storage.set([...namespace, key], value);
        return value;
    }

    async function get(key: string): Promise<T> {
        const cached = await storage.get<T>([...namespace, key]);
        if (cached.value) return cached.value;
        throw new Deno.errors.NotFound(key);
    }

    async function* list(): AsyncGenerator<T> {
        const cached = storage.list<T>({ prefix: namespace });
        for await (const entry of cached) yield entry.value;
    }

    async function* entries(): AsyncGenerator<Deno.KvEntry<T>> {
        const cached = storage.list<T>({ prefix: namespace });
        for await (const entry of cached) yield entry;
    }

    async function* keys(): AsyncGenerator<string> {
        const cached = storage.list<T>({ prefix: namespace });
        for await (const entry of cached) yield entry.key[1] as string;
    }

    async function remove(key: string): Promise<void> {
        await storage.delete([...namespace, key]);
    }

    async function removeAll(): Promise<void> {
        const cached = storage.list<T>({ prefix: namespace });
        for await (const entry of cached) {
            await storage.delete(entry.key);
        }
    }
}
