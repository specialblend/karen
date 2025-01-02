import { assert } from "jsr:@std/assert/assert";
import { Store } from "./Store.ts";
import { JIRA_PASSWORD, JIRA_URL, JIRA_USERNAME, remember } from "./Config.ts";

export type Project = {
    id: string;
    key: string;
    name: string;
};

export type Board = {
    id: number;
    name: string;
    type: string;
    location?: {
        projectId: number;
        projectKey: string;
    };
};

export type Author = {
    self: string;
    accountId: string;
    emailAddress: string;
    displayName: string;
    active: boolean;
    accountType: string;
};

export type Issue = {
    id: string;
    self: string;
    key: string;
    fields: {
        summary: string;
        description: string | null;
        updated: string;
        created: string;
        creator: Author;
        comment: {
            comments: Comment[];
        };
    };
};

export type Comment = {
    id: string;
    self: string;
    author: Author;
    created: string;
    updated: string;
    body: string;
};

export type IssueMeta = {
    id: string;
    key: string;
    self: string;
    created: string;
    updated: string;
    summary: string;
    creator: Author;
};

export function ProjectStore(storage: Deno.Kv): Store<Project> {
    function summarize(project: Project) {
        const { key, name } = project;
        return { key, name };
    }
    return Store<Project>(["projects"], storage, summarize);
}

export function BoardStore(storage: Deno.Kv): Store<Board> {
    function summarize(board: Board) {
        const { name, location: { projectKey = null } = {} } = board;
        return { name, projectKey };
    }
    return Store<Board>(["boards"], storage, summarize);
}

export function IssueStore(storage: Deno.Kv): Store<Issue> {
    function summarize(issue: Issue) {
        const { key, fields: { summary } } = issue;
        return { key, fields: { summary } };
    }
    return Store<Issue>(["issues"], storage, summarize);
}

export function MyCommentStore(storage: Deno.Kv): Store<Comment> {
    function summarize(comment: Comment) {
        const { id, body } = comment;
        return { id, body };
    }
    return Store<Comment>(["my-comments"], storage, summarize);
}

export function EditStore(storage: Deno.Kv): Store<Issue> {
    function summarize(issue: Issue) {
        const { key, fields: { summary } } = issue;
        return { key, fields: { summary } };
    }
    return Store<Issue>(["issues-edit"], storage, summarize);
}

function fmtBoard(data: any): Board {
    const { id, name, type, location } = data;
    return { id, name, type, location };
}

function fmtProject(data: any): Project {
    const { id, key, name } = data;
    return { id, key, name };
}

function fmtAuthor(data: any): Author {
    const { accountId, emailAddress, displayName } = data;
    const { self, active, accountType } = data;
    return {
        ...{ accountId, emailAddress, displayName },
        ...{ self, active, accountType },
    };
}

function fmtComment(data: any): Comment {
    const { id, self, body, created, updated } = data;
    const author = fmtAuthor(data.author);
    return { id, self, created, updated, author, body };
}

function fmtIssue(data: any): Issue {
    const { id, key, self, fields: _fields } = data;
    const { summary, description, updated, created } = _fields;
    const creator = fmtAuthor(_fields.creator);
    const comments = _fields.comment.comments.map(fmtComment);
    const comment = { comments };
    const fields = {
        summary,
        description,
        updated,
        created,
        creator,
        comment,
    };
    return { id, key, self, fields };
}

