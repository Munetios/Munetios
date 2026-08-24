import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

const documentationRoot = path.join(process.cwd(), "documentation");

function parseFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { attributes: {}, body: source };
  const attributes = Object.fromEntries(
    match[1].split(/\r?\n/).map((line) => {
      const separator = line.indexOf(":");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      ];
    }),
  );
  return { attributes, body: source.slice(match[0].length) };
}

function makeId(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseDocument(source, filename) {
  const { attributes, body } = parseFrontmatter(source);
  const lines = body.trim().split(/\r?\n/);
  const titleLine =
    lines.find((line) => line.startsWith("# ")) || "# Documentation";
  const titleIndex = lines.indexOf(titleLine);
  const sections = [];
  let current = { id: "overview", title: "Overview", markdown: [] };
  for (const line of lines.slice(titleIndex + 1)) {
    if (line.startsWith("## ")) {
      if (current.markdown.some((entry) => entry.trim()))
        sections.push(current);
      const title = line.slice(3).trim();
      current = { id: makeId(title), title, markdown: [] };
    } else current.markdown.push(line);
  }
  if (current.markdown.some((entry) => entry.trim())) sections.push(current);
  return {
    appId: attributes.app,
    id: attributes.slug?.split("/").at(-1),
    order: Number(attributes.order || 0),
    slug: attributes.slug,
    summary: attributes.summary,
    title: titleLine.slice(2).trim(),
    sections,
    source: filename.replaceAll("\\", "/"),
  };
}

async function listMarkdownFiles(directory, prefix = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory())
        return listMarkdownFiles(path.join(directory, entry.name), relative);
      return entry.name.endsWith(".md") ? [relative] : [];
    }),
  );
  return nested.flat();
}

export async function loadDocumentation() {
  const filenames = await listMarkdownFiles(documentationRoot);
  const documents = await Promise.all(
    filenames.map(async (filename) =>
      parseDocument(
        await fs.readFile(path.join(documentationRoot, filename), "utf8"),
        filename,
      ),
    ),
  );
  return documents
    .filter((document) => document.appId && document.slug)
    .sort(
      (left, right) =>
        left.appId.localeCompare(right.appId) || left.order - right.order,
    );
}
