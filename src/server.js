import "dotenv/config";

import GhostAdminAPI from "@tryghost/admin-api";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs/promises";
import jwt from "jsonwebtoken";
import os from "node:os";
import path from "node:path";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";

const app = express();

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const ghostUrl = process.env.GHOST_URL;
const ghostAdminApiKey = process.env.GHOST_ADMIN_API_KEY;
const ghostApiVersion = process.env.GHOST_API_VERSION || "v6.0";
const allowDirectPublish = process.env.ALLOW_DIRECT_PUBLISH !== "false";
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || "220mb";
const trustProxy = process.env.TRUST_PROXY;

if (!ghostUrl || !ghostAdminApiKey) {
    throw new Error("GHOST_URL and GHOST_ADMIN_API_KEY are required");
}

const memberIssuer = new URL("/members/api/", ghostUrl).href;
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const authCallbackUrl = process.env.AUTH_CALLBACK_URL || new URL("/api/auth/google/callback", ghostUrl).href;
const authCookieSecret = process.env.AUTH_COOKIE_SECRET || "";
const authCookieName = process.env.AUTH_COOKIE_NAME || "kanjianle_auth";
const authStateCookieName = process.env.AUTH_STATE_COOKIE_NAME || "kanjianle_auth_state";
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN || "";
const authCookieSecure = process.env.AUTH_COOKIE_SECURE !== "false";
const authCookieMaxAgeSeconds = Number(process.env.AUTH_COOKIE_MAX_AGE_SECONDS || 60 * 60 * 24 * 30);
const authSuccessRedirect = process.env.AUTH_SUCCESS_REDIRECT || "/";
const authFailureRedirect = process.env.AUTH_FAILURE_REDIRECT || "/?auth=failed";

const certifiedAuthors = parseCertifiedAuthorEmails(
    process.env.CERTIFIED_AUTHOR_EMAILS || "",
    process.env.AUTHOR_TOKENS || ""
);

if (certifiedAuthors.size === 0) {
    throw new Error("CERTIFIED_AUTHOR_EMAILS must contain at least one certified author");
}

const ghost = new GhostAdminAPI({
    url: ghostUrl,
    key: ghostAdminApiKey,
    version: ghostApiVersion
});

const linkPreviewCache = new Map();
const linkPreviewCacheLimit = Number(process.env.LINK_PREVIEW_CACHE_LIMIT || 500);
const affiliateSettingsPath = process.env.AFFILIATE_SETTINGS_PATH || path.join(process.cwd(), "affiliate-settings.json");
const commentsStorePath = process.env.COMMENTS_STORE_PATH || path.join(process.cwd(), "comments-store.json");
const affiliateShoppingSites = [
    { key: "amazon", name: "Amazon", domains: ["amazon.com", "amazon.cn", "amazon.co.jp", "amazon.co.uk", "amazon.de", "amazon.ca"] },
    { key: "ebay", name: "eBay", domains: ["ebay.com"] },
    { key: "etsy", name: "Etsy", domains: ["etsy.com"] },
    { key: "walmart", name: "Walmart", domains: ["walmart.com"] },
    { key: "taobao", name: "淘宝", domains: ["taobao.com"] },
    { key: "tmall", name: "天猫", domains: ["tmall.com"] },
    { key: "jd", name: "京东", domains: ["jd.com"] },
    { key: "pinduoduo", name: "拼多多", domains: ["pinduoduo.com", "yangkeduo.com"] },
    { key: "meituan", name: "美团", domains: ["meituan.com"] },
    { key: "dianping", name: "大众点评", domains: ["dianping.com"] },
    { key: "goofish", name: "闲鱼", domains: ["goofish.com", "xianyu.aliyun.com"] }
];
const linkPreviewSites = [
    ...affiliateShoppingSites,
    { key: "youtube", name: "YouTube", domains: ["youtube.com", "youtu.be"] },
    { key: "facebook", name: "Facebook", domains: ["facebook.com", "fb.watch"] },
    { key: "instagram", name: "Instagram", domains: ["instagram.com"] },
    { key: "x", name: "X", domains: ["x.com", "twitter.com"] },
    { key: "reddit", name: "Reddit", domains: ["reddit.com"] },
    { key: "tiktok", name: "TikTok", domains: ["tiktok.com"] },
    { key: "pinterest", name: "Pinterest", domains: ["pinterest.com", "pin.it"] },
    { key: "behance", name: "Behance", domains: ["behance.net"] },
    { key: "dribbble", name: "Dribbble", domains: ["dribbble.com"] },
    { key: "canva", name: "Canva", domains: ["canva.com"] },
    { key: "github", name: "GitHub", domains: ["github.com"] },
    { key: "stackoverflow", name: "Stack Overflow", domains: ["stackoverflow.com", "stackexchange.com"] },
    { key: "microsoft", name: "Microsoft", domains: ["microsoft.com", "learn.microsoft.com"] },
    { key: "apple", name: "Apple", domains: ["apple.com", "developer.apple.com"] },
    { key: "openai", name: "OpenAI", domains: ["openai.com", "platform.openai.com", "chatgpt.com"] },
    { key: "zhihu", name: "知乎", domains: ["zhihu.com"] },
    { key: "wechat", name: "微信", domains: ["mp.weixin.qq.com", "weixin.qq.com"] },
    { key: "weibo", name: "微博", domains: ["weibo.com", "weibo.cn"] },
    { key: "xiaohongshu", name: "小红书", domains: ["xiaohongshu.com", "xhslink.com"] },
    { key: "douyin", name: "抖音", domains: ["douyin.com", "iesdouyin.com"] },
    { key: "kuaishou", name: "快手", domains: ["kuaishou.com", "gifshow.com"] },
    { key: "bilibili", name: "Bilibili", domains: ["bilibili.com", "b23.tv"] },
    { key: "douban", name: "豆瓣", domains: ["douban.com"] },
    { key: "tencent-video", name: "腾讯视频", domains: ["v.qq.com"] },
    { key: "qq-music", name: "QQ 音乐", domains: ["y.qq.com"] },
    { key: "tencent-cloud", name: "腾讯云", domains: ["cloud.tencent.com"] },
    { key: "tencent", name: "腾讯网", domains: ["qq.com"] },
    { key: "sina", name: "新浪网", domains: ["sina.com.cn", "sina.cn"] },
    { key: "netease", name: "网易", domains: ["163.com", "netease.com"] },
    { key: "sohu", name: "搜狐", domains: ["sohu.com"] },
    { key: "thepaper", name: "澎湃新闻", domains: ["thepaper.cn"] },
    { key: "toutiao", name: "今日头条", domains: ["toutiao.com"] },
    { key: "iqiyi", name: "爱奇艺", domains: ["iqiyi.com"] },
    { key: "youku", name: "优酷", domains: ["youku.com"] },
    { key: "mgtv", name: "芒果 TV", domains: ["mgtv.com"] },
    { key: "netease-music", name: "网易云音乐", domains: ["music.163.com"] },
    { key: "ctrip", name: "携程", domains: ["ctrip.com", "trip.com"] },
    { key: "fliggy", name: "飞猪", domains: ["fliggy.com"] },
    { key: "ly", name: "同程旅行", domains: ["ly.com"] },
    { key: "amap", name: "高德地图", domains: ["amap.com", "gaode.com"] },
    { key: "baidu-map", name: "百度地图", domains: ["map.baidu.com", "maps.baidu.com"] },
    { key: "didi", name: "滴滴", domains: ["didiglobal.com", "didichuxing.com", "xiaojukeji.com"] },
    { key: "aliyun", name: "阿里云", domains: ["aliyun.com"] },
    { key: "huaweicloud", name: "华为云", domains: ["huaweicloud.com"] },
    { key: "feishu", name: "飞书", domains: ["feishu.cn", "larksuite.com"] },
    { key: "dingtalk", name: "钉钉", domains: ["dingtalk.com"] },
    { key: "yuque", name: "语雀", domains: ["yuque.com"] },
    { key: "gitee", name: "Gitee", domains: ["gitee.com"] }
];

