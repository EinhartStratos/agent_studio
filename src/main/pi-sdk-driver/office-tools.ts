import fs from 'node:fs';
import path from 'node:path';
import { Type } from 'typebox';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import PPTX2Json from 'pptx2json';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, HeadingLevel, AlignmentType, WidthType } from 'docx';
import { defineTool, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';

/**
 * 用于把 Word/Excel/PPT 内容提取为 Markdown，以及把 Markdown 写回 Word/Excel 的
 * Pi Agent 原生工具集合。
 */

// ---- 工具参数模式 ----
const readOfficeSchema = Type.Object({
  path: Type.String({ description: '要读取的 .docx、.xlsx、.xls 或 .pptx 文件路径（相对或绝对）' }),
});

const writeDocxSchema = Type.Object({
  path: Type.String({ description: '要写入的 .docx 文件路径（相对或绝对）' }),
  content: Type.String({ description: '要写入 Word 的 Markdown 内容' }),
});

const writeXlsxSchema = Type.Object({
  path: Type.String({ description: '要写入的 .xlsx 文件路径（相对或绝对）' }),
  content: Type.String({
    description:
      '表格数据：可以是 JSON 二维数组字符串（如 [["A","B"],[1,2]]），也可以是 Markdown 表格字符串',
  }),
  sheetName: Type.Optional(Type.String({ description: '工作表名称，默认 "Sheet1"' })),
});

type ReadOfficeInput = import('typebox').Static<typeof readOfficeSchema>;
type WriteDocxInput = import('typebox').Static<typeof writeDocxSchema>;
type WriteXlsxInput = import('typebox').Static<typeof writeXlsxSchema>;

// ---- 通用辅助函数 ----

function resolveOfficePath(filePath: string, cwd: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(cwd, filePath);
}

function makeTextResult(text: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details: undefined,
  } as AgentToolResult<unknown>;
}

function truncateIfNeeded(text: string, maxBytes = 256 * 1024): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf-8') + '\n\n... (内容已截断)';
}

function formatMammothMessages(messages: { type: string; message: string }[]): string {
  if (!messages.length) return '';
  return '\n<!-- 转换提示：\n' + messages.map((m) => `- [${m.type}] ${m.message}`).join('\n') + '\n-->';
}

// ---- Word 转 Markdown ----

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});
turndownService.use(gfm);

async function readWordToMarkdown(filePath: string): Promise<string> {
  const result = await mammoth.convertToHtml(
    { path: filePath },
    {
      // 图片不生成 base64，仅保留占位符，避免输出过大
      convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
    },
  );
  const messages = (result.messages ?? []) as { type: string; message: string }[];
  const markdown = turndownService.turndown(result.value).trim();
  if (messages.length) {
    return markdown + formatMammothMessages(messages);
  }
  return markdown;
}

// ---- Excel 转 Markdown ----

function sheetToMarkdown(sheetName: string, rows: unknown[][]): string {
  if (!rows.length) return `## Sheet: ${sheetName}\n\n（空表）`;
  const header = rows[0].map((cell) => String(cell ?? ''));
  const separator = header.map(() => '---');
  const body = rows.slice(1).map((row) =>
    row.map((cell) => String(cell ?? '').replace(/\|/g, '\\|')),
  );
  const lines: string[] = [`## Sheet: ${sheetName}`, '', `| ${header.join(' | ')} |`, `| ${separator.join(' | ')} |`];
  for (const row of body) {
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

async function readExcelToMarkdown(filePath: string): Promise<string> {
  const workbook = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
    parts.push(sheetToMarkdown(sheetName, rows));
  }
  return parts.join('\n\n');
}

// ---- PPTX 转 Markdown ----

function findAllXmlNodes(node: unknown, tagName: string): unknown[] {
  const results: unknown[] = [];
  if (node == null) return results;
  if (Array.isArray(node)) {
    for (const item of node) results.push(...findAllXmlNodes(item, tagName));
    return results;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (tagName in obj) {
      const value = obj[tagName];
      if (Array.isArray(value)) results.push(...value);
      else results.push(value);
    }
    for (const value of Object.values(obj)) {
      results.push(...findAllXmlNodes(value, tagName));
    }
  }
  return results;
}

function collectTextValues(node: unknown): string[] {
  const values: string[] = [];
  if (node == null) return values;
  if (typeof node === 'string') {
    if (node.trim()) values.push(node.trim());
    return values;
  }
  if (Array.isArray(node)) {
    for (const item of node) values.push(...collectTextValues(item));
    return values;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'a:t' || key.endsWith(':t')) {
        values.push(...collectTextValues(value));
      } else if (key !== '$') {
        values.push(...collectTextValues(value));
      }
    }
  }
  return values;
}

