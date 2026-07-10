import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const DESIGNS_DIR = path.join(REPO_ROOT, "designs");
const CATALOG_PATH = path.join(REPO_ROOT, "catalog.json");
const README_PATH = path.join(REPO_ROOT, "README.md");

const GENERATED_NOTE =
  "This README was generated automatically from `meta.json` by `scripts/build_catalog.mjs`.";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function posixPath(...parts) {
  return path.posix.join(...parts.map((part) => String(part).replaceAll(path.sep, "/")));
}

function validateSlug(slug, label) {
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug),
    `Invalid ${label} "${slug}". Use lowercase letters, numbers, and hyphens only.`,
  );
  return slug;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => {
      if (typeof tag === "string") return tag.trim();
      if (tag && typeof tag === "object") return firstString(tag.value, tag.name, tag.id);
      return "";
    })
    .filter(Boolean);
}

function normalizeAuthors(meta) {
  if (typeof meta.author === "string" && meta.author.trim()) return [meta.author.trim()];
  if (!Array.isArray(meta.authors)) return [];

  return meta.authors
    .map((author) => {
      if (typeof author === "string") return author.trim();
      if (author && typeof author === "object") return firstString(author.name, author.id);
      return "";
    })
    .filter(Boolean);
}

function markdownEscape(value) {
  return String(value).replaceAll("|", "\\|").trim();
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .trim();
}
function normalizeRelativeFile(designDir, designRepoPath, filename, fallback, label) {
  const raw = firstString(filename, fallback);
  assert(raw, `Missing ${label} filename in ${path.relative(REPO_ROOT, designDir)}`);

  const relative = raw.replace(/^\.\//, "").replace(/^\/+/, "");
  const localPath = path.join(designDir, relative);
  assert(exists(localPath), `Missing ${path.relative(REPO_ROOT, localPath)} (${label})`);

  return {
    filename: relative.replaceAll("\\", "/"),
    path: posixPath(designRepoPath, relative),
  };
}

function buildDesignIndex() {
  assert(exists(DESIGNS_DIR), `Missing folder: ${path.relative(REPO_ROOT, DESIGNS_DIR)}`);

  const designs = [];
  const groups = [];
  const groupFolders = fs
    .readdirSync(DESIGNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const groupFolder of groupFolders) {
    const groupSlug = validateSlug(groupFolder, "group folder");
    const groupDir = path.join(DESIGNS_DIR, groupFolder);
    const group = {
      id: groupSlug,
      name: titleFromSlug(groupSlug),
      designs: [],
    };
    groups.push(group);
    const designFolders = fs
      .readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const designFolder of designFolders) {
      const designSlug = validateSlug(designFolder, "design folder");
      const designDir = path.join(groupDir, designFolder);
      const metaPath = path.join(designDir, "meta.json");
      if (!exists(metaPath)) {
        console.warn(`Skipping ${path.relative(REPO_ROOT, designDir)} because it has no meta.json.`);
        continue;
      }

      const meta = readJson(metaPath);
      const designRepoPath = posixPath("designs", groupSlug, designSlug);
      const title = firstString(meta.title, meta.name, designSlug);
      const description = firstString(meta.description);
      const systemId = firstString(meta.system?.id, meta.system_id, groupSlug);
      const systemName = firstString(meta.system?.title, meta.system?.name, systemId);
      const authors = normalizeAuthors(meta);
      const tags = normalizeTags(meta.tags);
      const units = firstString(meta.units, meta.unit);
      const thumbnail = normalizeRelativeFile(
        designDir,
        designRepoPath,
        meta.files?.thumbnail,
        "00_thumb.png",
        "thumbnail",
      );
      const designFile = normalizeRelativeFile(
        designDir,
        designRepoPath,
        meta.files?.design,
        "design.json",
        "design file",
      );

      const design = {
        id: firstString(meta.id, `${groupSlug}_${designSlug}`),
        slug: designSlug,
        title,
        description,
        group: firstString(meta.group, groupSlug),
        path: designRepoPath,
        system: {
          id: systemId,
          name: systemName,
          repo: firstString(meta.system?.repo),
          path: firstString(meta.system?.path, meta.system?.url),
        },
        authors,
        author: authors.join(", "),
        tags,
        units,
        thumbnail: thumbnail.path,
        design_url: designFile.path,
        meta_url: posixPath(designRepoPath, "meta.json"),
      };
      designs.push(design);
      group.designs.push(design);
    }
  }

  designs.sort((a, b) => a.system.id.localeCompare(b.system.id) || a.title.localeCompare(b.title));
  for (const group of groups) {
    group.designs.sort((a, b) => a.title.localeCompare(b.title));
  }

  return { designs, groups };
}