const imageDataSchema = z.object({
    filename: z.string().trim().min(1).max(180),
    contentType: z.string().trim().max(80).optional().default(""),
    data: z.string().min(20).max(7_000_000)
});

const videoDataSchema = z.object({
    filename: z.string().trim().min(1).max(180),
    contentType: z.string().trim().max(80).optional().default(""),
    data: z.string().min(20).max(35_000_000)
});

const submitSchema = z.object({
    memberToken: z.string().max(4000).optional().default(""),
    title: z.string().trim().max(180).optional().default(""),
    excerpt: z.string().trim().max(300).optional().default(""),
    content: z.string().trim().max(80000),
    tags: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
    featureImage: z.string().trim().url().optional().or(z.literal("")).default(""),
    imageData: imageDataSchema.optional().nullable().default(null),
    imageDataList: z.array(imageDataSchema).max(9).optional().default([]),
    videoData: videoDataSchema.optional().nullable().default(null),
    videoDataList: z.array(videoDataSchema).max(4).optional().default([]),
    status: z.enum(["draft", "published"]).default("draft")
});

const batchPostSchema = submitSchema
    .omit({
        memberToken: true,
        imageData: true,
        imageDataList: true,
        videoData: true,
        videoDataList: true
    })
    .extend({
        title: z.string().trim().min(1).max(180),
        content: z.string().trim().min(1).max(80000)
    });

const batchSubmitSchema = z.object({
    memberToken: z.string().max(4000).optional().default(""),
    status: z.enum(["draft", "published"]).default("draft"),
    posts: z.array(batchPostSchema).min(1).max(50)
});

const identitySchema = z.object({
    memberToken: z.string().max(4000).optional().default("")
});

const commentListSchema = z.object({
    postId: z.string().trim().min(1).max(120)
});

const commentCreateSchema = z.object({
    postId: z.string().trim().min(1).max(120),
    postUrl: z.string().trim().max(500).optional().default(""),
    content: z.string().trim().min(1).max(1000),
    memberToken: z.string().max(4000).optional().default("")
});

if (trustProxy) {
    app.set("trust proxy", trustProxy === "true" ? 1 : trustProxy);
}

app.use(helmet());
app.use(
    rateLimit({
        windowMs: 60 * 1000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false
    })
);
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: "128kb" }));

if (process.env.CORS_ORIGIN) {
    app.use(
        cors({
            origin: process.env.CORS_ORIGIN,
            methods: ["POST", "GET"],
            allowedHeaders: ["Content-Type"]
        })
    );
}

app.get("/health", (_request, response) => {
    response.json({ ok: true });
});

app.get("/api/auth/config", (_request, response) => {
    response.json({
        googleEnabled: isGoogleAuthConfigured()
    });
});