function getParagraphsFromSlide(slide: unknown): string[] {
  const aP = findAllXmlNodes(slide, 'a:p');
  const paragraphs: string[] = [];
  for (const p of aP) {
    const texts = collectTextValues(p);
    const joined = texts.join(' ').trim();
    if (joined) paragraphs.push(joined);
  }
  return paragraphs;
}

async function readPptxToMarkdown(filePath: string): Promise<string> {
  const pptx2json = new PPTX2Json();
  const json = await pptx2json.toJson(filePath);
  const slideKeys = Object.keys(json)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const nb = parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return na - nb;
    });

  const parts: string[] = [];
  for (let i = 0; i < slideKeys.length; i++) {
    const slide = json[slideKeys[i]];
    const paragraphs = getParagraphsFromSlide(slide);
    if (paragraphs.length) {
      parts.push(`## 第 ${i + 1} 页\n\n${paragraphs.join('\n\n')}`);
    }
  }

  if (!parts.length) return '（演示文稿中未找到可提取文本）';
  return parts.join('\n\n');
}

async function readOfficeFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx' || ext === '.doc') return readWordToMarkdown(filePath);
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm' || ext === '.csv') return readExcelToMarkdown(filePath);
  if (ext === '.pptx') return readPptxToMarkdown(filePath);
  throw new Error(`不支持的 Office 文件类型：${ext}。支持 .docx、.xls(x)、.pptx`);
}

// ---- Markdown 解析辅助 ----

