/**
 * Block conversion utilities for the push engine.
 *
 * Converts blocks fetched from the Main workspace (BlockObjectResponse) into
 * the shape required to create them in the Other workspace.
 *
 * Image handling:
 *   - External URLs → passed through as-is.
 *   - Notion-hosted URLs (prod-files-secure.s3…) → downloaded and re-uploaded
 *     to the Other workspace via Notion's file upload API, so they don't break
 *     when the source CDN URL expires (~1 hour after fetch).
 */

import type { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Minimal shape accepted by blocks.children.append / pages.create children.
// We use `any` for the outer union because the SDK's CreateBlockBody type is
// not exported, and trying to reconstruct it leads to deeply nested generics.
// The underlying API schema is what matters at runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CreateBlockBody = any;

export type BlockWithChildren = BlockObjectResponse & {
  _children?: BlockWithChildren[];
};

// ---------------------------------------------------------------------------
// Image re-upload
// ---------------------------------------------------------------------------

function isNotionHostedUrl(url: string): boolean {
  return (
    url.includes("prod-files-secure.s3") ||
    url.includes("secure.notion-static.com") ||
    url.includes("s3.us-west-2.amazonaws.com")
  );
}

/**
 * Downloads a Notion-hosted image and re-uploads it to the Other workspace
 * using the Notion Files API.  Returns the new file_upload ID on success, or
 * null on any failure (caller should fall back to using the source URL).
 */
async function reuploadNotionImage(imageUrl: string): Promise<string | null> {
  const token = process.env.NOTION_NOTION_STATE;
  if (!token) return null;

  try {
    // 1. Download image from Notion's CDN
    const downloadRes = await fetch(imageUrl);
    if (!downloadRes.ok) {
      throw new Error(`Download failed: ${downloadRes.status}`);
    }
    const buffer = await downloadRes.arrayBuffer();
    const contentType =
      downloadRes.headers.get("content-type") ?? "image/png";
    const ext = contentType.split("/")[1]?.split(";")[0] ?? "png";

    // 2. Create a single-part upload session in the Other workspace
    const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "single_part" }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Create upload failed: ${createRes.status} — ${detail}`);
    }
    const uploadObj = (await createRes.json()) as { id: string };

    // 3. Upload file bytes as multipart/form-data
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([buffer], { type: contentType }),
      `image.${ext}`
    );
    const sendRes = await fetch(
      `https://api.notion.com/v1/file_uploads/${uploadObj.id}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
        },
        body: formData,
      }
    );
    if (!sendRes.ok) {
      const detail = await sendRes.text();
      throw new Error(`Send upload failed: ${sendRes.status} — ${detail}`);
    }

    return uploadObj.id;
  } catch (err) {
    console.warn("[push] Image re-upload failed, using URL fallback:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Block conversion
// ---------------------------------------------------------------------------

/**
 * Converts an array of Main-workspace blocks into Other-workspace create
 * bodies. Processes images and recurses into nested children.
 */
export async function convertBlocks(
  blocks: BlockWithChildren[]
): Promise<CreateBlockBody[]> {
  const result: CreateBlockBody[] = [];
  for (const block of blocks) {
    const converted = await convertBlock(block);
    if (converted !== null) result.push(converted);
  }
  return result;
}

async function convertBlock(
  block: BlockWithChildren
): Promise<CreateBlockBody | null> {
  const children =
    block._children && block._children.length > 0
      ? await convertBlocks(block._children)
      : undefined;

  switch (block.type) {
    case "paragraph":
      return {
        type: "paragraph",
        paragraph: {
          rich_text: block.paragraph.rich_text,
          color: block.paragraph.color,
          ...(children && { children }),
        },
      };

    case "heading_1":
      return {
        type: "heading_1",
        heading_1: {
          rich_text: block.heading_1.rich_text,
          color: block.heading_1.color,
          is_toggleable: block.heading_1.is_toggleable,
        },
      };

    case "heading_2":
      return {
        type: "heading_2",
        heading_2: {
          rich_text: block.heading_2.rich_text,
          color: block.heading_2.color,
          is_toggleable: block.heading_2.is_toggleable,
        },
      };

    case "heading_3":
      return {
        type: "heading_3",
        heading_3: {
          rich_text: block.heading_3.rich_text,
          color: block.heading_3.color,
          is_toggleable: block.heading_3.is_toggleable,
        },
      };

    case "bulleted_list_item":
      return {
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: block.bulleted_list_item.rich_text,
          color: block.bulleted_list_item.color,
          ...(children && { children }),
        },
      };

    case "numbered_list_item":
      return {
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: block.numbered_list_item.rich_text,
          color: block.numbered_list_item.color,
          ...(children && { children }),
        },
      };

    case "to_do":
      return {
        type: "to_do",
        to_do: {
          rich_text: block.to_do.rich_text,
          checked: block.to_do.checked,
          color: block.to_do.color,
          ...(children && { children }),
        },
      };

    case "toggle":
      return {
        type: "toggle",
        toggle: {
          rich_text: block.toggle.rich_text,
          color: block.toggle.color,
          ...(children && { children }),
        },
      };

    case "code":
      return {
        type: "code",
        code: {
          rich_text: block.code.rich_text,
          caption: block.code.caption,
          language: block.code.language,
        },
      };

    case "quote":
      return {
        type: "quote",
        quote: {
          rich_text: block.quote.rich_text,
          color: block.quote.color,
          ...(children && { children }),
        },
      };

    case "callout":
      return {
        type: "callout",
        callout: {
          rich_text: block.callout.rich_text,
          icon: block.callout.icon,
          color: block.callout.color,
          ...(children && { children }),
        },
      };

    case "divider":
      return { type: "divider", divider: {} };

    case "embed":
      return {
        type: "embed",
        embed: { url: block.embed.url },
      };

    case "bookmark":
      return {
        type: "bookmark",
        bookmark: {
          url: block.bookmark.url,
          caption: block.bookmark.caption,
        },
      };

    case "image": {
      const srcUrl =
        block.image.type === "external"
          ? block.image.external.url
          : block.image.type === "file"
          ? block.image.file.url
          : null;

      if (!srcUrl) return null;

      if (isNotionHostedUrl(srcUrl)) {
        const uploadId = await reuploadNotionImage(srcUrl);
        if (uploadId) {
          return {
            type: "image",
            image: {
              type: "file_upload",
              file_upload: { id: uploadId },
              caption: block.image.caption,
            },
          };
        }
      }
      // Fallback (external URL or upload failure)
      return {
        type: "image",
        image: {
          type: "external",
          external: { url: srcUrl },
          caption: block.image.caption,
        },
      };
    }

    case "video": {
      if (block.video.type === "external") {
        return {
          type: "video",
          video: { type: "external", external: { url: block.video.external.url } },
        };
      }
      return null; // can't re-upload Notion-hosted videos
    }

    case "file": {
      if (block.file.type === "external") {
        return {
          type: "file",
          file: {
            type: "external",
            external: { url: block.file.external.url },
            caption: block.file.caption,
          },
        };
      }
      return null;
    }

    case "pdf": {
      if (block.pdf.type === "external") {
        return {
          type: "pdf",
          pdf: {
            type: "external",
            external: { url: block.pdf.external.url },
            caption: block.pdf.caption,
          },
        };
      }
      return null;
    }

    case "table": {
      // Tables require their row children to be included inline
      return children
        ? {
            type: "table",
            table: {
              table_width: block.table.table_width,
              has_column_header: block.table.has_column_header,
              has_row_header: block.table.has_row_header,
              children,
            },
          }
        : null;
    }

    case "table_row":
      return {
        type: "table_row",
        table_row: { cells: block.table_row.cells },
      };

    case "column_list":
      return children
        ? { type: "column_list", column_list: { children } }
        : null;

    case "column":
      return children ? { type: "column", column: { children } } : null;

    // Blocks that cannot be created via the API
    case "child_page":
    case "child_database":
    case "synced_block":
    case "table_of_contents":
    case "breadcrumb":
    case "link_to_page":
    case "unsupported":
      return null;

    default:
      console.warn(`[push] Skipping unhandled block type: ${block.type}`);
      return null;
  }
}