app.get("/api/auth/google", (request, response) => {
    if (!isGoogleAuthConfigured()) {
        return response.status(503).send("Google 登录还没有配置完成");
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

    authUrl.searchParams.set("client_id", googleClientId);
    authUrl.searchParams.set("redirect_uri", authCallbackUrl);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");

    response.setHeader(
        "Set-Cookie",
        serializeCookie(authStateCookieName, state, {
            httpOnly: true,
            secure: authCookieSecure,
            sameSite: "Lax",
            maxAge: 10 * 60,
            path: "/api/auth/google/callback",
            domain: authCookieDomain
        })
    );

    return response.redirect(authUrl.href);
});

app.get("/api/auth/google/callback", async (request, response) => {
    const cookies = parseCookies(request);
    const expectedState = cookies[authStateCookieName] || "";
    const state = String(request.query.state || "");
    const code = String(request.query.code || "");
    const clearStateCookie = serializeCookie(authStateCookieName, "", {
        httpOnly: true,
        secure: authCookieSecure,
        sameSite: "Lax",
        maxAge: 0,
        path: "/api/auth/google/callback",
        domain: authCookieDomain
    });

    if (!isGoogleAuthConfigured() || !code || !expectedState || state !== expectedState) {
        response.setHeader("Set-Cookie", clearStateCookie);
        return response.redirect(safeRedirectUrl(authFailureRedirect));
    }

    try {
        const googleUser = await getGoogleUserFromCode(code);

        if (!googleUser.email || !googleUser.email_verified) {
            response.setHeader("Set-Cookie", clearStateCookie);
            return response.redirect(safeRedirectUrl(authFailureRedirect));
        }

        const member = await upsertGhostMemberFromGoogle(googleUser);
        const sessionCookie = serializeCookie(authCookieName, signAuthSession({
            email: googleUser.email,
            name: googleUser.name || member.name || "",
            picture: googleUser.picture || "",
            memberId: member.id || "",
            provider: "google"
        }), {
            httpOnly: true,
            secure: authCookieSecure,
            sameSite: "Lax",
            maxAge: authCookieMaxAgeSeconds,
            path: "/",
            domain: authCookieDomain
        });

        response.setHeader("Set-Cookie", [clearStateCookie, sessionCookie]);
        return response.redirect(safeRedirectUrl(authSuccessRedirect));
    } catch (error) {
        console.error(error);
        response.setHeader("Set-Cookie", clearStateCookie);
        return response.redirect(safeRedirectUrl(authFailureRedirect));
    }
});

app.get("/api/auth/me", async (request, response) => {
    const session = verifyAuthSession(parseCookies(request)[authCookieName] || "");

    if (!session) {
        return response.json({
            ok: true,
            authenticated: false,
            viewer: null
        });
    }

    const viewer = await buildViewerForEmail(session.email);

    return response.json({
        ok: true,
        authenticated: true,
        viewer: {
            ...viewer,
            name: session.name || "",
            picture: session.picture || "",
            provider: session.provider || "google"
        }
    });
});

app.post("/api/auth/logout", (_request, response) => {
    response.setHeader(
        "Set-Cookie",
        serializeCookie(authCookieName, "", {
            httpOnly: true,
            secure: authCookieSecure,
            sameSite: "Lax",
            maxAge: 0,
            path: "/",
            domain: authCookieDomain
        })
    );

    response.json({ ok: true });
});

app.get("/api/comments", async (request, response) => {
    const parsed = commentListSchema.safeParse({
        postId: String(request.query.postId || "")
    });

    if (!parsed.success) {
        return response.status(400).json({ error: "评论参数不完整" });
    }

    const comments = await readCommentsForPost(parsed.data.postId);

    response.json({
        ok: true,
        comments
    });
});

app.post("/api/comments", async (request, response) => {
    const parsed = commentCreateSchema.safeParse(request.body || {});

    if (!parsed.success) {
        return response.status(400).json({
            error: "评论内容不完整或过长"
        });
    }

    const viewer = await getAuthenticatedViewer(request, parsed.data.memberToken);

    if (!viewer || !viewer.email) {
        return response.status(401).json({
            error: "请先登录后再评论"
        });
    }

    const comment = {
        id: crypto.randomUUID(),
        postId: parsed.data.postId,
        postUrl: parsed.data.postUrl,
        content: sanitizePlainText(parsed.data.content, 1000),
        authorName: sanitizePlainText(viewer.name || viewer.email, 80),
        authorEmail: viewer.email,
        authorPicture: sanitizePlainText(viewer.picture || "", 500),
        createdAt: new Date().toISOString()
    };

    const comments = await appendComment(comment);

    response.status(201).json({
        ok: true,
        comment,
        comments
    });
});

app.get("/api/link-preview", async (request, response) => {
    const url = String(request.query.url || "").trim();
    const parsedUrl = parseAllowedPreviewUrl(url);

    if (!parsedUrl) {
        return response.status(400).json({
            error: "暂不支持这个链接"
        });
    }

    const cacheKey = parsedUrl.href;
    const cached = linkPreviewCache.get(cacheKey);

    if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
        return response.json(cached.preview);
    }

    const site = previewSiteForUrl(parsedUrl);
    const affiliateSettings = await readAffiliateSettings();
    const preview = await fetchLinkPreview(parsedUrl, site, affiliateSettings);

    setLinkPreviewCache(cacheKey, {
        cachedAt: Date.now(),
        preview
    });

    return response.json(preview);
});

app.get("/admin/affiliate-settings", async (request, response) => {
    if (!isLocalRequest(request)) {
        return response.status(403).send("Forbidden");
    }

    const settings = await readAffiliateSettings();

    response.type("html").send(renderAffiliateSettingsPage(settings, ""));
});

app.post("/admin/affiliate-settings", async (request, response) => {
    if (!isLocalRequest(request)) {
        return response.status(403).send("Forbidden");
    }

    const settings = normalizeAffiliateSettingsFromForm(request.body || {});

    await writeAffiliateSettings(settings);
    linkPreviewCache.clear();

    response.type("html").send(renderAffiliateSettingsPage(settings, "已保存推广链接转换设置。"));
});

app.post("/api/author/me", async (request, response) => {
    const parsed = identitySchema.safeParse(request.body);

    if (!parsed.success) {
        return response.status(400).json({
            error: "登录信息不完整"
        });
    }

    let email = "";

    if (parsed.data.memberToken) {
        try {
            const memberPayload = await verifyMemberToken(parsed.data.memberToken);
            email = String(memberPayload.sub || "").trim().toLowerCase();
        } catch (error) {
            return response.status(401).json({
                error: error.message || "Ghost 登录身份无效"
            });
        }
    } else {
        const session = verifyAuthSession(parseCookies(request)[authCookieName] || "");

        if (!session) {
            return response.status(401).json({
                error: "请先登录看见了会员，再继续操作"
            });
        }

        email = String(session.email || "").trim().toLowerCase();
    }

    const viewer = await buildViewerForEmail(email);

    return response.json({
        ok: true,
        viewer
    });
});

app.post("/api/author/posts", async (request, response) => {
    const parsed = submitSchema.safeParse(request.body);

    if (!parsed.success) {
        return response.status(400).json({
            error: "提交内容不完整或格式不正确",
            details: parsed.error.flatten()
        });
    }

    const payload = parsed.data;
    let authorEmail;

    try {
        authorEmail = await getCertifiedAuthorEmail(payload.memberToken, request);
        validatePublishPayload(payload);
    } catch (error) {
        return response.status(error.statusCode || 403).json({
            error: error.message || "作者认证或内容校验失败"
        });
    }

    try {
        const post = await createGhostPostFromPayload(payload, authorEmail);

        return response.status(201).json({
            ok: true,
            post: {
                id: post.id,
                status: post.status,
                title: post.title,
                url: post.url || null
            }
        });
    } catch (error) {
        console.error(error);

        return response.status(502).json({
            error: "写入 Ghost 失败，请检查作者邮箱是否为 Ghost Staff，以及 Admin API 配置是否正确。"
        });
    }
});

