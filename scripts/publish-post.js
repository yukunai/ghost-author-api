import "dotenv/config";

import GhostAdminAPI from "@tryghost/admin-api";
import fs from "node:fs/promises";
import path from "node:path";
import { marked } from "marked";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.title || (!args.file && !args.content)) {
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

const status = args.status || "draft";

if (!["draft", "published"].includes(status)) {
    throw new Error("--status must be draft or published");
}

const markdown = args.file
    ? await fs.readFile(path.resolve(args.file), "utf8")
    : args.content;

const html = marked.parse(markdown || "");
const tags = splitList(args.tags);
const authors = splitList(args.authors);

const payload = {
    title: args.title,
    status,
    html,
    custom_excerpt: args.excerpt || undefined,
    feature_image: args.featureImage || undefined,
    tags: tags.length ? tags : undefined,
    authors: authors.length ? authors : undefined
};

const post = await ghost.posts.add(payload, { source: "html" });

console.log(JSON.stringify(
    {
        ok: true,
        id: post.id,
        status: post.status,
        title: post.title,
        url: post.url || null
    },
    null,
    2
));

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
Ghost 自动发文脚本

用法：
  npm run publish -- --title "标题" --file ./article.md
  npm run publish -- --title "标题" --content "正文内容" --status published

参数：
  --title           必填，文章标题
  --file            Markdown 文件路径
  --content         直接传入正文 Markdown
  --status          draft 或 published，默认 draft
  --tags            英文逗号分隔，例如 "News,AI 产品"
  --authors         作者邮箱，英文逗号分隔；不填则默认站点 owner
  --excerpt         摘要
  --feature-image   封面图 URL
`);
}
