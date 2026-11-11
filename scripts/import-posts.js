import "dotenv/config";

import GhostAdminAPI from "@tryghost/admin-api";
import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.file && !args.dir)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
}

const ghostUrl = process.env.GHOST_URL;
const adminKey = process.env.GHOST_ADMIN_API_KEY;
const apiVersion = process.env.GHOST_API_VERSION || "v6.0";

if (!ghostUrl || !adminKey) {
    throw new Error("Missing GHOST_URL or GHOST_ADMIN_API_KEY in .env");
}

const ghost = new GhostAdminAPI({
    url: ghostUrl,
    key: adminKey,
    version: apiVersion
});

const defaultStatus = normalizeStatus(args.status || "draft");
const defaultAuthors = splitList(args.authors);
const defaultTags = splitList(args.tags);
const posts = args.file
    ? await readJsonPosts(args.file)
    : await readMarkdownDirectory(args.dir);
const results = [];

for (const [index, post] of posts.entries()) {
    try {
        const payload = buildPostPayload(post, {
            defaultStatus,
            defaultAuthors,
            defaultTags
        });
        const created = payload.html
            ? await ghost.posts.add(payload, { source: "html" })
            : await ghost.posts.add(payload);

        results.push({
            ok: true,
            index,
            id: created.id,
            title: created.title,
            status: created.status,
            url: created.url || null
        });
    } catch (error) {
        results.push({
            ok: false,
            index,
            title: post.title || "",
            error: error.message || "Import failed"
        });
    }
}

console.log(JSON.stringify({
    ok: results.every((result) => result.ok),
    total: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results
}, null, 2));

function buildPostPayload(post, defaults) {
    const title = String(post.title || "").trim();
    const content = String(post.content || "").trim();

    if (!title) {
        throw new Error("Missing post title");
    }

    if (!content) {
        throw new Error(`Missing content for "${title}"`);
    }

    const tags = mergeLists(defaults.defaultTags, post.tags);
    const authors = mergeLists(defaults.defaultAuthors, post.authors);

    return {
        title,
        status: normalizeStatus(post.status || defaults.defaultStatus),
        html: marked.parse(content),
        custom_excerpt: post.excerpt || undefined,
        feature_image: post.featureImage || post.feature_image || undefined,
        tags: tags.length ? tags : undefined,
        authors: authors.length ? authors : undefined
    };
}

async function readJsonPosts(filePath) {
    const raw = await fs.readFile(path.resolve(filePath), "utf8");
    const parsed = JSON.parse(raw);
    const posts = Array.isArray(parsed) ? parsed : parsed.posts;

    if (!Array.isArray(posts) || posts.length === 0) {
        throw new Error("JSON must be an array or an object with a posts array");
    }

    return posts;
}

async function readMarkdownDirectory(dirPath) {
    const dir = path.resolve(dirPath);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
        .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
        .map((entry) => path.join(dir, entry.name))
        .sort();

    if (!files.length) {
        throw new Error("No .md files found in directory");
    }

    return Promise.all(files.map(readMarkdownPost));
}

async function readMarkdownPost(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseFrontMatter(raw);
    const fallbackTitle = path.basename(filePath).replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();

    return {
        title: parsed.meta.title || fallbackTitle,
        content: parsed.content,
        tags: splitList(parsed.meta.tags),
        authors: splitList(parsed.meta.authors),
        excerpt: parsed.meta.excerpt || "",
        featureImage: parsed.meta.featureImage || parsed.meta.feature_image || "",
        status: parsed.meta.status || ""
    };
}

function parseFrontMatter(raw) {
    if (!raw.startsWith("---\n")) {
        return { meta: {}, content: raw };
    }

    const end = raw.indexOf("\n---", 4);

    if (end < 0) {
        return { meta: {}, content: raw };
    }

    const lines = raw.slice(4, end).split(/\r?\n/);
    const meta = {};

    lines.forEach((line) => {
        const separator = line.indexOf(":");

        if (separator < 0) {
            return;
        }

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");

        if (key) {
            meta[key] = value;
        }
    });

    return {
        meta,
        content: raw.slice(end + 4).trim()
    };
}

function normalizeStatus(value) {
    const status = String(value || "draft").trim();

    if (!["draft", "published"].includes(status)) {
        throw new Error("status must be draft or published");
    }

    return status;
}

function mergeLists(defaults, value) {
    return [
        ...defaults,
        ...splitList(value)
    ].filter((item, index, list) => item && list.indexOf(item) === index);
}

function parseArgs(argv) {
    const result = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--help" || arg === "-h") {
            result.help = true;
            continue;
        }

        if (!arg.startsWith("--")) {
            continue;
        }

        const rawKey = arg.slice(2);
        const next = argv[index + 1];

        if (!next || next.startsWith("--")) {
            result[toCamelCase(rawKey)] = "true";
            continue;
        }

        result[toCamelCase(rawKey)] = next;
        index += 1;
    }

    return result;
}

function splitList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }

    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function toCamelCase(value) {
    return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function printHelp() {
    console.log(`
Ghost 批量导入文章

用法：
  npm run import -- --file ./posts.json
  npm run import -- --dir ./articles
  npm run import -- --dir ./articles --status published --authors "author@example.com" --tags "News,AI"

JSON 格式：
  {
    "posts": [
      {
        "title": "文章标题",
        "content": "Markdown 正文",
        "tags": ["News"],
        "authors": ["author@example.com"],
        "excerpt": "摘要",
        "featureImage": "https://example.com/cover.jpg",
        "status": "draft"
      }
    ]
  }

Markdown 文件可选 front matter：
  ---
  title: 文章标题
  tags: News,AI
  authors: author@example.com
  excerpt: 摘要
  featureImage: https://example.com/cover.jpg
  status: draft
  ---

参数：
  --file      JSON 文件
  --dir       Markdown 文件夹
  --status    draft 或 published，默认 draft
  --authors   默认作者邮箱，英文逗号分隔
  --tags      默认标签，英文逗号分隔
`);
}