app.post("/api/author/posts/batch", async (request, response) => {
    const parsed = batchSubmitSchema.safeParse(request.body);

    if (!parsed.success) {
        return response.status(400).json({
            error: "批量提交内容不完整或格式不正确",
            details: parsed.error.flatten()
        });
    }

    const payload = parsed.data;
    let authorEmail;

    try {
        authorEmail = await getCertifiedAuthorEmail(payload.memberToken, request);
    } catch (error) {
        return response.status(403).json({
            error: error.message || "作者认证失败"
        });
    }

    const results = [];

    for (const [index, rawPost] of payload.posts.entries()) {
        const postPayload = {
            ...rawPost,
            status: rawPost.status || payload.status,
            imageData: null,
            imageDataList: [],
            videoData: null,
            videoDataList: []
        };

        try {
            validatePublishPayload(postPayload);

            const post = await createGhostPostFromPayload(postPayload, authorEmail);

            results.push({
                ok: true,
                index,
                post: {
                    id: post.id,
                    status: post.status,
                    title: post.title,
                    url: post.url || null
                }
            });
        } catch (error) {
            console.error(error);
            results.push({
                ok: false,
                index,
                title: postPayload.title || "",
                error: error.message || "写入 Ghost 失败"
            });
        }
    }

    const failed = results.filter((result) => !result.ok);

    return response.status(failed.length ? 207 : 201).json({
        ok: failed.length === 0,
        total: results.length,
        succeeded: results.length - failed.length,
        failed: failed.length,
        results
    });
});

app.use((error, _request, response, next) => {
    if (error && error.type === "entity.too.large") {
        return response.status(413).json({
            error: "上传内容太大，请减少图片或视频数量后再试。"
        });
    }

    if (error instanceof SyntaxError && error.status === 400) {
        return response.status(400).json({
            error: "请求 JSON 格式不正确。"
        });
    }

    return next(error);
});

app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
});

app.listen(port, host, () => {
    console.log(`Ghost author API listening on http://${host}:${port}`);
});

function parseCertifiedAuthorEmails(emailValue, legacyTokenValue) {
    const result = new Map();

    emailValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
            result.set(entry.toLowerCase(), true);
        });

    legacyTokenValue
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
            const separator = entry.indexOf(":");

            if (separator > 0) {
                result.set(entry.slice(0, separator).trim().toLowerCase(), true);
            }
        });

    return result;
}

function isShortPost(payload) {
    return payload.tags.some((tag) => tag === "短内容" || tag.toLowerCase() === "shorts");
}

function validatePublishPayload(payload) {
    const imageDataList = payload.imageDataList.length ? payload.imageDataList : (payload.imageData ? [payload.imageData] : []);
    const videoDataList = payload.videoDataList.length ? payload.videoDataList : (payload.videoData ? [payload.videoData] : []);

    if (!payload.content && !imageDataList.length && !videoDataList.length) {
        const error = new Error("请先填写正文，或选择图片/视频后再提交。");
        error.statusCode = 400;
        throw error;
    }

    if (isShortPost(payload) && payload.content.length > 1800) {
        const error = new Error("短文内容不能超过 1800 字。");
        error.statusCode = 400;
        throw error;
    }
}

async function createGhostPostFromPayload(payload, authorEmail) {
    const imageDataList = payload.imageDataList.length ? payload.imageDataList : (payload.imageData ? [payload.imageData] : []);
    const videoDataList = payload.videoDataList.length ? payload.videoDataList : (payload.videoData ? [payload.videoData] : []);
    const uploadedImageUrls = [];
    const uploadedVideoUrls = [];

    for (const imageData of imageDataList.slice(0, 9)) {
        uploadedImageUrls.push(await uploadImageData(imageData));
    }

    for (const videoData of videoDataList.slice(0, 4)) {
        uploadedVideoUrls.push(await uploadVideoData(videoData));
    }

    const uploadedImageUrl = uploadedImageUrls[0] || "";
    const featureImage = payload.featureImage || uploadedImageUrl;
    const postPayload = {
        title: payload.title || createTitleFromContent(payload.content),
        status: payload.status === "published" && allowDirectPublish ? "published" : "draft",
        custom_excerpt: payload.excerpt || undefined,
        feature_image: featureImage || undefined,
        tags: payload.tags,
        authors: [authorEmail]
    };

    if (uploadedImageUrls.length || uploadedVideoUrls.length) {
        postPayload.lexical = buildLexicalContent(payload.content, {
            imageUrls: uploadedImageUrls.map((url, index) => ({
                url,
                fileName: imageDataList[index]?.filename || ""
            })),
            videoUrls: uploadedVideoUrls.map((url, index) => ({
                url,
                fileName: videoDataList[index]?.filename || "",
                mimeType: videoDataList[index]?.contentType || "video/mp4"
            }))
        });
    } else {
        postPayload.html = renderAuthorContent(payload.content);
    }

    return postPayload.html
        ? ghost.posts.add(postPayload, { source: "html" })
        : ghost.posts.add(postPayload);
}

function isGoogleAuthConfigured() {
    return Boolean(googleClientId && googleClientSecret && authCookieSecret.length >= 32);
}

async function buildViewerForEmail(emailValue) {
    const email = String(emailValue || "").trim().toLowerCase();
    const viewer = {
        email,
        isCertified: certifiedAuthors.has(email),
        isStaff: false,
        isModerator: false,
        authorSlug: "",
        roles: []
    };

    if (!email) {
        return viewer;
    }

    try {
        const users = await ghost.users.browse({
            filter: `email:${email}`,
            include: "roles",
            limit: 1
        });
        const user = users[0];

        if (user) {
            const roles = Array.isArray(user.roles) ? user.roles.map((role) => role.name).filter(Boolean) : [];
            viewer.isStaff = true;
            viewer.authorSlug = user.slug || "";
            viewer.roles = roles;
            viewer.isModerator = roles.some((role) => ["Owner", "Administrator", "Editor"].includes(role));
        }
    } catch (error) {
        console.error(error);
    }

    return viewer;
}

