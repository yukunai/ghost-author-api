# Ghost Author API

为 Ghost 站点提供作者申请、投稿及命令行导入与发布功能。

## 安装

需要 Node.js 与 npm，可访问的 Ghost 站点及自己的 Ghost 集成凭据。

克隆仓库后，在项目根目录执行以下步骤。

```sh
npm ci
cp .env.example .env
# 编辑 .env 后启动
npm start
```

## 使用

在 .env 中填写 Ghost 站点地址和自己的凭据。使用 npm run publish -- --title "示例文章" --file ./auto-publish.example.md 创建草稿，进入 Ghost Admin 审核后发布。

## 检查

```sh
npm run check
```

## 说明

仓库包含源码与启动所需的示例。模型、平台或推送服务的凭据由使用者在本机配置。
