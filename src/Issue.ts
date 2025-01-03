import Jira2Md from "npm:jira2md";
import * as Yaml from "jsr:@std/yaml";
import * as Fmt from "jsr:@std/fmt/colors";
import * as Diff from "npm:diff";
import { assert } from "jsr:@std/assert/assert";
import { Store } from "./Store.ts";
import { Printer, PrinterOptions } from "./Printer.ts";
import { Console } from "./Console.ts";
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

export type Edit = {
    meta: Pick<IssueMeta, "key" | "summary">;
    description: string;
};

const console = Console();

export function ProjectStore(storage: Deno.Kv): Store<Project> {
    return Store<Project>(["projects"], storage);
}

export function BoardStore(storage: Deno.Kv): Store<Board> {
    return Store<Board>(["boards"], storage);
}

export function IssueStore(storage: Deno.Kv): Store<Issue> {
    return Store<Issue>(["issues"], storage);
}

export function MyCommentStore(storage: Deno.Kv): Store<Comment> {
    return Store<Comment>(["my-comments"], storage);
}

export function EditStore(storage: Deno.Kv): Store<Issue> {
    return Store<Issue>(["issues-edit"], storage);
}

export function IssuePrinter(options: PrinterOptions): Printer<Issue> {
    const console = Console();
    function summary(issue: Issue) {
        const { key, fields } = issue;
        const { summary, created, creator } = fields;
        const { emailAddress } = creator;
        return { key, summary, created, creator: { emailAddress } };
    }
    return {
        format(issue) {
            if (options.format === "markdown") return serializeIssue(issue);
            return console.serialize(issue, options.format);
        },
        list(issues) {
            if (options.format === "markdown") {
                return issues.map(serializeIssue).join("\n---\n");
            }
            if (options.details) {
                return console.serialize(issues, options.format);
            }
            const data = issues.map(summary);
            return console.serialize(data, options.format);
        },
    };
}

export function serializeIssue(issue: Issue) {
    const { id, key, self } = issue;
    const { summary, description, created, updated, creator } = issue.fields;
    const meta: IssueMeta = {
        ...{ id, key, summary },
        ...{ self, created, updated, creator },
    };
    const header = Yaml.stringify(meta);
    const body = Jira2Md.to_markdown(description || "");
    return `---\n${header}---\n\n${body}`;
}

export async function deserializeEdit(text: string): Promise<Edit> {
    const parseYaml = async (text: string) => await Yaml.parse(text) as JSON;
    async function parseHeader(text: string) {
        const meta = await parseYaml(text)
            .catch(console.pitch("header is not valid YAML"));
        assert(typeof meta === "object", "header is not a YAML object");
        assert("id" in meta, "header missing id");
        assert("key" in meta, "header missing key");
        assert("summary" in meta, "header missing summary");
        assert(typeof meta.id === "string", "header missing id");
        assert(typeof meta.key === "string", "header missing key");
        assert(typeof meta.summary === "string", "header missing summary");
        const { id, key, summary } = meta;
        return { id, key, summary };
    }
    const [, header, body] = text.split("---");
    const meta = await parseHeader(header);
    const description = Jira2Md.to_jira(body);
    return { meta, description };
}

export function diffIssue(issue: Issue, edited: Issue) {
    const original = serializeIssue(issue);
    const updated = serializeIssue(edited);
    const filename = `${issue.key}.md`;
    const patch = Diff.createPatch(filename, original, updated);
    function fmtLine(line: string) {
        if (line.startsWith("+")) return Fmt.green(line);
        if (line.startsWith("-")) return Fmt.red(line);
        return line;
    }
    return patch.split("\n").map(fmtLine).join("\n");
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
    const fields = { summary, description, updated, created, creator, comment };
    return { id, key, self, fields };
}

function fmtIssueWebLink(issue: Issue) {
    return new URL(`/browse/${issue.key}`, new URL(issue.self).origin);
}

function fmtCommentWebLink(issue: Issue, comment: Comment) {
    const url = fmtIssueWebLink(issue);
    url.searchParams.set("focusedCommentId", comment.id);
    return url;
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

    async function postComment(issue: Issue, body_: string): Promise<Comment> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const path = `/rest/api/2/issue/${issue.key}/comment`;
        const url = await console
            .trap(() => new URL(path, baseUrl))
            .catch(console.pitch("Invalid issue key"));
        const body = JSON.stringify({ body: body_ });
        const payload = { method: "POST", headers, body };
        const request = new Request(url, payload);
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
        body_: string,
    ): Promise<void> {
        const baseUrl = await getBaseUrl();
        const headers = await getHeaders();
        const path = `/rest/api/2/issue/${issue.key}/comment/${comment.id}`;
        const url = await console
            .trap(() => new URL(path, baseUrl))
            .catch(console.pitch("Invalid issue key or comment id"));
        url.searchParams.set("notifyUsers", "false");
        const body = JSON.stringify({ body: body_ });
        const payload = { method: "PUT", headers, body };
        const request = new Request(url, payload);
        const response = await fetch(request);
        if (!response.ok) throw response;
        await response.text();
    }

    async function upsertComment(
        issue: Issue,
        body: string,
    ): Promise<{ published: boolean; comment: Comment; link: URL }> {
        const cached = await myCommentsStore.get(issue.key).catch(() => null);
        if (cached) {
            const comment = await getComment(issue, cached.id);
            const link = fmtCommentWebLink(issue, comment);
            if (body && comment.body && comment.body !== body) {
                await updateComment(issue, comment, body);
                return { published: true, comment: comment, link };
            }
            return { published: false, comment: comment, link };
        }
        const comment = await postComment(issue, body);
        const link = fmtCommentWebLink(issue, comment);
        return { published: true, comment, link };
    }
}