async function getAuthenticatedViewer(request, memberToken = "") {
    try {
        if (memberToken) {
            const payload = await verifyMemberToken(memberToken);
            const email = String(payload.sub || "").trim().toLowerCase();
            const viewer = await buildViewerForEmail(email);

            return {
                ...viewer,
                name: String(payload.name || payload.email || email || "").trim(),
                picture: String(payload.picture || "").trim()
            };
        }
    } catch (_error) {
        return null;
    }

    const session = verifyAuthSession(parseCookies(request)[authCookieName] || "");

    if (!session || !session.email) {
        return null;
    }

    const viewer = await buildViewerForEmail(session.email);

    return {
        ...viewer,
        name: session.name || session.email || "",
        picture: session.picture || "",
        provider: session.provider || "google"
    };
}

async function readCommentsStore() {
    try {
        const raw = await fs.readFile(commentsStorePath, "utf8");
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return {};
        }

        throw error;
    }
}

async function writeCommentsStore(store) {
    const tmpPath = `${commentsStorePath}.${process.pid}.${Date.now()}.tmp`;

    await fs.writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`);
    await fs.rename(tmpPath, commentsStorePath);
}

async function readCommentsForPost(postId) {
    const store = await readCommentsStore();
    const comments = Array.isArray(store[postId]) ? store[postId] : [];

    return comments.slice(-200).map(publicComment);
}

async function appendComment(comment) {
    const store = await readCommentsStore();
    const comments = Array.isArray(store[comment.postId]) ? store[comment.postId] : [];

    comments.push(comment);
    store[comment.postId] = comments.slice(-1000);
    await writeCommentsStore(store);

    return store[comment.postId].map(publicComment);
}

function publicComment(comment) {
    return {
        id: comment.id,
        content: comment.content,
        authorName: comment.authorName,
        authorPicture: comment.authorPicture,
        createdAt: comment.createdAt
    };
}

function sanitizePlainText(value, maxLength) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

async function getGoogleUserFromCode(code) {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            code,
            client_id: googleClientId,
            client_secret: googleClientSecret,
            redirect_uri: authCallbackUrl,
            grant_type: "authorization_code"
        })
    });

    if (!tokenResponse.ok) {
        throw new Error("Google token exchange failed");
    }

    const tokenBody = await tokenResponse.json();

    if (!tokenBody.access_token) {
        throw new Error("Google token response is missing access_token");
    }

    const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: {
            Authorization: `Bearer ${tokenBody.access_token}`
        }
    });

    if (!userResponse.ok) {
        throw new Error("Google userinfo request failed");
    }

    const user = await userResponse.json();

    return {
        email: String(user.email || "").trim().toLowerCase(),
        email_verified: Boolean(user.email_verified),
        name: String(user.name || user.email || "").trim(),
        picture: String(user.picture || "").trim()
    };
}

async function upsertGhostMemberFromGoogle(googleUser) {
    const email = String(googleUser.email || "").trim().toLowerCase();
    const name = String(googleUser.name || email).trim();

    if (!email) {
        throw new Error("Google user email is missing");
    }

    try {
        return await ghost.members.add({
            email,
            name,
            subscribed: false
        });
    } catch (addError) {
        if (isGhostAlreadyExistsError(addError) || isGhostPermissionError(addError)) {
            return {
                id: "",
                email,
                name
            };
        }

        throw addError;
    }
}

function isGhostAlreadyExistsError(error) {
    const message = `${error?.message || ""} ${error?.context || ""}`.toLowerCase();
    return error?.type === "ValidationError" && (message.includes("already exists") || message.includes("member already exists"));
}

function isGhostPermissionError(error) {
    return error?.type === "NoPermissionError";
}

function signAuthSession(data) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        ...data,
        iat: now,
        exp: now + authCookieMaxAgeSeconds
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
        .createHmac("sha256", authCookieSecret)
        .update(encodedPayload)
        .digest("base64url");

    return `${encodedPayload}.${signature}`;
}

function verifyAuthSession(rawValue) {
    if (authCookieSecret.length < 32) {
        return null;
    }

    const token = String(rawValue || "");
    const separator = token.lastIndexOf(".");

    if (separator <= 0) {
        return null;
    }

    const encodedPayload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const expectedSignature = crypto
        .createHmac("sha256", authCookieSecret)
        .update(encodedPayload)
        .digest("base64url");

    if (!timingSafeEqual(signature, expectedSignature)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
        const now = Math.floor(Date.now() / 1000);

        if (!payload.email || !payload.exp || payload.exp <= now) {
            return null;
        }

        return payload;
    } catch (_error) {
        return null;
    }
}

function timingSafeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ""));
    const rightBuffer = Buffer.from(String(right || ""));

    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(request) {
    return String(request.headers.cookie || "")
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((cookies, entry) => {
            const separator = entry.indexOf("=");

            if (separator < 0) {
                return cookies;
            }

            const name = entry.slice(0, separator).trim();
            const value = entry.slice(separator + 1).trim();

            try {
                cookies[name] = decodeURIComponent(value);
            } catch (_error) {
                cookies[name] = value;
            }

            return cookies;
        }, {});
}

function serializeCookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];

    if (options.maxAge !== undefined) {
        parts.push(`Max-Age=${Number(options.maxAge)}`);
    }

    if (options.domain) {
        parts.push(`Domain=${options.domain}`);
    }

    parts.push(`Path=${options.path || "/"}`);

    if (options.httpOnly) {
        parts.push("HttpOnly");
    }

    if (options.secure) {
        parts.push("Secure");
    }

    parts.push(`SameSite=${options.sameSite || "Lax"}`);

    return parts.join("; ");
}

function safeRedirectUrl(value) {
    const fallback = "/";
    const redirect = String(value || fallback).trim();

    if (redirect.startsWith("/") && !redirect.startsWith("//")) {
        return redirect;
    }

    try {
        const target = new URL(redirect);
        const site = new URL(ghostUrl);

        if (target.origin === site.origin) {
            return target.href;
        }
    } catch (_error) {
        return fallback;
    }

    return fallback;
}

async function getCertifiedAuthorEmail(memberToken, request) {
    let email = "";

    if (memberToken) {
        const payload = await verifyMemberToken(memberToken);
        email = String(payload.sub || "").trim().toLowerCase();
    } else {
        const session = verifyAuthSession(parseCookies(request)[authCookieName] || "");
        email = String(session?.email || "").trim().toLowerCase();
    }

    if (!email) {
        throw new Error("Ghost 登录身份无效");
    }

    if (!certifiedAuthors.has(email)) {
        throw new Error("当前 Ghost 登录账号还不是认证作者");
    }

    return email;
}

async function verifyMemberToken(memberToken) {
    const decoded = jwt.decode(memberToken, { complete: true });

    if (!decoded || !decoded.header || !decoded.header.kid) {
        throw new Error("Ghost 登录身份无效");
    }

    const jwks = await getMemberJwks();
    const jwk = jwks.keys.find((key) => key.kid === decoded.header.kid);

    if (!jwk) {
        throw new Error("Ghost 登录密钥不匹配");
    }

    const publicKey = crypto.createPublicKey({
        key: jwk,
        format: "jwk"
    });

    return jwt.verify(memberToken, publicKey, {
        algorithms: ["RS512"],
        audience: [memberIssuer, memberIssuer.replace(/\/$/, "")],
        issuer: [memberIssuer, memberIssuer.replace(/\/$/, "")]
    });
}

let memberJwksCache = null;
let memberJwksExpiresAt = 0;

async function getMemberJwks() {
    if (memberJwksCache && Date.now() < memberJwksExpiresAt) {
        return memberJwksCache;
    }

    const response = await fetch(new URL("/members/.well-known/jwks.json", ghostUrl));

    if (!response.ok) {
        throw new Error("无法读取 Ghost Members 登录密钥");
    }

    memberJwksCache = await response.json();
    memberJwksExpiresAt = Date.now() + 5 * 60 * 1000;

    return memberJwksCache;
}

async function uploadImageData(imageData) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(imageData.data);

    if (!match) {
        throw new Error("图片格式不正确");
    }

    const contentType = imageData.contentType || match[1];
    const extension = extensionForImageType(contentType);
    const filename = sanitizeFilename(imageData.filename, extension);
    const filePath = path.join(os.tmpdir(), `ghost-author-${crypto.randomUUID()}-${filename}`);
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length > 5 * 1024 * 1024) {
        throw new Error("图片不能超过 5MB");
    }

    await fs.writeFile(filePath, buffer);

    try {
        const result = await ghost.images.upload({ file: filePath });
        const image = Array.isArray(result.images) ? result.images[0] : result;

        if (!image || !image.url) {
            throw new Error("图片上传失败");
        }

        return image.url;
    } finally {
        await fs.unlink(filePath).catch(() => {});
    }
}

async function uploadVideoData(videoData) {
    const match = /^data:(video\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(videoData.data);

    if (!match) {
        throw new Error("视频格式不正确");
    }

    const contentType = videoData.contentType || match[1];
    const extension = extensionForVideoType(contentType);
    const filename = sanitizeFilename(videoData.filename, extension);
    const filePath = path.join(os.tmpdir(), `ghost-author-${crypto.randomUUID()}-${filename}`);
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length > 25 * 1024 * 1024) {
        throw new Error("视频不能超过 25MB");
    }

    await fs.writeFile(filePath, buffer);

    try {
        const result = await ghost.media.upload({ file: filePath });
        const media = Array.isArray(result.media) ? result.media[0] : result;

        if (!media || !media.url) {
            throw new Error("视频上传失败");
        }

        return media.url;
    } finally {
        await fs.unlink(filePath).catch(() => {});
    }
}

function sanitizeFilename(filename, extension) {
    const safe = String(filename || "image")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);

    if (/\.[a-zA-Z0-9]+$/.test(safe)) {
        return safe;
    }

    return `${safe || "image"}${extension}`;
}

function extensionForImageType(contentType) {
    switch (contentType) {
        case "image/png":
            return ".png";
        case "image/gif":
            return ".gif";
        case "image/webp":
            return ".webp";
        case "image/avif":
            return ".avif";
        case "image/jpeg":
        case "image/jpg":
        default:
            return ".jpg";
    }
}

function extensionForVideoType(contentType) {
    switch (contentType) {
        case "video/webm":
            return ".webm";
        case "video/quicktime":
            return ".mov";
        case "video/mp4":
        default:
            return ".mp4";
    }
}

function normalizeHost(host) {
    return String(host || "")
        .toLowerCase()
        .replace(/^www\./, "")
        .replace(/^m\./, "")
        .replace(/^mobile\./, "");
}

function hostMatchesDomain(host, domain) {
    const normalizedHost = normalizeHost(host);
    const normalizedDomain = normalizeHost(domain);

    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function previewSiteForUrl(url) {
    const parsedUrl = url instanceof URL ? url : parseAllowedPreviewUrl(url);

    if (!parsedUrl) {
        return null;
    }

    return linkPreviewSites.find((site) => site.domains.some((domain) => hostMatchesDomain(parsedUrl.hostname, domain))) || null;
}

function parseAllowedPreviewUrl(value) {
    const raw = String(value || "").trim();

    if (!raw) {
        return null;
    }

    try {
        const parsedUrl = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw);

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return null;
        }

        if (!previewSiteForUrl(parsedUrl)) {
            return null;
        }

        return parsedUrl;
    } catch (error) {
        return null;
    }
}

async function fetchLinkPreview(parsedUrl, site, affiliateSettings) {
    const fallback = buildFallbackPreview(parsedUrl, site, affiliateSettings);

    try {
        const { upstream, finalUrl, finalSite } = await fetchAllowedPreviewResponse(parsedUrl);

        if (!upstream.ok || !String(upstream.headers.get("content-type") || "").includes("html")) {
            return fallback;
        }

        const html = await readLimitedText(upstream, 700_000);
        const title = firstValue([
            metaContent(html, ["og:title", "twitter:title"]),
            tagContent(html, "title"),
            fallback.title
        ]);
        const description = firstValue([
            metaContent(html, ["og:description", "twitter:description", "description"]),
            fallback.description
        ]);
        const image = absoluteHttpUrl(firstValue([
            metaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"])
        ]), finalUrl);
        const icon = absoluteHttpUrl(iconHref(html), finalUrl) || fallback.icon;
        const siteName = firstValue([metaContent(html, ["og:site_name", "application-name"]), finalSite?.name, site?.name, fallback.siteName]);

        return {
            ...fallback,
            title: cleanPreviewText(title, 140),
            description: cleanPreviewText(description, 220),
            image,
            icon,
            siteName: cleanPreviewText(siteName, 80)
        };
    } catch (error) {
        return fallback;
    }
}

async function fetchAllowedPreviewResponse(startUrl) {
    let currentUrl = startUrl;
    let currentSite = previewSiteForUrl(currentUrl);

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);

        try {
            const upstream = await fetch(currentUrl.href, {
                signal: controller.signal,
                redirect: "manual",
                headers: {
                    "accept": "text/html,application/xhtml+xml",
                    "user-agent": "Mozilla/5.0 NotebookLinkPreview/1.0"
                }
            });

            if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
                if (redirectCount === 3) {
                    throw new Error("链接跳转次数过多");
                }

                const redirectedUrl = parseAllowedPreviewUrl(new URL(upstream.headers.get("location"), currentUrl).href);

                if (!redirectedUrl) {
                    throw new Error("链接跳转到了不支持的域名");
                }

                await upstream.body?.cancel?.().catch(() => {});
                currentUrl = redirectedUrl;
                currentSite = previewSiteForUrl(currentUrl);
                continue;
            }

            return {
                upstream,
                finalUrl: currentUrl,
                finalSite: currentSite
            };
        } finally {
            clearTimeout(timer);
        }
    }

    throw new Error("链接跳转次数过多");
}

function setLinkPreviewCache(key, value) {
    if (linkPreviewCacheLimit > 0 && linkPreviewCache.size >= linkPreviewCacheLimit && !linkPreviewCache.has(key)) {
        const oldestKey = linkPreviewCache.keys().next().value;

        if (oldestKey) {
            linkPreviewCache.delete(oldestKey);
        }
    }

    linkPreviewCache.set(key, value);
}

function buildFallbackPreview(parsedUrl, site, affiliateSettings) {
    const targetUrl = affiliateUrlFor(parsedUrl, site, affiliateSettings);
    const isAffiliate = targetUrl !== parsedUrl.href;

    return {
        ok: true,
        url: parsedUrl.href,
        targetUrl,
        isAffiliate,
        siteKey: site?.key || "",
        siteName: site?.name || normalizeHost(parsedUrl.hostname),
        domain: normalizeHost(parsedUrl.hostname),
        title: fallbackTitleFromUrl(parsedUrl, site),
        description: parsedUrl.href,
        image: "",
        icon: `https://www.google.com/s2/favicons?sz=128&domain_url=${encodeURIComponent(parsedUrl.origin)}`
    };
}

