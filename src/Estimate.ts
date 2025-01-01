import { Store } from "./Store.ts";

export type Estimate = {
    issueKey: string;
    model: string;
    confidence: number;
    storyPoints: number;
};

export function EstimateStore(storage: Deno.Kv): Store<Estimate> {
    return Store<Estimate>(["estimates"], storage);
}
