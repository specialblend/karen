import { Store } from "./Store.ts";

export type Estimate = {
    issueKey: string;
    model: string;
    confidence: number;
    storyPoints: number;
};

export function EstimateStore(storage: Deno.Kv): Store<Estimate> {
    function summarize(estimate: Estimate) {
        const { issueKey, storyPoints } = estimate;
        return { issueKey, storyPoints };
    }
    return Store<Estimate>(["estimates"], storage, summarize);
}