function fallbackTitleFromUrl(parsedUrl, site) {
    const parts = parsedUrl.pathname.split("/").filter(Boolean);

    if (site?.key === "github" && parts.length >= 2) {
        if (parts[2] === "pull" && parts[3]) {
            return `${parts[0]}/${parts[1]} #${parts[3]}`;
        }

        if (parts[2] === "issues" && parts[3]) {
            return `${parts[0]}/${parts[1]} issue #${parts[3]}`;
        }

        return `${parts[0]}/${parts[1]}`;
    }

    return site?.name ? `${site.name} 链接` : normalizeHost(parsedUrl.hostname);
}

async function readLimitedText(response, limit) {
    if (!response.body || !response.body.getReader) {
        return (await response.text()).slice(0, limit);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let html = "";

    while (total < limit) {
        const { done, value } = await reader.read();

        if (done || !value) {
            break;
        }

        total += value.byteLength;
        html += decoder.decode(value, { stream: true });
    }

    html += decoder.decode();
    await reader.cancel().catch(() => {});

    return html.slice(0, limit);
}

function metaContent(html, names) {
    const metaTags = String(html || "").match(/<meta\b[^>]*>/gi) || [];

    for (const tag of metaTags) {
        const key = getHtmlAttr(tag, "property") || getHtmlAttr(tag, "name");
        const content = getHtmlAttr(tag, "content");

        if (key && content && names.includes(key.toLowerCase())) {
            return decodeHtml(content);
        }
    }

    return "";
}

function tagContent(html, tagName) {
    const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(String(html || ""));

    return match ? decodeHtml(match[1].replace(/<[^>]+>/g, " ")) : "";
}

function iconHref(html) {
    const links = String(html || "").match(/<link\b[^>]*>/gi) || [];

    for (const link of links) {
        const rel = String(getHtmlAttr(link, "rel") || "").toLowerCase();

        if (rel.includes("icon")) {
            return decodeHtml(getHtmlAttr(link, "href") || "");
        }
    }

    return "";
}

function getHtmlAttr(tag, attr) {
    const pattern = new RegExp(`${attr}\\s*=\\s*([\"'])(.*?)\\1`, "i");
    const match = pattern.exec(tag);

    return match ? match[2] : "";
}

function absoluteHttpUrl(value, baseUrl) {
    if (!value) {
        return "";
    }

    try {
        const parsed = new URL(value, baseUrl);

        return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
    } catch (error) {
        return "";
    }
}

function decodeHtml(value) {
    return String(value || "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#(x?[0-9a-f]+);/gi, (_match, code) => {
            const value = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : parseInt(code, 10);

            return Number.isFinite(value) ? String.fromCodePoint(value) : "";
        });
}