export function IssueService(storage: Deno.Kv) {
    const FIELDS = "id,key,description,summary,updated,created,creator,comment";
    const projectStore = ProjectStore(storage);
    const boardStore = BoardStore(storage);
    const issueStore = IssueStore(storage);
    const myCommentsStore = MyCommentStore(storage);

    return {
        ...{ pullProjects, pullBoards, pullIssues, pullIssue, pushIssue },
        ...{ postComment, updateComment, upsertComment },
    };

    async function getHeaders() {
        const username = await remember(JIRA_USERNAME, {}, storage);
        const password = await remember(JIRA_PASSWORD, {}, storage);
        const auth = btoa(`${username}:${password}`);
        return {
            "Authorization": `Basic ${auth}`,
            "Accept": "application/json",
            "Content-Type": "application/json",
        };
    }

    async function getBaseUrl() {
        return await remember(JIRA_URL, {}, storage);
    }

    async function* paginateIssues(
        board: Board,
        perPage = 50,
        maxRequests = 10,
    ): AsyncGenerator<Issue> {
        let startAt = 0;
        let requests = 0;
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        while (++requests <= maxRequests) {
            const url = new URL(
                `/rest/agile/1.0/board/${board.id}/backlog`,
                baseUrl,
            );
            url.searchParams.set("startAt", startAt.toString());
            url.searchParams.set("maxResults", perPage.toString());
            url.searchParams.set("fields", FIELDS);
            const request = new Request(url, { headers });
            const response = await fetch(request);
            if (!response.ok) throw response;
            const data = await response.json();
            for (const issue of data.issues) yield issue;
            if (data.issues.length < perPage) break;
            startAt += perPage;
        }
    }

    async function pullProjects(): Promise<Project[]> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const url = new URL("/rest/api/3/project", baseUrl);
        const request = new Request(url, { headers });
        const response = await fetch(request);
        if (!response.ok) throw response;
        const data = await response.json();
        assert(Array.isArray(data), "Invalid response for JIRA projects");
        const projects = data.map(fmtProject);
        for (const project of projects) {
            await projectStore.put(project.key, project);
        }
        return projects;
    }

    async function pullBoards(project: Project): Promise<Board[]> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const url = new URL("/rest/agile/1.0/board", baseUrl);
        url.searchParams.set("projectKeyOrId", project.key);
        const request = new Request(url, { headers });
        const response = await fetch(request);
        if (!response.ok) throw response;
        const data = await response.json();
        assert(Array.isArray(data.values), "Invalid response for JIRA boards");
        const boards = data.values.map(fmtBoard);
        for (const board of boards) await boardStore.put(board.name, board);
        return boards;
    }

    async function pullIssues(board: Board): Promise<Issue[]> {
        const issues = await Array.fromAsync(paginateIssues(board));
        for (const issue of issues) {
            await issueStore.put(issue.key, fmtIssue(issue));
        }
        return issues;
    }

    async function pullIssue(key: string): Promise<Issue> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const url = new URL(`/rest/api/2/issue/${key}`, baseUrl);
        const request = new Request(url, { headers });
        const response = await fetch(request);
        if (!response.ok) throw response;
        const data = await response.json();
        const issue = fmtIssue(data);
        await issueStore.put(issue.key, issue);
        return issue;
    }

    async function pushIssue(issue: Issue): Promise<void> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const { key } = issue;
        const { summary, description } = issue.fields;
        const fields = { summary, description };
        const url = new URL(`/rest/api/2/issue/${key}`, baseUrl);
        const request = new Request(url, {
            method: "PUT",
            headers,
            body: JSON.stringify({ fields }),
        });
        const response = await fetch(request);
        if (!response.ok) throw response;
        await response.text();
    }

    async function getComment(issue: Issue, id: string): Promise<Comment> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const url = new URL(
            `/rest/api/2/issue/${issue.key}/comment/${id}`,
            baseUrl,
        );
        const request = new Request(url, {
            method: "GET",
            headers,
        });
        const response = await fetch(request);
        if (!response.ok) throw response;
        const comment = await response.json().then(fmtComment);
        return comment;
    }

    async function postComment(issue: Issue, body: string): Promise<Comment> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const url = new URL(`/rest/api/2/issue/${issue.key}/comment`, baseUrl);
        const request = new Request(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ body: body }),
        });
        const response = await fetch(request);
        if (!response.ok) throw response;
        const comment = await response.json().then(fmtComment);
        const myComments = MyCommentStore(storage);
        await myComments.put(issue.key, comment);
        return comment;
    }

    async function updateComment(
        issue: Issue,
        comment: Comment,
        body: string,
    ): Promise<void> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const url = new URL(
            `/rest/api/2/issue/${issue.key}/comment/${comment.id}`,
            baseUrl,
        );
        const request = new Request(url, {
            method: "PUT",
            headers,
            body: JSON.stringify({ body }),
        });
        const response = await fetch(request);
        if (!response.ok) throw response;
        await response.text();
    }

    async function upsertComment(issue: Issue, body: string) {
        const cached = await myCommentsStore
            .get(issue.key)
            .catch(() => null);
        if (cached) {
            const remote = await getComment(issue, cached.id);
            if (body && remote.body && remote.body !== body) {
                await updateComment(issue, cached, body);
                return true;
            }
            return false;
        }
        await postComment(issue, body);
        return true;
    }
}