function groupBySystem(designs) {
  const systems = new Map();
  for (const design of designs) {
    if (!systems.has(design.system.id)) {
      systems.set(design.system.id, {
        id: design.system.id,
        name: design.system.name,
        repo: design.system.repo,
        path: design.system.path,
        designs: [],
      });
    }
    systems.get(design.system.id).designs.push(design);
  }
  return [...systems.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function writeCatalog(designs) {
  const systems = groupBySystem(designs);
  const catalog = {
    generated_at: new Date().toISOString(),
    count: designs.length,
    systems: systems.map((system) => ({
      ...system,
      count: system.designs.length,
    })),
  };

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

function buildDesignReadme(design) {
  const thumbFile = path.posix.basename(design.thumbnail);
  const designFile = path.posix.basename(design.design_url);
  const tags = design.tags.length ? design.tags.map((tag) => `\`${tag}\``).join(" ") : "_No tags_";
  const author = design.author || "_Unknown author_";
  const description = design.description || "_No description provided._";
  const systemLink = design.system.path
    ? `[${design.system.name}](${design.system.path})`
    : design.system.name;

  return `# ${design.title}

![${design.title}](${thumbFile})

## Description

${description}

## Information

| Field | Value |
|---|---|
| ID | \`${markdownEscape(design.id)}\` |
| Group | \`${markdownEscape(design.group)}\` |
| System | ${systemLink} |
| Units | ${design.units ? `\`${markdownEscape(design.units)}\`` : "_Not specified_"} |
| Author | ${markdownEscape(author)} |
| Tags | ${tags} |

## Files

- [${designFile}](${designFile})
- [meta.json](meta.json)
- [${thumbFile}](${thumbFile})

---

${GENERATED_NOTE}
`;
}

function writeDesignReadmes(designs) {
  for (const design of designs) {
    fs.writeFileSync(path.join(REPO_ROOT, design.path, "README.md"), buildDesignReadme(design), "utf8");
  }
}

function buildDesignCard(design) {
  const tags = design.tags.length
    ? `<br><sub>${design.tags.map((tag) => `<code>${htmlEscape(tag)}</code>`).join(" ")}</sub>`
    : "";
  const author = design.author ? `<br><sub>by ${htmlEscape(design.author)}</sub>` : "";
  const description = design.description ? `<br>${htmlEscape(design.description)}` : "";
  const title = htmlEscape(design.title);
  const units = design.units ? `<br><sub>Units: <code>${htmlEscape(design.units)}</code></sub>` : "";

  return [
    `<a href="${design.path}"><img src="${design.thumbnail}" alt="${title}" width="100%"></a>`,
    `<br><strong><a href="${design.path}">${title}</a></strong>`,
    description,
    `<br><sub><code>${htmlEscape(design.id)}</code></sub>`,
    units,
    author,
    tags,
    `<br><a href="${design.design_url}">design.json</a> / <a href="${design.meta_url}">meta.json</a>`,
  ].join("");
}

function buildRootReadme(groups) {
  const lines = [
    "# Reclaimed-Designs-Catalog",
    "",
    "Design outputs and assembled proposals generated from the Reclaim Seoul design systems, prepared for browsing and visualization in the Wasp Atlas, and for AR-guided assemblies in HiveLens.",
    "",
    "## Available designs",
    "",
  ];

  for (const group of groups) {
    lines.push(`### ${group.name}`, "");

    if (!group.designs.length) {
      continue;
    }

    lines.push("<table>");

    for (let index = 0; index < group.designs.length; index += 2) {
      const left = buildDesignCard(group.designs[index]);
      const right = group.designs[index + 1] ? buildDesignCard(group.designs[index + 1]) : "";
      lines.push("  <tr>");
      lines.push(`    <td width="50%" valign="top">${left}</td>`);
      lines.push(`    <td width="50%" valign="top">${right}</td>`);
      lines.push("  </tr>");
    }

    lines.push("</table>");
    lines.push("");  }

  lines.push("## Repository structure", "");
  lines.push("```text");
  lines.push("designs/");
  lines.push("  <group-slug>/");
  lines.push("    <design-slug>/");
  lines.push("      design.json");
  lines.push("      meta.json");
  lines.push("      00_thumb.png");
  lines.push("      README.md");
  lines.push("");
  lines.push("catalog.json");
  lines.push("scripts/");
  lines.push("  build_catalog.mjs");
  lines.push("```");
  lines.push("");
  lines.push("---", "");
  lines.push(GENERATED_NOTE, "");

  return lines.join("\n");
}

function writeRootReadme(groups) {
  fs.writeFileSync(README_PATH, buildRootReadme(groups), "utf8");
}

const { designs, groups } = buildDesignIndex();
writeCatalog(designs);
writeRootReadme(groups);
writeDesignReadmes(designs);

console.log(`Generated catalog and README files for ${designs.length} design(s).`);