function cleanPreviewText(value, limit) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit);
}

function firstValue(values) {
    return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function affiliateUrlFor(parsedUrl, site, settings) {
    if (!settings.enabled || !site || !settings.templates[site.key]) {
        return parsedUrl.href;
    }

    return settings.templates[site.key]
        .replaceAll("{url}", encodeURIComponent(parsedUrl.href))
        .replaceAll("{raw_url}", parsedUrl.href)
        .replaceAll("{domain}", normalizeHost(parsedUrl.hostname));
}

async function readAffiliateSettings() {
    try {
        const raw = await fs.readFile(affiliateSettingsPath, "utf8");
        const parsed = JSON.parse(raw);

        return normalizeAffiliateSettings(parsed);
    } catch (error) {
        return normalizeAffiliateSettings({});
    }
}

async function writeAffiliateSettings(settings) {
    await fs.writeFile(affiliateSettingsPath, `${JSON.stringify(normalizeAffiliateSettings(settings), null, 2)}\n`);
}

function normalizeAffiliateSettings(value) {
    const templates = {};
    const source = value && typeof value === "object" ? value.templates || {} : {};

    affiliateShoppingSites.forEach((site) => {
        templates[site.key] = String(source[site.key] || "").trim();
    });

    return {
        enabled: Boolean(value?.enabled),
        templates
    };
}

function normalizeAffiliateSettingsFromForm(body) {
    const templates = {};

    affiliateShoppingSites.forEach((site) => {
        templates[site.key] = String(body[`template_${site.key}`] || "").trim();
    });

    return {
        enabled: body.enabled === "on",
        templates
    };
}

function isLocalRequest(request) {
    const ip = normalizeIp(request.ip || request.socket?.remoteAddress || "");
    const socketIp = normalizeIp(request.socket?.remoteAddress || "");
    const forwardedFor = String(request.get("x-forwarded-for") || "")
        .split(",")
        .map((entry) => normalizeIp(entry))
        .filter(Boolean);
    const forwardedHost = String(request.get("x-forwarded-host") || "").trim();
    const forwardedProto = String(request.get("x-forwarded-proto") || "").trim();

    if (!isLoopbackIp(ip) || !isLoopbackIp(socketIp)) {
        return false;
    }

    if (forwardedFor.length && !forwardedFor.every(isLoopbackIp)) {
        return false;
    }

    if (forwardedHost || forwardedProto) {
        return false;
    }

    return true;
}

function normalizeIp(value) {
    return String(value || "")
        .trim()
        .replace(/^::ffff:/, "");
}

function isLoopbackIp(value) {
    const ip = normalizeIp(value);

    return ip === "::1" || /^127\./.test(ip);
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderAffiliateSettingsPage(settings, message) {
    const rows = affiliateShoppingSites.map((site) => `
        <label>
            <span>${escapeHtml(site.name)}</span>
            <input name="template_${escapeHtml(site.key)}" value="${escapeHtml(settings.templates[site.key])}" placeholder="https://推广平台.example/track?url={url}">
            <small>${escapeHtml(site.domains.join(" / "))}</small>
        </label>
    `).join("");

    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>推广链接转换设置</title>
    <style>
        body { margin: 0; background: #f6f7fb; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        main { width: min(920px, calc(100vw - 40px)); margin: 40px auto; padding: 28px; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 18px 45px rgba(15,23,42,.08); }
        h1 { margin: 0 0 8px; font-size: 28px; }
        p { margin: 0 0 22px; color: #64748b; }
        form { display: grid; gap: 14px; }
        label { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 8px 14px; align-items: center; padding: 12px; border: 1px solid #e5e7eb; border-radius: 10px; }
        label:first-of-type { display: flex; align-items: center; gap: 10px; border: 0; padding: 0 0 8px; }
        label span { font-weight: 800; }
        input[type="text"], input:not([type]) { width: 100%; min-height: 38px; padding: 0 12px; border: 1px solid #dbe3ef; border-radius: 8px; font: inherit; }
        small { grid-column: 2; color: #94a3b8; }
        button { justify-self: end; min-height: 42px; padding: 0 22px; color: #fff; background: #ff3d1f; border: 0; border-radius: 8px; font: inherit; font-weight: 900; cursor: pointer; }
        .message { margin-bottom: 16px; color: #047857; font-weight: 800; }
        code { padding: 2px 5px; background: #f1f5f9; border-radius: 5px; }
    </style>
</head>
<body>
    <main>
        <h1>推广链接转换设置</h1>
        <p>填写各平台的推广链接模板。可用变量：<code>{url}</code> 编码后的原链接，<code>{raw_url}</code> 原链接，<code>{domain}</code> 域名。</p>
        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
        <form method="post">
            <label><input type="checkbox" name="enabled" ${settings.enabled ? "checked" : ""}> 启用电商推广链接转换</label>
            ${rows}
            <button type="submit">保存设置</button>
        </form>
    </main>
</body>
</html>`;
}

function buildLexicalContent(content, media) {
    const children = [];

    String(content || "")
        .split(/\n{2,}|\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .forEach((paragraph) => {
            children.push(createLexicalParagraph(paragraph));
        });

    const imageEntries = Array.isArray(media.imageUrls) ? media.imageUrls : [];
    const videoEntries = Array.isArray(media.videoUrls) ? media.videoUrls : [];

    imageEntries.slice(0, 9).forEach((image) => {
        children.push({
            type: "image",
            version: 1,
            src: image.url,
            caption: "",
            title: image.fileName || "",
            alt: "",
            cardWidth: "regular",
            width: null,
            height: null,
            href: ""
        });
    });

    videoEntries.slice(0, 4).forEach((video) => {
        children.push({
            type: "video",
            version: 1,
            src: video.url,
            caption: "",
            fileName: video.fileName || "",
            mimeType: video.mimeType || "video/mp4",
            width: 1280,
            height: 720,
            duration: 0,
            thumbnailSrc: "",
            customThumbnailSrc: "",
            thumbnailWidth: null,
            thumbnailHeight: null,
            cardWidth: "regular",
            loop: false
        });
    });

    if (children.length === 0) {
        children.push(createLexicalParagraph(" "));
    }

    return JSON.stringify({
        root: {
            children,
            direction: null,
            format: "",
            indent: 0,
            type: "root",
            version: 1
        }
    });
}

function createLexicalParagraph(text) {
    return {
        children: [
            {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text,
                type: "extended-text",
                version: 1
            }
        ],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1
    };
}

function renderAuthorContent(content) {
    const rawHtml = marked.parse(content, {
        async: false,
        breaks: true,
        gfm: true
    });

    const cleanHtml = sanitizeHtml(rawHtml, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
            "img",
            "h1",
            "h2",
            "h3",
            "h4",
            "figure",
            "figcaption",
            "video",
            "source"
        ]),
        allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            a: ["href", "name", "target", "rel"],
            img: ["src", "alt", "title"],
            source: ["src", "type"],
            video: ["src", "controls", "preload", "playsinline"]
        },
        allowedSchemes: ["http", "https", "mailto"],
        transformTags: {
            a: sanitizeHtml.simpleTransform("a", {
                rel: "noopener noreferrer",
                target: "_blank"
            })
        }
    });

    return cleanHtml;
}

function createTitleFromContent(content) {
    const text = String(content || "")
        .replace(/[#>*_`[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) {
        return "未命名短文";
    }

    return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}