function parseMarkdownTable(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue; // 分隔行
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

export function createOfficeTools(cwd: string): ToolDefinition[] {
  // ---- Markdown 转 docx 辅助 ----

  function splitMarkdownBlocks(content: string): string[] {
    return content.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  }

  function parseInlineMarkdown(text: string): TextRun[] {
    const runs: TextRun[] = [];
    const regex = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|(`)(.+?)\5/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) {
        runs.push(new TextRun(text.slice(last, match.index)));
      }
      if (match[1]) {
        runs.push(new TextRun({ text: match[2], bold: true }));
      } else if (match[3]) {
        runs.push(new TextRun({ text: match[4], italics: true }));
      } else if (match[5]) {
        runs.push(new TextRun({ text: match[6], style: 'Code' }));
      }
      last = regex.lastIndex;
    }
    if (last < text.length) {
      runs.push(new TextRun(text.slice(last)));
    }
    if (!runs.length) runs.push(new TextRun(text));
    return runs;
  }

  function parseMarkdownToDocx(content: string): (Paragraph | Table)[] {
    const blocks = splitMarkdownBlocks(content);
    const children: (Paragraph | Table)[] = [];

    for (const block of blocks) {
      const lines = block.split('\n');
      const first = lines[0];

      const headingMatch = first.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
        const headingMap = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        children.push(
          new Paragraph({
            children: parseInlineMarkdown(headingMatch[2]),
            heading: headingMap[level],
          }),
        );
        continue;
      }

      if (lines.length >= 2 && first.startsWith('|') && lines[1].startsWith('|')) {
        const rows = parseMarkdownTable(lines);
        if (rows.length) {
          children.push(
            new Table({
              rows: rows.map((row, ridx) =>
                new TableRow({
                  children: row.map((cell) =>
                    new TableCell({
                      children: [new Paragraph({ children: parseInlineMarkdown(cell), alignment: AlignmentType.CENTER })],
                    }),
                  ),
                }),
              ),
              width: { size: 100, type: WidthType.PERCENTAGE },
            }),
          );
          continue;
        }
      }

      if (first.startsWith('- ') || first.startsWith('* ') || /^\d+\.\s/.test(first)) {
        for (const line of lines) {
          const item = line.replace(/^(-|\*|\d+\.)\s+/, '');
          if (item) {
            children.push(
              new Paragraph({
                children: parseInlineMarkdown('- ' + item),
              }),
            );
          }
        }
        continue;
      }

      // 普通段落
      children.push(new Paragraph({ children: parseInlineMarkdown(block.replace(/\n/g, ' ')) }));
    }

    return children;
  }

  // ---- Excel 写入辅助 ----

  function parseContentToRows(content: string): unknown[][] {
    const trimmed = content.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          if (Array.isArray(parsed[0])) return parsed;
          if (typeof parsed[0] === 'object' && parsed[0] !== null) {
            const keys = Object.keys(parsed[0]);
            return [keys, ...parsed.map((row: any) => keys.map((k) => row[k]))];
          }
          return parsed.map((row: any) => [row]);
        }
        throw new Error('JSON 内容不是数组');
      } catch (err) {
        throw new Error(`无法解析 JSON 内容：${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 否则按 Markdown 表格解析
    const tableRows = parseMarkdownTable(trimmed.split('\n'));
    if (!tableRows.length) throw new Error('内容既不是 JSON 数组，也不包含有效的 Markdown 表格');
    return tableRows;
  }

  // ---- 工具定义 ----

  const readOfficeTool = defineTool({
    name: 'read_office',
    label: 'read_office',
    description: '读取 Word（.docx）、Excel（.xlsx/.xls）或 PowerPoint（.pptx）文件，并将其文字内容转换为 Markdown。',
    promptSnippet: '读取 Office 文件为 Markdown',
    promptGuidelines: [
      '当用户想从 .docx、.xlsx、.xls 或 .pptx 中提取文字时使用 read_office。',
      '不要对 .pdf 或其他二进制格式使用 read_office。',
    ],
    parameters: readOfficeSchema,
    async execute(_toolCallId, { path }, _signal, _onUpdate, _ctx) {
      const absolutePath = resolveOfficePath(path, cwd);
      if (!fs.existsSync(absolutePath)) throw new Error(`文件不存在：${absolutePath}`);
      const markdown = await readOfficeFile(absolutePath);
      return makeTextResult(truncateIfNeeded(markdown));
    },
  });

  const writeDocxTool = defineTool({
    name: 'write_docx',
    label: 'write_docx',
    description: '把 Markdown 内容写入 .docx 文件。支持标题、段落、列表、表格和基础行内格式。',
    promptSnippet: '把 Markdown 写入 Word 文档',
    promptGuidelines: ['需要把 Markdown 转为 Word（.docx）时使用 write_docx。'],
    parameters: writeDocxSchema,
    async execute(_toolCallId, { path: contentPath, content }, _signal, _onUpdate, _ctx) {
      const absolutePath = resolveOfficePath(contentPath, cwd);
      const children = parseMarkdownToDocx(content);
      const doc = new Document({
        sections: [
          {
            children,
          },
        ],
      });
      const buffer = await Packer.toBuffer(doc);
      await withFileMutationQueue(absolutePath, async () => {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, buffer);
      });
      return makeTextResult(`成功写入 Word 文档：${contentPath}`);
    },
  });

  const writeXlsxTool = defineTool({
    name: 'write_xlsx',
    label: 'write_xlsx',
    description: '把 JSON 二维数组或 Markdown 表格写入 .xlsx 文件。',
    promptSnippet: '把表格数据写入 Excel 文件',
    promptGuidelines: ['需要把表格数据写入 Excel（.xlsx）时使用 write_xlsx。'],
    parameters: writeXlsxSchema,
    async execute(_toolCallId, { path: contentPath, content, sheetName }, _signal, _onUpdate, _ctx) {
      const absolutePath = resolveOfficePath(contentPath, cwd);
      const rows = parseContentToRows(content);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
      await withFileMutationQueue(absolutePath, async () => {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        XLSX.writeFile(wb, absolutePath);
      });
      return makeTextResult(`成功写入 Excel 文件：${contentPath}`);
    },
  });

  return [readOfficeTool, writeDocxTool, writeXlsxTool];
}
